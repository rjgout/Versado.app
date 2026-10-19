import type { HymnNotation } from "../notation/types";
import type { HymnComposition } from "../types";

// Melodiereconstructie: de zangmelodie (sopraan) uit een meerstemmige partituur halen, zodat een solist die alleen de melodie zingt
// tegen de juiste referentie wordt vergeleken (en niet tegen alle instrumentale stemmen).
//
// De analysegegevens (`NoteTuple`) bewaren alleen de balk (G of F), niet welke stem een noot is. De notatielaag bewaart wel de
// stokrichting: in een vierstemmige zetting staat de sopraan met de stok omhoog en de alt met de stok omlaag, samen in de G-balk.
// Daarom is de melodie hier: per beginmoment de noot met de stok omhoog in de G-balk. Dit wordt nooit gegokt:
//  - de uitkomst wordt gecontroleerd tegen de "hoogste noot"-regel, tegen gaten en overlap in de lijn, en tegen de beats waarop
//    een lettergreep begint (elke lettergreep moet op een melodienoot beginnen);
//  - bij twijfel is de status "uncertain" en wordt de melodie NIET gebruikt voor herkenning met alleen de melodie.

export type MelodyStatus = "ok" | "uncertain";

export type MelodyReason =
  | "geen-notatie"
  | "stokrichting-ontbreekt"
  | "stemmen-wijken-af"
  | "gaten-of-overlap"
  | "lettergrepen-niet-op-melodienoot"
  | "te-weinig-noten"
  | "sprongen";

export interface MelodyNote {
  /** [beginbeat, duur in beats, midinoot] */
  0: number;
  1: number;
  2: number;
}

export interface MelodyResult {
  compositionId: string;
  status: MelodyStatus;
  reasons: MelodyReason[];
  /** De melodie (alleen betrouwbaar bij status "ok"; anders de beste schatting, uitsluitend voor diagnose). */
  notes: [number, number, number][];
  /** Aandeel beginmomenten waarop de stok-omhoog-noot de hoogste noot van de G-balk is. */
  topAgreement: number;
  /** Aandeel lettergrepen (couplet 1) dat op een melodienoot begint; null zonder tekstkoppeling. */
  syllableAnchors: number | null;
  /** Aandeel van de cyclus waarin de melodie klinkt. */
  coverage: number;
}

const EPS = 1e-6;

export interface MelodyOptions {
  /** Beats waarop lettergrepen van couplet 1 beginnen (uit de tekstkoppeling); leeg of weggelaten = geen controle. */
  syllableBeats?: number[];
  minTopAgreement?: number;
  minAnchors?: number;
  minCoverage?: number;
  maxLeapShare?: number;
}

