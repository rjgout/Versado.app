// Notatielaag van Lofzangen: wat nodig is om een partituur te graveren, naast (en los van) de analysegegevens waarmee herkend
// en gevolgd wordt (HymnComposition). Dezelfde PDF-extractie levert beide; de bouw (scripts/hymns/build_nld_notation.py)
// controleert dat ze dezelfde noten beschrijven. Niets hier wordt gegokt: wat de extractor niet kon vaststellen ontbreekt.
//
// Vijf lagen, bewust gescheiden (zie docs/hymns/18-BLADMUZIEK.md):
//   1. analysegegevens (HymnComposition, types.ts)       herkennen en volgen
//   2. notatie (HymnNotation, dit bestand)               graveren
//   3. coupletteksten (HymnText)                         woorden en regels
//   4. lettergreep-naar-noot (link/NNN.json)             tekst onder de noten
//   5. positiemapping (measureMap.ts)                    muzikale beat -> zichtbare maat

export const NOTATION_VERSION = 1;

/** [beat, duur, midiNoot, balk (0 G, 1 F), diatonische stap, wijziging, stokrichting (0 omhoog, 1 omlaag, 2 geen), voorteken, balken, punten, basisduur] */
export type RawNotationNote = readonly [number, number, number, 0 | 1, number, number, 0 | 1 | 2, number | null, number[], number, number];

export interface RawHymnNotation {
  v: number;
  compositionId: string;
  pdfSha: string;
  extractor: string;
  /** Voortekens: + kruisen, - mollen. */
  fifths: number;
  pickup: unknown;
  /** [beat van de maat, lengte in beats, teller, noemer] */
  measures: [number, number, number, number][];
  fermatas: number[];
  /** [beat, balk, 1 = onder de noot] */
  fermataMarks: [number, 0 | 1, 0 | 1][];
  notes: RawNotationNote[];
  /** [beat, duur, balk] */
  rests: [number, number, 0 | 1][];
  /** Overbinding: [beat1, midi, balk, beat2, midi2] */
  ties: [number, number, number, number, number][];
  /** Legatoboog: [beat1, midi1, balk, beat2, midi2] */
  slurs: [number, number, number, number, number][];
  unresolvedCurves: number;
}

export interface NotationNote {
  t: number;
  dur: number;
  midi: number;
  staff: 0 | 1;
  /** Diatonische stap: octaaf * 7 + (C=0 ... B=6). */
  dia: number;
  alt: number;
  /** null = geen stok (hele noot) */
  stem: "up" | "down" | null;
  /** Voorteken dat in de bron getekend staat: -1 mol, 0 herstellingsteken, 1 kruis. */
  accidental: number | null;
  beams: number[];
  dots: number;
  base: number;
}

export interface NotationMeasure {
  index: number;
  start: number;
  length: number;
  beats: number;
  beatType: number;
}

export interface HymnNotation {
  version: number;
  compositionId: string;
  pdfSha: string;
  fifths: number;
  measures: NotationMeasure[];
  notes: NotationNote[];
  rests: { t: number; dur: number; staff: 0 | 1 }[];
  fermatas: { t: number; staff: 0 | 1; inverted: boolean }[];
  ties: { t: number; midi: number; staff: 0 | 1; toT: number; toMidi: number }[];
  slurs: { t: number; midi: number; staff: 0 | 1; toT: number; toMidi: number }[];
  unresolvedCurves: number;
}

/** Eén lettergreep onder een noot: de beat is die van de noot in de bovenstem van de G-balk. */
export interface SheetSyllable {
  beat: number;
  text: string;
  /** Plaats binnen het woord (MusicXML): bepaalt het koppelteken tussen lettergrepen. */
  syllabic: "single" | "begin" | "middle" | "end";
}

export type SheetValidationStatus = "ok" | "geen-tekstkoppeling" | "mislukt";

export interface SheetProblem {
  code: string;
  message: string;
}

export interface SheetStanzaStatus {
  n: number;
  status: SheetValidationStatus;
  /** Code van het eerste probleem (alleen voor de technische weergave), of null. */
  reason: string | null;
  /** Lettergrepen van couplet en refrein samen; null als er geen betrouwbare koppeling is (dan geen tekst onder de noten). */
  lyrics: SheetSyllable[] | null;
}

/** Wat de server voor de bladmuziek van één lofzang levert. */
export interface SheetData {
  number: number;
  notation: RawHymnNotation;
  stanzas: SheetStanzaStatus[];
  chorus: { linked: boolean } | null;
}
