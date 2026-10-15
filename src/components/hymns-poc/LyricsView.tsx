"use client";

import { useLayoutEffect, useRef } from "react";
import type { DisplayCursor } from "@/lib/hymns/follow/display";
import type { HymnStanza, HymnText } from "@/lib/hymns/types";
import type { HymnTextSize, HymnView } from "@/lib/hymnPrefs";
import { COPY } from "./copy";
import { KARAOKE_PREVIEW_LINES, activeSeq, activeWordFor, lyricSequence, type LyricLine } from "./viewModel";

// De lofzangtekst: het enige waar het scherm om draait. Twee weergaven op dezelfde gegevens (de muziekengine
// weet niets van de weergave), beide gewoon scrollbaar met de vinger en beide bruikbaar zonder werkende
// synchronisatie:
//  - volledig couplet: alle regels onder elkaar, de regel van de muziek subtiel gemarkeerd;
//  - karaoke per regel: hetzelfde verticale zangboek, met één regel groot (de muziekregel of, tijdens
//    handmatig lezen, de leesregel). Alle regels blijven leesbaar en aantikbaar.
// Het actieve woord krijgt de accentkleur; de breedte is vooraf gereserveerd (.hymn-word) zodat er niets verschuift.

const STANZA_SIZE: Record<HymnTextSize, string> = { normal: "text-xl", large: "text-2xl", xlarge: "text-3xl" };
const KARAOKE_CURRENT: Record<HymnTextSize, string> = { normal: "text-3xl", large: "text-4xl", xlarge: "text-5xl" };
const KARAOKE_OTHER: Record<HymnTextSize, string> = { normal: "text-xl", large: "text-2xl", xlarge: "text-3xl" };

interface Props {
  text: HymnText;
  stanza: HymnStanza | undefined;
  /** Positie van de muziek; undefined als de engine niet in dit couplet zit of nog niets actief is. */
  cursor: DisplayCursor | undefined;
  view: HymnView;
  size: HymnTextSize;
  /** Karaoke: de regel die groot staat. */
  focus: number;
  /** De regel die de gebruiker zelf koos (aantikken, vorige/volgende), of null. */
  reading: number | null;
  onLineTap?(seq: number): void;
  /**
   * Het couplet dat hierna komt (volgens de gekozen volgorde), of null. Alleen om vooruit te lezen: het wisselt nooit het getoonde couplet.
   * Het staat in dezelfde doorlopende leesruimte onder het huidige couplet (volledig couplet) of onder de laatste regels (karaoke).
   */
  nextStanza?: HymnStanza | null;
}

