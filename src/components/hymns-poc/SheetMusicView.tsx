"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { decodeNotation } from "@/lib/hymns/notation/decode";
import { buildMusicXml } from "@/lib/hymns/notation/musicxml";
import type { SheetData, SheetStanzaStatus } from "@/lib/hymns/notation/types";
import { COPY } from "./copy";

// Bladmuziek per couplet: de partituur wordt op het toestel gegraveerd (OpenSheetMusicDisplay, SVG) uit de notatielaag en de
// lettergrepen van precies dit couplet, met het refrein erachter op hetzelfde blad. OSMD wordt pas geladen als de gebruiker
// Bladmuziek kiest (dynamic import), en het graveren draait los van de muziekengine: een coupletwissel of zoom start nooit
// een nieuwe luistersessie.
//
// Vooruitkijken: er zijn twee graveerplekken ("slots"). Het getoonde couplet staat in de zichtbare plek; het volgende couplet (volgens
// de gekozen volgorde) wordt in een rustig moment alvast in de verborgen plek gegraveerd. Bij de coupletwissel wisselen de plekken
// van zichtbaarheid: geen graveerpauze en geen leeg blad. Wisselt de breedte of de zoom, dan zijn beide plekken ongeldig en wordt
// opnieuw gegraveerd (eerst het getoonde couplet).
//
// Per maat staat een onzichtbaar ankerdiv met data-seq (maatindex), zodat dezelfde scroll- en leeslogica als bij de tekst
// (useReadingScroll) de actieve maat in beeld houdt en een eigen scrollgebaar alleen "Zelf bladeren" aanzet.

export interface SheetMeasureBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Props {
  sheet: SheetData;
  stanza: number;
  /** Het couplet dat hierna komt volgens de gekozen volgorde, of null: wordt alvast gegraveerd. */
  nextStanza?: number | null;
  /** Zoom in procenten; 100 = passende breedte voor de beschikbare ruimte. */
  zoom: number;
  /** Maat die de muziek volgt, of null (dan geen markering). */
  activeMeasure: number | null;
  /** True als die maat geschat is (tijdelijk syncverlies) in plaats van gemeten: subtielere markering. */
  activeEstimated?: boolean;
  onMeasureTap?(index: number): void;
  onStatus?(status: SheetStanzaStatus | null, rendered: boolean): void;
}

type Osmd = import("opensheetmusicdisplay").OpenSheetMusicDisplay;

interface Slot {
  /** Welk couplet, bij welke breedte en zoom, hier gegraveerd staat (of wordt); null = leeg. */
  key: string | null;
  stanza: number | null;
  boxes: SheetMeasureBox[];
  failed: boolean;
}

const UNIT_PX = 10; // OSMD rekent in eenheden van 10 px bij zoom 1
// 100% = ongeveer drie maten per systeem op een telefoon: de noten blijven groot genoeg om te lezen, maar een regel is niet
// meer één of twee maten (dat zou een lange rit scrollen betekenen). Groter/kleiner loopt via de zoomknoppen.
const BASE_ZOOM = 0.6;
const EMPTY: Slot = { key: null, stanza: null, boxes: [], failed: false };

