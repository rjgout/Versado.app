"use client";

import type { DisplayCursor } from "@/lib/hymns/follow/display";
import type { HymnStanza, HymnText } from "@/lib/hymns/types";
import type { HymnTextSize, HymnView } from "@/lib/hymnPrefs";
import { COPY } from "./copy";
import { activeSeq, activeWordFor, lyricSequence, type LyricLine } from "./viewModel";

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

export default function LyricsView({ text, stanza, cursor, view, size, focus, reading, onLineTap }: Props) {
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
            <Words entry={entry} activeWord={word} linking={linking} lineActive={isMusic} />
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
          <Words entry={entry} activeWord={word} linking={linking} lineActive={isMusic} />
        </p>
      </div>
    );
  });

  if (karaoke) {
    // Boven en onder ruimte, zodat ook de eerste en de laatste regel op de leesplek (40% van de hoogte) kunnen staan.
    return (
      <div className="space-y-0.5 pb-[34dvh] pt-[26dvh] text-center" data-hymns-karaoke aria-label={`${COPY.stanzaLabel} ${stanza?.n ?? ""}`}>
        {lines}
      </div>
    );
  }
  return (
    <div className="space-y-0.5 pb-3" data-hymns-stanza>
      {lines}
    </div>
  );
}
