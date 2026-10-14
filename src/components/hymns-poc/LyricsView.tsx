"use client";

import type { RefObject } from "react";
import type { DisplayCursor } from "@/lib/hymns/follow/display";
import type { HymnStanza, HymnText } from "@/lib/hymns/types";
import type { HymnTextSize, HymnView } from "@/lib/hymnPrefs";
import { COPY } from "./copy";
import { activeSeq, activeWordFor, karaokeWindow, lyricSequence, type LyricLine } from "./viewModel";

// De lofzangtekst: het enige waar het scherm om draait. Twee weergaven op dezelfde gegevens (de muziekengine
// weet niets van de weergave): een volledig couplet met subtiele nadruk op de actieve regel, of karaoke per
// regel met de actuele regel groot en vast in het midden. Het actieve woord krijgt de accentkleur en een
// zwaarder lettergewicht; de breedte is vooraf gereserveerd (.hymn-word) zodat er niets verschuift.

const STANZA_SIZE: Record<HymnTextSize, string> = { normal: "text-xl", large: "text-2xl", xlarge: "text-3xl" };
const KARAOKE_CURRENT: Record<HymnTextSize, string> = { normal: "text-3xl", large: "text-4xl", xlarge: "text-5xl" };
const KARAOKE_NEIGHBOR: Record<HymnTextSize, string> = { normal: "text-lg", large: "text-xl", xlarge: "text-2xl" };

interface Props {
  text: HymnText;
  stanza: HymnStanza | undefined;
  cursor: DisplayCursor | undefined;
  view: HymnView;
  size: HymnTextSize;
  /** Wordt aan de actieve regel gehangen. */
  activeRef: RefObject<HTMLParagraphElement | null>;
}

function Words({ entry, activeWord, linking, lineActive }: { entry: LyricLine; activeWord: number | null; linking: "word" | "line" | undefined; lineActive: boolean }) {
  const words = entry.line.words;
  // Zonder betrouwbare woordkoppeling: de hele actieve regel krijgt de accentkleur, nooit een verzonnen woord.
  const wholeLine = lineActive && activeWord === null && linking !== "word";
  if (words.length === 0) return <span className={wholeLine ? "font-semibold text-vs-accent" : undefined}>{entry.line.text}</span>;
  return (
    <>
      {words.map((w, i) => (
        <span key={i}>
          <span data-w={w.w} className={`hymn-word ${i === activeWord ? "font-bold text-vs-accent" : wholeLine ? "text-vs-accent" : ""}`}>
            {w.w}
          </span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

export default function LyricsView({ text, stanza, cursor, view, size, activeRef }: Props) {
  const seq = lyricSequence(text, stanza);
  const active = activeSeq(seq, cursor);

  if (view === "karaoke") {
    const win = karaokeWindow(seq, active);
    const render = (entry: LyricLine | null, className: string, isCurrent: boolean) => {
      if (!entry) return null;
      const word = isCurrent ? activeWordFor(entry, cursor, stanza, text) : null;
      const linking = entry.section === "verse" ? stanza?.linking : text.chorus?.linking;
      return (
        <p key={entry.seq} className={`vs-wrap max-w-full leading-snug ${className}`} aria-current={isCurrent && !win.ready ? "true" : undefined}>
          <Words entry={entry} activeWord={word} linking={linking} lineActive={isCurrent && !win.ready} />
        </p>
      );
    };
    return (
      // De actuele regel staat in het midden van de leesruimte: twee gelijke buitenrijen (1fr) en een rij naar maat.
      // De buren staan er vlak tegenaan met een vaste afstand en worden bij lange regels afgekapt, zodat ze nooit
      // ver weg staan of de actuele regel verdringen.
      <div className="grid min-h-full grid-rows-[1fr_auto_1fr] gap-3 text-center" data-hymns-karaoke aria-label={`${COPY.stanzaLabel} ${stanza?.n ?? ""}`}>
        <div className="flex items-end justify-center overflow-hidden">{render(win.previous, `${KARAOKE_NEIGHBOR[size]} line-clamp-2 text-vs-fg-3`, false)}</div>
        <div className="flex justify-center" data-hymns-karaoke-current>
          {render(win.current, `${KARAOKE_CURRENT[size]} ${win.ready ? "text-vs-fg-2" : "text-vs-fg"}`, true)}
        </div>
        <div className="flex items-start justify-center overflow-hidden">{render(win.next, `${KARAOKE_NEIGHBOR[size]} line-clamp-2 text-vs-fg-3`, false)}</div>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 pb-3" data-hymns-stanza>
      {seq.map((entry, at) => {
        const isActive = entry.seq === active;
        const heading =
          entry.section !== seq[at - 1]?.section ? (
            <h3 key={`h-${entry.seq}`} className="mb-0.5 mt-4 text-xs font-bold uppercase tracking-wider text-vs-fg-3 first:mt-0">
              {entry.section === "verse" ? `${COPY.stanzaLabel} ${stanza?.n ?? ""}` : COPY.chorus}
            </h3>
          ) : null;
        const linking = entry.section === "verse" ? stanza?.linking : text.chorus?.linking;
        return (
          <div key={entry.seq}>
            {heading}
            <p
              ref={isActive ? activeRef : undefined}
              aria-current={isActive ? "true" : undefined}
              className={`vs-wrap border-l-[3px] py-0.5 pl-3 leading-normal ${STANZA_SIZE[size]} ${isActive ? "border-vs-accent/50 text-vs-fg" : "border-transparent text-vs-fg-2"}`}
            >
              <Words entry={entry} activeWord={isActive ? activeWordFor(entry, cursor, stanza, text) : null} linking={linking} lineActive={isActive} />
            </p>
          </div>
        );
      })}
    </div>
  );
}
