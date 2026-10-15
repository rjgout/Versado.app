import type { HymnNotation, NotationNote, RawHymnNotation } from "./types";
import { NOTATION_VERSION } from "./types";

/** Zet de compacte bestandsvorm om in leesbare objecten. Een onbekende versie wordt geweigerd (geen gok over andere velden). */
export function decodeNotation(raw: RawHymnNotation): HymnNotation {
  if (raw.v !== NOTATION_VERSION) throw new Error(`Onbekende notatieversie ${raw.v}`);
  const notes: NotationNote[] = raw.notes.map((n) => ({
    t: n[0], dur: n[1], midi: n[2], staff: n[3], dia: n[4], alt: n[5],
    stem: n[6] === 0 ? "up" : n[6] === 1 ? "down" : null,
    accidental: n[7], beams: n[8], dots: n[9], base: n[10],
  }));
  return {
    version: raw.v,
    compositionId: raw.compositionId,
    pdfSha: raw.pdfSha,
    fifths: raw.fifths,
    measures: raw.measures.map((m, index) => ({ index, start: m[0], length: m[1], beats: m[2], beatType: m[3] })),
    notes,
    rests: raw.rests.map((r) => ({ t: r[0], dur: r[1], staff: r[2] })),
    fermatas: raw.fermataMarks.map((f) => ({ t: f[0], staff: f[1], inverted: f[2] === 1 })),
    ties: raw.ties.map((x) => ({ t: x[0], midi: x[1], staff: x[2] as 0 | 1, toT: x[3], toMidi: x[4] })),
    slurs: raw.slurs.map((x) => ({ t: x[0], midi: x[1], staff: x[2] as 0 | 1, toT: x[3], toMidi: x[4] })),
    unresolvedCurves: raw.unresolvedCurves,
  };
}
