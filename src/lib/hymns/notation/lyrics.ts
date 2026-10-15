import type { SheetProblem, SheetSyllable } from "./types";

// De lettergrepen onder de noten komen uit de koppeling (link/NNN.json), per couplet en per refrein. Elke lettergreep heeft de
// beat van de dichtstbijzijnde notenkolom, bepaald bij de import en gecontroleerd tegen de officiële tekst. Hier worden ze
// alleen omgezet naar de vorm voor het graveren; er wordt nooit een lettergreep bijgemaakt of verschoven.

export interface LinkLineLike {
  start: number | null;
  words: (number | null)[];
  syl: ([string, number][] | null)[];
}
export interface LinkPartLike { linking: "word" | "line"; lines: LinkLineLike[] }
export interface LinkStanzaLike extends LinkPartLike { n: number }

export interface StanzaLyrics {
  /** null als er voor dit couplet geen betrouwbare lettergreep-naar-nootkoppeling is. */
  syllables: SheetSyllable[] | null;
  problems: SheetProblem[];
}

/** Lettergrepen van een couplet of refrein, op volgorde, met dezelfde-beat-lettergrepen samengevoegd (elisie: twee lettergrepen op één noot). */
export function syllablesOf(part: LinkPartLike | null | undefined): StanzaLyrics {
  const problems: SheetProblem[] = [];
  if (!part) return { syllables: null, problems: [{ code: "geen-koppeling", message: "Geen koppeling aan de noten" }] };
  if (part.linking !== "word") return { syllables: null, problems: [{ code: "regelkoppeling", message: "Alleen de regelstart is gekoppeld, geen lettergrepen" }] };
  const raw: SheetSyllable[] = [];
  for (const line of part.lines) {
    for (const word of line.syl) {
      if (!word || !word.length) return { syllables: null, problems: [{ code: "woord-zonder-koppeling", message: "Een woord heeft geen lettergreepkoppeling" }] };
      word.forEach(([text, beat], i) => {
        raw.push({ beat, text, syllabic: word.length === 1 ? "single" : i === 0 ? "begin" : i === word.length - 1 ? "end" : "middle" });
      });
    }
  }
  const merged: SheetSyllable[] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && s.beat < last.beat - 1e-6) return { syllables: null, problems: [{ code: "volgorde", message: `Lettergrepen niet oplopend bij beat ${s.beat}` }] };
    if (last && Math.abs(last.beat - s.beat) < 1e-6) { merged[merged.length - 1] = { beat: last.beat, text: `${last.text} ${s.text}`, syllabic: s.syllabic }; continue; }
    merged.push({ ...s });
  }
  return { syllables: merged, problems };
}