function Words({ entry, activeWord, linking, lineActive, estimated }: { entry: LyricLine; activeWord: number | null; linking: "word" | "line" | undefined; lineActive: boolean; estimated: boolean }) {
  const words = entry.line.words;
  // Zonder betrouwbare woordkoppeling: de hele actieve regel krijgt de accentkleur, nooit een verzonnen woord.
  const wholeLine = lineActive && activeWord === null && linking !== "word";
  if (words.length === 0) return <span className={wholeLine ? "font-semibold text-vs-accent" : undefined}>{entry.line.text}</span>;
  return (
    <>
      {/* Een geschat woord (de volger is de synchronisatie even kwijt) staat subtieler dan een gemeten woord: accentkleur met stippellijn. */}
      {words.map((w, i) => (
        <span key={i}>
          <span
            data-w={w.w}
            data-estimated={i === activeWord && estimated ? "true" : undefined}
            className={`hymn-word ${i === activeWord ? (estimated ? "font-bold text-vs-accent underline decoration-dotted decoration-2 underline-offset-4" : "font-bold text-vs-accent") : wholeLine ? "text-vs-accent" : ""}`}
          >
            {w.w}
          </span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

export default function LyricsView({ text, stanza, cursor, view, size, focus, reading, onLineTap, nextStanza }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  useStanzaAnchor(rootRef, stanza?.n ?? null);
  const seq = lyricSequence(text, stanza);
  const active = activeSeq(seq, cursor);
  const karaoke = view === "karaoke";

  const lines = seq.map((entry, at) => {
    const isMusic = entry.seq === active;
    const isReading = reading === entry.seq;
    const isFocus = entry.seq === focus;
    const linking = entry.section === "verse" ? stanza?.linking : text.chorus?.linking;
    const word = isMusic ? activeWordFor(entry, cursor, stanza, text) : null;
    const newSection = entry.section !== seq[at - 1]?.section;
    const heading =
      newSection && (!karaoke || entry.section === "chorus") ? (
        <h3 key={`h-${entry.seq}`} className={`mb-0.5 mt-4 text-xs font-bold uppercase tracking-wider text-vs-fg-3 first:mt-0 ${karaoke ? "text-center" : ""}`}>
          {entry.section === "verse" ? `${COPY.stanzaLabel} ${stanza?.n ?? ""}` : COPY.chorus}
        </h3>
      ) : null;
    const tap = onLineTap ? () => onLineTap(entry.seq) : undefined;
    if (karaoke) {
      const tone = isFocus ? `${KARAOKE_CURRENT[size]} font-semibold` : KARAOKE_OTHER[size];
      const color = isMusic ? "text-vs-accent" : isFocus ? "text-vs-fg" : "text-vs-fg-2";
      return (
        <div key={entry.seq}>
          {heading}
          <p
            data-seq={entry.seq}
            data-reading={isReading ? "true" : undefined}
            data-focus={isFocus ? "true" : undefined}
            aria-current={isMusic ? "true" : undefined}
            onClick={tap}
            className={`vs-wrap -mx-2 max-w-full rounded-xl px-2 py-1.5 leading-snug ${tone} ${color} ${isReading ? "bg-vs-subtle" : ""}`}
          >
            <Words entry={entry} activeWord={word} linking={linking} lineActive={isMusic} estimated={Boolean(cursor?.estimated)} />
          </p>
        </div>
      );
    }
    return (
      <div key={entry.seq}>
        {heading}
        <p
          data-seq={entry.seq}
          data-reading={isReading ? "true" : undefined}
          aria-current={isMusic ? "true" : undefined}
          onClick={tap}
          className={`vs-wrap rounded-lg border-l-[3px] py-0.5 pl-3 leading-normal ${STANZA_SIZE[size]} ${
            isMusic ? "border-vs-accent/50 text-vs-fg" : "border-transparent text-vs-fg-2"
          } ${isReading ? "bg-vs-subtle" : ""}`}
        >
          <Words entry={entry} activeWord={word} linking={linking} lineActive={isMusic} estimated={Boolean(cursor?.estimated)} />
        </p>
      </div>
    );
  });

  if (karaoke) {
    // Boven en onder ruimte, zodat ook de eerste en de laatste regel op de leesplek (40% van de hoogte) kunnen staan.
    // Bovenaan weinig ruimte (de actieve regel staat hoog, zie useReadingScroll), onderaan genoeg voor de komende regels en het volgende couplet.
    const ahead = nextStanza ? nextStanza.lines.slice(0, KARAOKE_PREVIEW_LINES) : [];
    return (
      <div ref={rootRef} className="space-y-0.5 pb-[40dvh] pt-[14dvh] text-center" data-hymns-karaoke aria-label={`${COPY.stanzaLabel} ${stanza?.n ?? ""}`}>
        <div data-stanza-block={stanza?.n ?? 0}>{lines}</div>
        {nextStanza && ahead.length > 0 ? (
          <div data-stanza-block={nextStanza.n} data-hymns-preview className="pt-4" aria-label={`${COPY.nextStanza} ${nextStanza.n}`}>
            <h3 className="mb-0.5 text-xs font-bold uppercase tracking-wider text-vs-fg-3">
              {COPY.nextStanza} {nextStanza.n}
            </h3>
            {ahead.map((l, i) => (
              <p key={i} className={`vs-wrap -mx-2 max-w-full px-2 py-1 leading-snug text-vs-fg-3 ${KARAOKE_OTHER[size]}`}>
                {l.text}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div ref={rootRef} className="space-y-0.5 pb-3" data-hymns-stanza>
      <div data-stanza-block={stanza?.n ?? 0}>{lines}</div>
      {nextStanza ? (
        <div data-stanza-block={nextStanza.n} data-hymns-preview className="pt-5" aria-label={`${COPY.nextStanza} ${nextStanza.n}`}>
          <h3 className="mb-0.5 text-xs font-bold uppercase tracking-wider text-vs-fg-3">
            {COPY.nextStanza} {nextStanza.n}
          </h3>
          {nextStanza.lines.map((l, i) => (
            <p key={i} className={`vs-wrap border-l-[3px] border-transparent py-0.5 pl-3 leading-normal text-vs-fg-3 ${STANZA_SIZE[size]}`}>
              {l.text}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Scrollcontinuïteit bij een couplet dat vanzelf doorschakelt: het volgende couplet stond al onder het huidige in dezelfde leesruimte
 * en wordt nu het huidige, terwijl het oude couplet (bovenin) verdwijnt. Zonder compensatie zou de tekst daardoor één coupletlengte
 * omhoog springen. We meten de blokken in inhoudscoördinaten (onafhankelijk van het scrollen) en schuiven de scrollpositie precies zoveel
 * op dat het nieuwe huidige couplet visueel op dezelfde plek blijft (Safari heeft geen eigen scroll anchoring).
 * Past alles in het scherm (er valt niets te scrollen), dan blijft er een verschuiving over: die glijdt in 0,45 s naar zijn nieuwe plek in
 * plaats van te springen (FLIP via de Web Animations API; bij verminderde beweging gebeurt het direct).
 */
function useStanzaAnchor(rootRef: React.RefObject<HTMLElement | null>, stanza: number | null): void {
  const offsets = useRef(new Map<number, number>());
  const scrollAtCommit = useRef(0);
  const previous = useRef<number | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const box = root?.closest<HTMLElement>("[data-hymns-scroll]") ?? null;
    if (!root || !box) return;
    const measure = () => {
      const boxTop = box.getBoundingClientRect().top;
      const next = new Map<number, number>();
      root.querySelectorAll<HTMLElement>("[data-stanza-block]").forEach((el) => {
        next.set(Number(el.getAttribute("data-stanza-block")), el.getBoundingClientRect().top - boxTop + box.scrollTop);
      });
      return next;
    };
    const scrollBefore = scrollAtCommit.current;
    const now = measure();
    if (previous.current !== null && stanza !== null && previous.current !== stanza) {
      const before = offsets.current.get(stanza);
      const after = now.get(stanza);
      if (before !== undefined && after !== undefined && Math.abs(after - before - (box.scrollTop - scrollBefore)) > 1) {
        const visualBefore = before - scrollBefore;
        box.scrollTop = Math.max(0, scrollBefore + (after - before));
        const visualAfter = after - box.scrollTop;
        const rest = visualBefore - visualAfter;
        const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        if (Math.abs(rest) > 1 && !reduce && typeof root.animate === "function") {
          root.animate([{ transform: `translateY(${rest}px)` }, { transform: "translateY(0)" }], { duration: 450, easing: "ease-out" });
        }
        previous.current = stanza;
        offsets.current = measure();
        scrollAtCommit.current = box.scrollTop;
        return;
      }
    }
    previous.current = stanza;
    offsets.current = now;
    scrollAtCommit.current = box.scrollTop;
  });
  // de scrollpositie bijhouden tussen twee renders (de browser kan hem bij krimpende inhoud al aanpassen voordat wij meten)
  useLayoutEffect(() => {
    const box = rootRef.current?.closest<HTMLElement>("[data-hymns-scroll]") ?? null;
    if (!box) return;
    const onScroll = () => {
      scrollAtCommit.current = box.scrollTop;
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => box.removeEventListener("scroll", onScroll);
  }, [rootRef]);
}
