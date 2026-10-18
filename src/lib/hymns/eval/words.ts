import type { FollowSnapshot } from "../follow/session";
import type { HymnText } from "../types";
import type { SynthResult } from "./synth";

// Meting op woordniveau: welk woord markeert de engine, en wanneer, ten opzichte van de exacte tijdlijn van een synthetische opname?
// De waarheid is het tijdstip waarop de synthese de noot van een woord laat beginnen (`HymnWord.b`, via synth.timeAt). Dat is een
// ondergrens voor wat een luisteraar als "het woord wordt gezongen" ervaart; voor echte opnamen is handmatige annotatie nodig.

export interface WordTruth {
  /** Plek in de stanza: regel en woord binnen de regel. */
  line: number;
  word: number;
  text: string;
  beat: number;
  /** Tijdstip (s) waarop het woord begint in de opname. */
  start: number;
}

/** De woorden van het eerste couplet met een koppeling aan de muziek, in zangvolgorde, met hun exacte starttijd. */
export function wordTruth(text: HymnText, synth: Pick<SynthResult, "timeAt">, stanza = 1): WordTruth[] {
  const st = text.stanzas.find((s) => s.n === stanza);
  if (!st || st.linking !== "word") return [];
  const out: WordTruth[] = [];
  st.lines.forEach((l, li) =>
    l.words.forEach((w, wi) => {
      if (w.b !== null) out.push({ line: li, word: wi, text: w.w, beat: w.b, start: synth.timeAt(w.b) });
    }),
  );
  return out.sort((a, b) => a.start - b.start);
}

export interface WordMetrics {
  words: number;
  /** Aandeel woorden dat ooit gemarkeerd is binnen de meting. */
  marked: number;
  /** Vertraging van de markering na het begin van het woord (ms): negatief = de markering liep voor. Mediaan en 90e percentiel. */
  delayMedianMs: number | null;
  delayP90Ms: number | null;
  /** Aandeel van de zangtijd waarin de markering precies op het juiste woord staat, en binnen één woord. */
  exact: number;
  withinOne: number;
  /** Aandeel van de zangtijd waarin de markering vóór het zingende woord loopt (de markering mag nooit voorlopen op de zang). */
  ahead: number;
  /** Aandeel van de zangtijd waarin er (nog) geen markering was terwijl er al gezongen werd. */
  none: number;
  /** Tijd (s) tussen het eerste woord en de eerste markering; null = nooit. */
  firstMarkSeconds: number | null;
}

function quant(a: number[], p: number): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

/**
 * Vergelijkt de markering per snapshot met de waarheid. Alleen frames binnen de zang van het couplet tellen
 * (van het eerste woord tot het laatste woord plus `tailSeconds`) en alleen als de cursor in het couplet staat (niet in het refrein).
 */
export function evaluateWords(snaps: Pick<FollowSnapshot, "time" | "cursor">[], truth: WordTruth[], options: { tailSeconds?: number } = {}): WordMetrics {
  const tail = options.tailSeconds ?? 0.5;
  const idxOf = new Map<string, number>(truth.map((t, i) => [`${t.line}:${t.word}`, i]));
  const first = truth[0]?.start ?? 0;
  const last = (truth[truth.length - 1]?.start ?? 0) + tail;
  let frames = 0;
  let exact = 0;
  let within = 0;
  let ahead = 0;
  let none = 0;
  const reach = new Array<number | null>(truth.length).fill(null);
  let firstMark: number | null = null;
  for (const s of snaps) {
    if (s.time < first - 0.5 || s.time > last) continue;
    const c = s.cursor;
    const marked = c.section === "verse" && c.word !== null ? (idxOf.get(`${c.line}:${c.word}`) ?? null) : null;
    if (marked !== null) {
      if (firstMark === null) firstMark = s.time - first;
      for (let i = 0; i <= marked; i += 1) if (reach[i] === null) reach[i] = s.time;
    }
    if (s.time < first) continue;
    let sung = -1;
    for (let i = 0; i < truth.length && truth[i].start <= s.time; i += 1) sung = i;
    if (sung < 0) continue;
    frames += 1;
    if (marked === null) none += 1;
    else {
      if (marked === sung) exact += 1;
      if (Math.abs(marked - sung) <= 1) within += 1;
      if (marked > sung) ahead += 1;
    }
  }
  const delays = truth.flatMap((t, i) => (reach[i] === null ? [] : [(reach[i]! - t.start) * 1000]));
  return {
    words: truth.length,
    marked: truth.length ? reach.filter((r) => r !== null).length / truth.length : 0,
    delayMedianMs: quant(delays, 0.5),
    delayP90Ms: quant(delays, 0.9),
    exact: frames ? exact / frames : 0,
    withinOne: frames ? within / frames : 0,
    ahead: frames ? ahead / frames : 0,
    none: frames ? none / frames : 0,
    firstMarkSeconds: firstMark,
  };
}
