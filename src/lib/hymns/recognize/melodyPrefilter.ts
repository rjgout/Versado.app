import type { FeatureFrame } from "../audio/features";
import { hzToMidi } from "../audio/pitch";

// Melodieherkenning voor monofone zang (solo, a capella), naast het chroma-voorfilter van prefilter.ts.
//
// Een solist zingt alleen de melodie, in zijn eigen toonsoort en octaaf en niet precies zuiver. Daarom wordt hier niet met de
// absolute toonhoogte vergeleken maar met de TOONKLASSEN (mod 12, dus octaafonafhankelijk) na een geschatte transpositie en
// stemming, met een DTW die vertragen en versnellen toestaat (het zangtempo is onbekend). Alleen de gestemde (voiced) delen
// van het gehoorde venster tellen; ademhalingen en medeklinkers vallen eruit zonder het tempo te verstoren.
//
// De referentie is de gereconstrueerde melodie (score/melody.ts), alleen als die betrouwbaar is. Een lofzang zonder betrouwbare
// melodie doet hier niet mee ("ongeschikt voor melodie-only-herkenning") en blijft herkenbaar via chroma.

const PC = 12;
const STEP_BEATS = 0.5;
const FRAMES_PER_STEP = 4;
const MAX_STEPS = 64;
const STAY = 0.12;
const SKIP = 0.06;
const SHIFT_TRIALS = 2;

export interface MelodyCandidate {
  id: string;
  /** [beginbeat, duur, midi] van de melodie; alleen aanwezig als die betrouwbaar is. */
  melody: readonly (readonly [number, number, number])[];
  totalBeats: number;
}

interface RefSeq {
  /** Toonklasse (0..11) per stap, twee cycli, rusten overgeslagen. */
  pc: Uint8Array;
  n: number;
  hist: Float32Array;
}

export function melodySteps(c: MelodyCandidate): RefSeq {
  const steps = Math.max(2, Math.round(c.totalBeats / STEP_BEATS));
  const one: number[] = [];
  const sorted = [...c.melody].sort((a, b) => a[0] - b[0]);
  let idx = 0;
  for (let s = 0; s < steps; s += 1) {
    const mid = (s + 0.5) * STEP_BEATS;
    while (idx + 1 < sorted.length && sorted[idx + 1][0] <= mid) idx += 1;
    const n = sorted[idx];
    if (n && n[0] <= mid && mid < n[0] + n[1]) one.push(((n[2] % PC) + PC) % PC);
  }
  const pc = new Uint8Array(one.length * 2);
  pc.set(one, 0);
  pc.set(one, one.length);
  const hist = new Float32Array(PC);
  for (const v of one) hist[v] += 1;
  const total = one.length || 1;
  for (let i = 0; i < PC; i += 1) hist[i] /= total;
  return { pc, n: pc.length, hist };
}

/** Kleinste afstand tussen twee toonklassen op de cirkel (in halve tonen, 0..6). */
function circ(a: number, b: number): number {
  const d = Math.abs(a - b) % PC;
  return d > 6 ? PC - d : d;
}

/** Middelt gestemde frames tot stappen van ~0,19 s (toonklasse als cirkelgemiddelde), met een vaste maat voor gestemdheid. */
export class PitchStepTracker {
  private readonly steps: (number | null)[] = [];
  private sumX = 0;
  private sumY = 0;
  private weight = 0;
  private voiced = 0;
  private count = 0;

  reset(): void {
    this.steps.length = 0;
    this.sumX = this.sumY = this.weight = 0;
    this.voiced = 0;
    this.count = 0;
  }

  push(frame: FeatureFrame): void {
    const p = frame.pitch;
    if (!frame.silent && p && p.hz > 0) {
      const midi = hzToMidi(p.hz);
      const angle = (2 * Math.PI * (((midi % PC) + PC) % PC)) / PC;
      const w = p.clarity * p.clarity;
      this.sumX += w * Math.cos(angle);
      this.sumY += w * Math.sin(angle);
      this.weight += w;
      this.voiced += 1;
    }
    this.count += 1;
    if (this.count >= FRAMES_PER_STEP) {
      // Een stap is gestemd als de helft van de frames gestemd is en de toonklassen consistent zijn (geen glijdende ruis).
      const resultant = this.weight > 0 ? Math.hypot(this.sumX, this.sumY) / this.weight : 0;
      if (this.voiced >= FRAMES_PER_STEP / 2 && resultant >= 0.7) {
        const angle = Math.atan2(this.sumY, this.sumX);
        this.steps.push((((angle * PC) / (2 * Math.PI)) % PC + PC) % PC);
      } else this.steps.push(null);
      if (this.steps.length > MAX_STEPS) this.steps.shift();
      this.sumX = this.sumY = this.weight = 0;
      this.voiced = 0;
      this.count = 0;
    }
  }