/** Rekent de melodie van één compositie uit. Zonder notatie wordt nooit een melodie "ok". */
export function reconstructMelody(comp: HymnComposition, notation: HymnNotation | null, options: MelodyOptions = {}): MelodyResult {
  const minTop = options.minTopAgreement ?? 0.9;
  const minAnchors = options.minAnchors ?? 0.98;
  const minCoverage = options.minCoverage ?? 0.85;
  const maxLeap = options.maxLeapShare ?? 0.12;
  const reasons: MelodyReason[] = [];
  const empty = (why: MelodyReason): MelodyResult => ({ compositionId: comp.id, status: "uncertain", reasons: [why], notes: [], topAgreement: 0, syllableAnchors: null, coverage: 0 });
  if (!notation) return empty("geen-notatie");
  const treble = notation.notes.filter((n) => n.staff === 0);
  if (treble.length === 0) return empty("te-weinig-noten");
  if (treble.every((n) => n.stem === null)) return empty("stokrichting-ontbreekt");

  const byOnset = new Map<number, typeof treble>();
  for (const n of treble) {
    const key = Math.round(n.t * 1000) / 1000;
    byOnset.set(key, [...(byOnset.get(key) ?? []), n]);
  }
  const onsets = [...byOnset.keys()].sort((a, b) => a - b);
  const melody: [number, number, number][] = [];
  let agree = 0;
  let stemmed = 0;
  let skipped = 0;
  for (const t of onsets) {
    const group = byOnset.get(t)!;
    const top = group.reduce((a, b) => (b.midi > a.midi ? b : a));
    const up = group.filter((n) => n.stem === "up");
    const prev = melody[melody.length - 1];
    let pick = top;
    if (up.length >= 1) {
      pick = up.reduce((a, b) => (b.midi > a.midi ? b : a));
      stemmed += 1;
    } else if (prev && prev[0] + prev[1] > t + 0.02) {
      // Alleen een stok-omlaag-noot (alt) terwijl de sopraan nog een lange noot houdt: dit is geen nieuw melodiemoment.
      skipped += 1;
      continue;
    } // anders: stokloze noten (bv. een hele noot met alt) of een sopraan zonder stok-omhoog -> hoogste noot
    if (pick.midi === top.midi) agree += 1;
    melody.push([t, pick.dur, pick.midi]);
  }
  const topAgreement = agree / Math.max(1, onsets.length - skipped);
  if (topAgreement < minTop) reasons.push("stemmen-wijken-af");
  if (stemmed / Math.max(1, onsets.length - skipped) < 0.5) reasons.push("stokrichting-ontbreekt");

  // Gaten en overlap: één melodielijn heeft geen noten die over elkaar heen liggen; een rust is toegestaan als ze kort is.
  let bad = 0;
  for (let i = 0; i + 1 < melody.length; i += 1) {
    const end = melody[i][0] + melody[i][1];
    const next = melody[i + 1][0];
    if (end - next > 0.02 || next - end > 2.01) bad += 1; // overlap, of een rust langer dan twee beats zonder dat het een einde van een zin lijkt
  }
  if (bad / Math.max(1, melody.length) > 0.06) reasons.push("gaten-of-overlap");

  // Sprongen groter dan een octaaf zijn in een zangmelodie onwaarschijnlijk (stemverwisseling).
  let leaps = 0;
  for (let i = 0; i + 1 < melody.length; i += 1) if (Math.abs(melody[i + 1][2] - melody[i][2]) > 12) leaps += 1;
  if (leaps / Math.max(1, melody.length) > maxLeap) reasons.push("sprongen");

  // Een melodielijn is monofoon: een lange sopraannoot die nog klinkt als de volgende begint (de alt beweegt, of een overbinding) wordt
  // bij de volgende noot afgekapt, zodat er nooit twee melodienoten tegelijk klinken.
  for (let i = 0; i + 1 < melody.length; i += 1) {
    const room = melody[i + 1][0] - melody[i][0];
    if (melody[i][1] > room) melody[i] = [melody[i][0], room, melody[i][2]];
  }
  // Dekking: hoeveel van de cyclus klinkt de melodie?
  let covered = 0;
  let last = 0;
  for (const [t, d] of melody) {
    const from = Math.max(t, last);
    const to = Math.min(comp.totalBeats, t + d);
    if (to > from) covered += to - from;
    last = Math.max(last, to);
  }
  const coverage = covered / comp.totalBeats;
  if (coverage < minCoverage) reasons.push("gaten-of-overlap");

  // Lettergrepen: elke lettergreep van couplet 1 moet op een melodienoot beginnen. Dit is een controle op de reconstructie, geen
  // bewijs voor de melodie zelf (de lettergreepbeats komen uit dezelfde partituur).
  let syllableAnchors: number | null = null;
  const sylBeats = options.syllableBeats ?? [];
  if (sylBeats.length >= 8) {
    const starts = new Set(melody.map((m) => Math.round(m[0] * 1000)));
    syllableAnchors = sylBeats.filter((b) => starts.has(Math.round(b * 1000))).length / sylBeats.length;
    if (syllableAnchors < minAnchors) reasons.push("lettergrepen-niet-op-melodienoot");
  }
  if (melody.length < 12) reasons.push("te-weinig-noten");
  void EPS;
  return {
    compositionId: comp.id,
    status: reasons.length === 0 ? "ok" : "uncertain",
    reasons: [...new Set(reasons)],
    notes: melody,
    topAgreement,
    syllableAnchors,
    coverage,
  };
}

/** Een compositie met alleen de melodie, voor referentie en voorfilter (zelfde vorm; alles op balk 0). */
export function melodyComposition(comp: HymnComposition, melody: MelodyResult): HymnComposition | null {
  if (melody.status !== "ok") return null;
  return { ...comp, id: `${comp.id}#melody`, notes: melody.notes.map(([t, d, m]) => [t, d, m, 0] as const) };
}
