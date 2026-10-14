import type { FeatureFrame } from "../audio/features";
import type { HymnComposition } from "../types";

// Goedkope eerste ronde van de herkenning voor een bibliotheek van honderden lofzangen.
//
// Een volledige score-follower (deeltjesfilter) per lofzang is te zwaar voor een telefoon als er 200 zijn. Daarom kiest
// dit voorfilter uit de hele bibliotheek een handvol kandidaten, en volgt alleen die met de echte score-follower
// (de tweede, beslissende ronde in recognizer.ts). Het voorfilter beslist zelf nooit welke lofzang het is.
//
// Werkwijze: de laatste ~12 s gehoorde toonklassen (12 getallen per 0,19 s) worden met een subsequence-DTW vergeleken met
// de toonklassen die elke compositie per halve beat zou geven (twee cycli achter elkaar, zodat een venster over de cyclusgrens
// past). De DTW staat vertragen en versnellen toe, dus het tempo hoeft niet bekend te zijn. Eerst wordt het gemiddelde
// profiel afgetrokken, anders lijken alle lofzangen in dezelfde toonsoort op elkaar. Deze methode is op de officiële
// begeleidingsopnamen veel scherper gebleken dan het vergelijken van akkoordwisselingen (docs/hymns/12).

const PC = 12;
const STEP_BEATS = 0.5;
const FRAMES_PER_STEP = 4;
const MAX_STEPS = 64;
const STAY = 0.1;
const SKIP = 0.05;

function normalize(v: Float32Array, off = 0, len = v.length - off): void {
  let n = 0;
  for (let i = 0; i < len; i += 1) n += v[off + i] * v[off + i];
  n = Math.sqrt(n);
  if (n > 1e-9) for (let i = 0; i < len; i += 1) v[off + i] /= n;
}

/** Trekt het gemiddelde profiel af van elke rij en normaliseert opnieuw (in een kopie). */
function centered(rows: Float32Array, n: number): Float32Array {
  const mean = new Float32Array(PC);
  for (let r = 0; r < n; r += 1) for (let c = 0; c < PC; c += 1) mean[c] += rows[r * PC + c] / n;
  const out = new Float32Array(rows.length);
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < PC; c += 1) out[r * PC + c] = rows[r * PC + c] - mean[c];
    normalize(out, r * PC, PC);
  }
  return out;
}

export interface StepSequence {
  /** n x 12, gecentreerd en genormaliseerd. */
  profiles: Float32Array;
  n: number;
}

/** De toonklassen die de noten van een compositie per halve beat geven, twee cycli achter elkaar. */
export function compositionSteps(comp: HymnComposition, partials = 6): StepSequence {
  const steps = Math.max(2, Math.round(comp.totalBeats / STEP_BEATS));
  const raw = new Float32Array(steps * PC);
  for (const [t, dur, midi] of comp.notes) {
    const a = Math.floor(t / STEP_BEATS + 1e-9);
    const b = Math.min(steps, Math.max(a + 1, Math.round((t + dur) / STEP_BEATS)));
    for (let h = 1; h <= partials; h += 1) {
      const pc = (midi + Math.round(12 * Math.log2(h))) % PC;
      for (let s = a; s < b; s += 1) raw[s * PC + pc] += 1 / h;
    }
  }
  // lichte uitsmering in de tijd (0,25 0,5 0,25), zoals de gemeten stroom ook uitgesmeerd is
  const smooth = new Float32Array(raw.length);
  for (let s = 0; s < steps; s += 1) {
    const p = Math.max(0, s - 1);
    const q = Math.min(steps - 1, s + 1);
    for (let c = 0; c < PC; c += 1) smooth[s * PC + c] = 0.25 * raw[p * PC + c] + 0.5 * raw[s * PC + c] + 0.25 * raw[q * PC + c];
  }
  for (let s = 0; s < steps; s += 1) normalize(smooth, s * PC, PC);
  const doubled = new Float32Array(2 * steps * PC);
  doubled.set(smooth, 0);
  doubled.set(smooth, steps * PC);
  return { profiles: centered(doubled, 2 * steps), n: 2 * steps };
}

/** Middelt de gehoorde frames tot stappen van ~0,19 s (toonklassen, 12 getallen). */
export class AudioStepTracker {
  private readonly steps: Float32Array[] = [];
  private cur = new Float32Array(PC);
  private count = 0;

  reset(): void {
    this.steps.length = 0;
    this.cur = new Float32Array(PC);
    this.count = 0;
  }

  push(frame: FeatureFrame): void {
    if (!frame.silent) for (let c = 0; c < PC; c += 1) this.cur[c] += frame.chroma[c] + frame.chroma[c + PC];
    this.count += 1;
    if (this.count >= FRAMES_PER_STEP) {
      normalize(this.cur);
      this.steps.push(this.cur);
      if (this.steps.length > MAX_STEPS) this.steps.shift();
      this.cur = new Float32Array(PC);
      this.count = 0;
    }
  }

  /** De recente stappen (gecentreerd), of null als er nog te weinig is gehoord. */
  window(min = 24): StepSequence | null {
    const n = this.steps.length;
    if (n < min) return null;
    let sound = 0;
    for (const s of this.steps) {
      let e = 0;
      for (let c = 0; c < PC; c += 1) e += s[c] * s[c];
      if (e > 0.5) sound += 1;
    }
    if (sound < min * 0.6) return null; // te veel stilte om iets te zeggen
    const flat = new Float32Array(n * PC);
    this.steps.forEach((s, i) => flat.set(s, i * PC));
    return { profiles: centered(flat, n), n };
  }
}