  /** De recente gestemde stappen (toonklassen, ongecorrigeerd), of null als er te weinig is gezongen. */
  window(minVoiced = 22): number[] | null {
    const v = this.steps.filter((s): s is number => s !== null);
    return v.length >= minVoiced ? v : null;
  }

  /** Aandeel gestemde stappen in het recente venster (voor de keuze tussen zang en instrument). */
  voicedShare(): number {
    return this.steps.length ? this.steps.filter((s) => s !== null).length / this.steps.length : 0;
  }
}

/** Subsequence-DTW van gehoorde toonklassen (na transpositie) tegen een melodie; lagere kosten = betere overeenkomst. */
export function melodyDtw(query: Float32Array, shift: number, ref: RefSeq): number {
  const W = query.length;
  const M = ref.n;
  let prev = new Float32Array(M);
  let cur = new Float32Array(M);
  const cost = (q: number, r: number) => Math.min(circ(q + shift, r), 3) / 3;
  for (let j = 0; j < M; j += 1) prev[j] = cost(query[0], ref.pc[j]);
  for (let i = 1; i < W; i += 1) {
    for (let j = 0; j < M; j += 1) {
      let best = prev[j] + STAY;
      if (j >= 1 && prev[j - 1] < best) best = prev[j - 1];
      if (j >= 2 && prev[j - 2] + SKIP < best) best = prev[j - 2] + SKIP;
      cur[j] = cost(query[i], ref.pc[j]) + best;
    }
    [prev, cur] = [cur, prev];
  }
  let min = Infinity;
  for (let j = 0; j < M; j += 1) if (prev[j] < min) min = prev[j];
  return min / W;
}

export interface MelodyRanking {
  ranking: { id: string; cost: number; shift: number }[];
  /** Aantal gestemde stappen waarop dit gebaseerd is. */
  voicedSteps: number;
}

/**
 * Rangschikt alle kandidaten met een betrouwbare melodie op overeenkomst met de gezongen toonklassen.
 * De transpositie wordt per kandidaat geschat uit het histogram van toonklassen (de zanger zingt in zijn eigen toonsoort);
 * de stemming (afwijking van A=440) wordt uit de resterende afwijking van de halve tonen van het venster geschat.
 */
export class MelodyPrefilter {
  readonly tracker = new PitchStepTracker();
  private readonly entries: { id: string; seq: RefSeq }[];

  constructor(candidates: MelodyCandidate[]) {
    this.entries = candidates.filter((c) => c.melody.length >= 12).map((c) => ({ id: c.id, seq: melodySteps(c) }));
  }

  get size(): number {
    return this.entries.length;
  }

  reset(): void {
    this.tracker.reset();
  }

  push(frame: FeatureFrame): void {
    this.tracker.push(frame);
  }

  rankNow(minVoiced = 22): MelodyRanking | null {
    const w = this.tracker.window(minVoiced);
    if (!w) return null;
    // stemming: circulaire gemiddelde afwijking van het dichtstbijzijnde halve-toonpunt
    let sx = 0;
    let sy = 0;
    for (const v of w) {
      const frac = v - Math.round(v);
      sx += Math.cos(2 * Math.PI * frac);
      sy += Math.sin(2 * Math.PI * frac);
    }
    const tuning = Math.atan2(sy, sx) / (2 * Math.PI);
    const q = Float32Array.from(w, (v) => (((v - tuning) % PC) + PC) % PC);
    const qHist = new Float32Array(PC);
    for (const v of q) qHist[(Math.round(v) % PC + PC) % PC] += 1 / q.length;
    const ranking = this.entries.map((e) => {
      // transpositie met de grootste overlap tussen de toonklassenhistogrammen; de twee beste worden beide uitgeprobeerd
      // (twee bijna gelijke toonsoorten, bv. een kwint uit elkaar, hebben bijna dezelfde toonklassen)
      const scores: { s: number; score: number }[] = [];
      for (let s = 0; s < PC; s += 1) {
        let score = 0;
        for (let c = 0; c < PC; c += 1) score += qHist[c] * e.seq.hist[(c + s) % PC];
        scores.push({ s, score });
      }
      scores.sort((a, b) => b.score - a.score);
      let best = { cost: Infinity, shift: scores[0].s };
      for (const { s: shift } of scores.slice(0, SHIFT_TRIALS)) {
        const cost = melodyDtw(q, shift, e.seq);
        if (cost < best.cost) best = { cost, shift };
      }
      return { id: e.id, cost: best.cost, shift: best.shift };
    });
    ranking.sort((a, b) => a.cost - b.cost);
    return { ranking, voicedSteps: w.length };
  }
}
