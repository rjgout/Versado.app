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
// Per maat staat een onzichtbare ankerdiv met data-seq (maatindex), zodat dezelfde scroll- en leeslogica als bij de tekst
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
  /** Zoom in procenten; 100 = passende breedte voor de beschikbare ruimte. */
  zoom: number;
  /** Maat die de muziek betrouwbaar volgt, of null (dan geen markering). */
  activeMeasure: number | null;
  onMeasureTap?(index: number): void;
  onStatus?(status: SheetStanzaStatus | null, rendered: boolean): void;
}

const UNIT_PX = 10; // OSMD rekent in eenheden van 10 px bij zoom 1
// 100% = ongeveer drie maten per systeem op een telefoon: de noten blijven groot genoeg om te lezen, maar een regel is niet
// meer één of twee maten (dat zou een lange rit scrollen betekenen). Groter/kleiner loopt via de zoomknoppen.
const BASE_ZOOM = 0.6;

export default function SheetMusicView({ sheet, stanza, zoom, activeMeasure, onMeasureTap, onStatus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<import("opensheetmusicdisplay").OpenSheetMusicDisplay | null>(null);
  const [boxes, setBoxes] = useState<SheetMeasureBox[]>([]);
  const [failed, setFailed] = useState(false);
  const [width, setWidth] = useState(0);
  const notation = useMemo(() => decodeNotation(sheet.notation), [sheet.notation]);
  const status = sheet.stanzas.find((s) => s.n === stanza) ?? null;
  const xml = useMemo(() => buildMusicXml(notation, { syllables: status?.lyrics ?? [] }).xml, [notation, status]);

  // Breedte van de leesruimte: opnieuw graveren bij draaien of formaatwijziging, met een korte vertraging.
  useEffect(() => {
    const el = hostRef.current;
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

  useEffect(() => {
    const host = hostRef.current;
    if (!host || width < 80) return;
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const { OpenSheetMusicDisplay } = await import("opensheetmusicdisplay");
        if (cancelled) return;
        if (!osmdRef.current) {
          host.replaceChildren();
          osmdRef.current = new OpenSheetMusicDisplay(host, { autoResize: false, drawTitle: false, drawComposer: false, drawPartNames: false, drawingParameters: "compact", backend: "svg", renderSingleHorizontalStaffline: false });
        }
        const osmd = osmdRef.current;
        await osmd.load(xml);
        if (cancelled) return;
        // pas na load(): load() zet de zoom terug naar 1
        osmd.Zoom = BASE_ZOOM * (zoom / 100);
        osmd.render();
        const scale = UNIT_PX * BASE_ZOOM * (zoom / 100);
        const next: SheetMeasureBox[] = [];
        // Eén doos per maat over alle balken; bij een maat op een nieuwe regel hoort die doos bij dat systeem.
        osmd.GraphicSheet.MeasureList.forEach((staves) => {
          const parts = staves.filter(Boolean).map((m) => m.PositionAndShape);
          if (parts.length === 0) return;
          const left = Math.min(...parts.map((p) => p.AbsolutePosition.x));
          const right = Math.max(...parts.map((p) => p.AbsolutePosition.x + p.Size.width));
          const top = Math.min(...parts.map((p) => p.AbsolutePosition.y + p.BorderTop));
          const bottom = Math.max(...parts.map((p) => p.AbsolutePosition.y + p.BorderBottom));
          next.push({ left: left * scale, top: top * scale, width: (right - left) * scale, height: (bottom - top) * scale });
        });
        setBoxes(next);
        onStatus?.(status, true);
      } catch {
        if (!cancelled) {
          setFailed(true);
          setBoxes([]);
          onStatus?.(status, false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // onStatus bewust niet: een nieuwe callback mag niet opnieuw graveren
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml, width, zoom]);

  return (
    <div data-hymns-sheet data-hymns-sheet-status={status?.status ?? "geen"} className="pb-3">
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
        <div ref={hostRef} className="w-full" aria-label={COPY.sheetLabel} role="img" />
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {boxes.map((b, i) => (
            <div
              key={i}
              data-seq={i}
              data-active={activeMeasure === i ? "true" : undefined}
              onClick={onMeasureTap ? () => onMeasureTap(i) : undefined}
              className={`absolute rounded-sm ${activeMeasure === i ? "bg-vs-accent/20 ring-2 ring-vs-accent/60" : ""}`}
              style={{ left: b.left, top: b.top, width: b.width, height: b.height }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