/** Subsequence-DTW van een gehoord venster tegen een compositie; lagere kosten = betere overeenkomst. */
export function windowDtw(q: StepSequence, ref: StepSequence): number {
  const W = q.n;
  const M = ref.n;
  const qp = q.profiles;
  const rp = ref.profiles;
  let prev = new Float32Array(M);
  let cur = new Float32Array(M);
  for (let j = 0; j < M; j += 1) {
    let dot = 0;
    for (let c = 0; c < PC; c += 1) dot += qp[c] * rp[j * PC + c];
    prev[j] = 1 - dot;
  }
  for (let i = 1; i < W; i += 1) {
    const qo = i * PC;
    for (let j = 0; j < M; j += 1) {
      let dot = 0;
      const ro = j * PC;
      for (let c = 0; c < PC; c += 1) dot += qp[qo + c] * rp[ro + c];
      let best = prev[j] + STAY; // het gehoorde stuk verblijft op dezelfde referentiestap (trager tempo)
      if (j >= 1 && prev[j - 1] < best) best = prev[j - 1];
      if (j >= 2 && prev[j - 2] + SKIP < best) best = prev[j - 2] + SKIP; // sneller tempo
      cur[j] = 1 - dot + best;
    }
    [prev, cur] = [cur, prev];
  }
  let min = Infinity;
  for (let j = 0; j < M; j += 1) if (prev[j] < min) min = prev[j];
  return min / W;
}

export interface PrefilterRanking {
  ranking: { id: string; cost: number }[];
  /** Tijd (s) van het laatste frame van het venster waarop dit gebaseerd is. */
  time: number;
}

export class CandidatePrefilter {
  private readonly entries: { id: string; seq: StepSequence }[];
  readonly tracker = new AudioStepTracker();
  private sweep: { window: StepSequence; subset: number[]; costs: { id: string; cost: number }[]; at: number; time: number } | null = null;
  private lastCosts = new Map<string, number>();
  private sweepCount = 0;
  /** Elke `fullEvery`e ronde gaat over de hele bibliotheek; de rondes ertussen alleen over de beste `subsetSize` van de vorige. */
  fullEvery: number;
  subsetSize: number;
  private lastSweepAt = -Infinity;
  /** Hoeveel composities per aanroep worden doorgerekend; de last wordt zo over de frames verdeeld in plaats van in één piek. */
  perCall: number;
  /** Minimale tijd (s) tussen het begin van twee rondes. */
  everySeconds: number;

  constructor(candidates: { id: string; composition: HymnComposition }[], options: { perCall?: number; everySeconds?: number; fullEvery?: number; subsetSize?: number } = {}) {
    this.entries = candidates.map((c) => ({ id: c.id, seq: compositionSteps(c.composition) }));
    this.perCall = options.perCall ?? 10;
    this.everySeconds = options.everySeconds ?? 1;
    this.fullEvery = options.fullEvery ?? 6;
    this.subsetSize = options.subsetSize ?? 24;
  }

  reset(): void {
    this.tracker.reset();
    this.sweep = null;
    this.lastSweepAt = -Infinity;
    this.lastCosts = new Map();
    this.sweepCount = 0;
  }

  /** Eén frame erbij; rekent een deel van de composities door en geeft de ranglijst zodra een ronde klaar is. */
  push(frame: FeatureFrame): PrefilterRanking | null {
    this.tracker.push(frame);
    if (!this.sweep && frame.time - this.lastSweepAt >= this.everySeconds) {
      const window = this.tracker.window();
      if (window) {
        const full = this.sweepCount % this.fullEvery === 0 || this.lastCosts.size === 0;
        let subset: number[];
        if (full) subset = this.entries.map((_, i) => i);
        else {
          // de beste kandidaten van de vorige ronde; de rest wordt pas bij de volgende volledige ronde opnieuw bekeken
          const order = this.entries.map((e, i) => ({ i, c: this.lastCosts.get(e.id) ?? Infinity })).sort((a, b) => a.c - b.c);
          subset = order.slice(0, this.subsetSize).map((o) => o.i);
        }
        this.sweepCount += 1;
        this.sweep = { window, subset, costs: [], at: 0, time: frame.time };
        this.lastSweepAt = frame.time;
      }
    }
    const sw = this.sweep;
    if (!sw) return null;
    const end = Math.min(sw.subset.length, sw.at + this.perCall);
    for (; sw.at < end; sw.at += 1) {
      const e = this.entries[sw.subset[sw.at]];
      sw.costs.push({ id: e.id, cost: windowDtw(sw.window, e.seq) });
    }
    if (sw.at < sw.subset.length) return null;
    this.sweep = null;
    for (const c of sw.costs) this.lastCosts.set(c.id, c.cost);
    return { ranking: sw.costs.sort((a, b) => a.cost - b.cost), time: sw.time };
  }

  /** Alles in één keer (tests en evaluaties). */
  rankNow(): { id: string; cost: number }[] | null {
    const w = this.tracker.window();
    if (!w) return null;
    return this.entries.map((e) => ({ id: e.id, cost: windowDtw(w, e.seq) })).sort((a, b) => a.cost - b.cost);
  }
}
