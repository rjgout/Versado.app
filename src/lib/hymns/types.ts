// Datamodel voor Lofzangen (proof of concept). Bewust vijf losse lagen, zodat het nieuwe
// wereldwijde zangboek en andere talen later kunnen worden toegevoegd zonder iets te herbouwen:
//
//   1. HymnComposition  - de muzikale compositie (noten, maten, vorm), taalonafhankelijk
//   2. HymnText         - de tekst in één taal, gekoppeld aan een compositie (+ tekst-naar-nootkoppeling)
//   3. HymnbookEdition  - een zangboekuitgave (taal + lijst van nummers)
//   4. HymnbookEntry    - het nummer van een lofzang binnen die uitgave
//   5. herkenningsgegevens (referentiechroma, onsets) worden AFGELEID van de compositie en nooit
//      opgeslagen als bron; zie score/reference.ts.
//
// Een compositie en een tekst delen nooit een id: dezelfde melodie kan onder meerdere nummers of
// talen voorkomen en dezelfde tekst kan in een nieuwe uitgave onder een ander nummer staan.

/** [startBeat, duurInBeats, midiNoot, balk] met balk 0 = G-sleutel, 1 = F-sleutel. Beat = kwartnoot. */
export type NoteTuple = readonly [number, number, number, 0 | 1];

export type SectionId = "verse" | "chorus";

export interface HymnSection {
  id: SectionId;
  startBeat: number;
  endBeat: number;
}

export interface HymnComposition {
  /** Stabiele interne id. Gebaseerd op de taalonafhankelijke officiële slug, bv. "comp:praise-to-the-man". */
  id: string;
  officialSlug: string;
  timeSignature: [number, number];
  beatsPerBar: number;
  /** Aanwijzing van de kerk in kwartnoten per minuut (laag, hoog); alleen een voorkeur, geen eis. */
  tempoQuarterBpm: [number, number] | null;
  keySignature: Record<string, number>;
  /** Beat waarop elke maat begint (de eerste maat kan een opmaat zijn). */
  measureStarts: number[];
  totalBeats: number;
  /** Eerst het couplet, dan (optioneel) het refrein; samen vormen ze één cyclus. */
  sections: HymnSection[];
  /** Beats waar een fermate staat. */
  fermatas: number[];
  notes: NoteTuple[];
  musicCredit: string | null;
}

export interface LinkedSyllable extends Array<string | number> {
  0: string;
  1: number;
}

export interface HymnWord {
  /** De tekst zoals de officiële pagina die geeft. */
  w: string;
  /** Beat waarop het woord begint, of null als er voor dit woord geen betrouwbare koppeling is. */
  b: number | null;
  /** Lettergrepen met hun beat: [tekst, beat]. */
  syl?: [string, number][];
}

export interface HymnLine {
  text: string;
  words: HymnWord[];
  /** Beat waarop de regel begint (voor coupletten zonder eigen notenbalk: die van couplet 1). */
  startBeat: number | null;
}

export interface HymnStanza {
  n: number;
  /** "word": lettergrepen zijn aan noten gekoppeld; "line": alleen de frasering van couplet 1. */
  linking: "word" | "line";
  lines: HymnLine[];
}

export interface HymnText {
  id: string;
  compositionId: string;
  language: string;
  title: string;
  tempoLabel: string | null;
  textCredit: string | null;
  scriptureRefs: string[];
  stanzas: HymnStanza[];
  chorus: { linking: "word" | "line"; lines: HymnLine[] } | null;
}

export interface HymnbookEntry {
  number: number;
  textId: string;
  compositionId: string;
}

export interface HymnbookEdition {
  id: string;
  language: string;
  title: string;
  sourceUrl: string;
  entries: HymnbookEntry[];
}

export interface HymnLibrary {
  schemaVersion: number;
  rights: string;
  edition: HymnbookEdition;
  compositions: HymnComposition[];
  texts: HymnText[];
}

/** Een lofzang zoals de UI hem nodig heeft: uitgave-nummer + tekst + compositie. */
export interface ResolvedHymn {
  number: number;
  edition: HymnbookEdition;
  text: HymnText;
  composition: HymnComposition;
}