export default function SheetMusicView({ sheet, stanza, nextStanza = null, zoom, activeMeasure, activeEstimated = false, onMeasureTap, onStatus }: Props) {
  const hostRefs = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const osmds = useRef<(Osmd | null)[]>([null, null]);
  const rootRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<[Slot, Slot]>([EMPTY, EMPTY]);
  const [visible, setVisible] = useState(0);
  const [width, setWidth] = useState(0);
  const notation = useMemo(() => decodeNotation(sheet.notation), [sheet.notation]);
  const statusOf = (n: number) => sheet.stanzas.find((s) => s.n === n) ?? null;
  const status = statusOf(stanza);
  const slotsRef = useRef(slots);
  useEffect(() => {
    slotsRef.current = slots;
  });
  const queue = useRef(Promise.resolve());

  // Breedte van de leesruimte: opnieuw graveren bij draaien of formaatwijziging, met een korte vertraging.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(measure, 150);
    });
    ro.observe(el);
    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, []);

  // Graveert een couplet in een plek. Opeenvolgend (één graveerbeurt tegelijk), zodat de hoofdthread nooit dubbel belast wordt.
  const render = (index: 0 | 1, n: number, key: string): Promise<void> => {
    const task = async () => {
      const host = hostRefs[index].current;
      if (!host) return;
      try {
        const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
        let osmd = osmds.current[index];
        if (!osmd) {
          host.replaceChildren();
          osmd = new OpenSheetMusicDisplay(host, { autoResize: false, drawTitle: false, drawComposer: false, drawPartNames: false, drawingParameters: "compact", backend: "svg", renderSingleHorizontalStaffline: false });
          osmds.current[index] = osmd;
        }
        const syllables = statusOf(n)?.lyrics ?? [];
        await osmd.load(buildMusicXml(notation, { syllables }).xml);
        // pas na load(): load() zet de zoom terug naar 1
        osmd.Zoom = BASE_ZOOM * (zoom / 100);
        osmd.render();
        const scale = UNIT_PX * BASE_ZOOM * (zoom / 100);
        const boxes: SheetMeasureBox[] = [];
        // Eén doos per maat over alle balken; bij een maat op een nieuwe regel hoort die doos bij dat systeem.
        osmd.GraphicSheet.MeasureList.forEach((staves) => {
          const parts = staves.filter(Boolean).map((m) => m.PositionAndShape);
          if (parts.length === 0) return;
          const left = Math.min(...parts.map((p) => p.AbsolutePosition.x));
          const right = Math.max(...parts.map((p) => p.AbsolutePosition.x + p.Size.width));
          const top = Math.min(...parts.map((p) => p.AbsolutePosition.y + p.BorderTop));
          const bottom = Math.max(...parts.map((p) => p.AbsolutePosition.y + p.BorderBottom));
          boxes.push({ left: left * scale, top: top * scale, width: (right - left) * scale, height: (bottom - top) * scale });
        });
        setSlots((prev) => {
          const next: [Slot, Slot] = [prev[0], prev[1]];
          next[index] = { key, stanza: n, boxes, failed: false };
          return next;
        });
      } catch {
        setSlots((prev) => {
          const next: [Slot, Slot] = [prev[0], prev[1]];
          next[index] = { key, stanza: n, boxes: [], failed: true };
          return next;
        });
      }
    };
    queue.current = queue.current.then(task, task);
    return queue.current;
  };

  const sizeKey = `${width}:${zoom}`;
  // Het getoonde couplet: staat het al gegraveerd (bijvoorbeeld als vooruitgekeken couplet), dan wisselen we alleen van plek.
  useEffect(() => {
    if (width < 80) return;
    const current = slotsRef.current;
    const want = (n: number) => `${n}:${sizeKey}`;
    const have = [0, 1].find((i) => current[i].key === want(stanza));
    if (have !== undefined) {
      setVisible(have);
      return;
    }
    // niet klaar: graveer in de verborgen plek (het huidige blad blijft staan tot het nieuwe klaar is) of, bij de eerste keer, in plek 0
    const target = (current[visible].key === null ? visible : 1 - visible) as 0 | 1;
    void render(target, stanza, want(stanza)).then(() => setVisible(target));
    // render en slotsRef zijn stabiel genoeg; alleen couplet, breedte, zoom en notatie bepalen of er opnieuw gegraveerd wordt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stanza, sizeKey, notation]);

  // Het volgende couplet alvast graveren, in een rustig moment en nadat het getoonde couplet klaar is.
  const shownReady = slots[visible].key === `${stanza}:${sizeKey}`;
  useEffect(() => {
    if (width < 80 || nextStanza === null || !shownReady) return;
    const want = `${nextStanza}:${sizeKey}`;
    if (slotsRef.current.some((s) => s.key === want)) return;
    const hidden = (1 - visible) as 0 | 1;
    const run = () => void render(hidden, nextStanza, want);
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(run, { timeout: 2500 });
      return () => w.cancelIdleCallback?.(h);
    }
    const t = setTimeout(run, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextStanza, shownReady, sizeKey, visible]);

  useEffect(() => {
    if (shownReady) onStatus?.(status, !slots[visible].failed);
    // onStatus bewust niet: een nieuwe callback mag niet opnieuw graveren
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownReady, visible]);

  const active = slots[visible];
  const boxes = shownReady ? active.boxes : [];
  const failed = shownReady && active.failed;
  const hiddenStyle = { position: "absolute", left: 0, top: 0, width: "100%", visibility: "hidden", pointerEvents: "none" } as const;

  return (
    <div ref={rootRef} data-hymns-sheet data-hymns-sheet-status={status?.status ?? "geen"} data-hymns-sheet-ready={shownReady ? "true" : "false"} data-hymns-sheet-next={slots[1 - visible].stanza ?? undefined} className="pb-3">
      {status && status.status !== "ok" ? (
        <p className="mb-2 rounded-xl bg-vs-subtle p-3 text-sm text-vs-fg-2" role="status" data-hymns-sheet-note>
          {COPY.sheetNoLyrics}
        </p>
      ) : null}
      {failed ? (
        <p className="rounded-xl bg-vs-subtle p-3 text-sm text-vs-fg-2" role="status" data-hymns-sheet-failed>
          {COPY.sheetFailed}
        </p>
      ) : null}
      <div className="relative w-full overflow-hidden bg-white text-black">
        {[0, 1].map((i) => (
          <div key={i} ref={hostRefs[i]} className="w-full" style={i === visible ? undefined : hiddenStyle} aria-label={i === visible ? COPY.sheetLabel : undefined} aria-hidden={i === visible ? undefined : true} role={i === visible ? "img" : undefined} data-sheet-slot={i} data-sheet-stanza={slots[i].stanza ?? undefined} />
        ))}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {boxes.map((b, i) => (
            <div
              key={i}
              data-seq={i}
              data-active={activeMeasure === i ? "true" : undefined}
              data-estimated={activeMeasure === i && activeEstimated ? "true" : undefined}
              onClick={onMeasureTap ? () => onMeasureTap(i) : undefined}
              className={`absolute rounded-sm ${activeMeasure === i ? (activeEstimated ? "bg-vs-accent/10 outline outline-2 -outline-offset-2 outline-dashed outline-vs-accent/50" : "bg-vs-accent/20 ring-2 ring-vs-accent/60") : ""}`}
              style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
