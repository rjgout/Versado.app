import type { FeatureFrame } from "../audio/features";
import { hzToMidi } from "../audio/pitch";
import { PitchStepTracker, melodyDtw, melodySteps } from "../recognize/melodyPrefilter";

// Transpositie en stemming voor het volgen van zang. Een zanger of gemeente zingt zelden precies in de toonsoort van de partituur
// (en vaak een octaaf hoger of lager); de score-follower vergelijkt toonklassen en zou dan niets herkennen. Daarom wordt uit de
// gestemde frames (grondtoon, audio/pitch.ts) geschat met hoeveel halve tonen (en hoeveel cent) er te hoog of te laag wordt gezongen
// t.o.v. de gecontroleerde melodie, en worden de kenmerkframes terugverschoven vóór de melodievolger ze ziet.
//  - octaaf: beide banden van de chroma worden samengevouwen tot één band van 12 toonklassen (octaafonafhankelijk);
//  - toonsoort: de toonklassenverdeling van de gezongen grondtonen wordt gecorreleerd met die van de melodie (duur-gewogen);
//  - stemming: de resterende afwijking van de halve tonen, lineair terugverschoven.
// Zonder gestemde frames (instrumenten, ruis) blijft alles op nul en doet de melodievolger gewoon niets bijzonders.

const PC = 12;

/** Toonklassenverdeling van een melodie, duur-gewogen en genormaliseerd. */
export function melodyHistogram(notes: readonly (readonly [number, number, number])[]): Float32Array {
  const h = new Float32Array(PC);
  let total = 0;
  for (const [, dur, midi] of notes) {
    h[((midi % PC) + PC) % PC] += dur;
    total += dur;
  }
  if (total > 0) for (let i = 0; i < PC; i += 1) h[i] /= total;
  return h;
}

export interface KeyEstimatorConfig {
  /** Hoe vaak (s) de toonsoort opnieuw wordt beoordeeld. */
  everySeconds: number;
  /** Minimaal aantal gestemde stappen (~0,19 s) voor een beoordeling. */
  minSteps: number;
  /** Een andere toonsoort moet zo veel lagere DTW-kosten hebben, en bij dit aantal opeenvolgende beoordelingen, voor een wissel. */
  margin: number;
  confirmations: number;
}

// Een toonklassenverdeling van een paar noten past bij meerdere toonsoorten (een kwint hoger heeft bijna dezelfde noten); een histogram bleek
// daarom te zwak (docs/hymns/v3). De volgorde van de noten onderscheidt ze wel: dezelfde DTW als bij de melodieherkenning, maar dan
// voor één lofzang en alle twaalf transposities (12 DTW's per beoordeling, goedkoop). "Geen transpositie" geldt tot een andere
// toonsoort duidelijk betere kosten heeft.
export const DEFAULT_KEY_CONFIG: KeyEstimatorConfig = { everySeconds: 0.6, minSteps: 14, margin: 0.04, confirmations: 2 };

export class KeyEstimator {
  private readonly steps = new PitchStepTracker();
  private readonly ref: ReturnType<typeof melodySteps>;
  private sx = 0;
  private sy = 0;
  private lastTime: number | null = null;
  private lastEval = -Infinity;
  private current = 0;
  private candidate: { shift: number; count: number } | null = null;
  private tuningNow = 0;
  private readonly cfg: KeyEstimatorConfig;

  constructor(melody: readonly (readonly [number, number, number])[], cycleBeats: number, config: Partial<KeyEstimatorConfig> = {}) {
    this.cfg = { ...DEFAULT_KEY_CONFIG, ...config };
    this.ref = melodySteps({ id: "key", melody, totalBeats: cycleBeats });
  }

  /** Aantal halve tonen dat er te hoog (+) wordt gezongen t.o.v. de partituur (0..11). */
  get shift(): number {
    return this.current;
  }

  /** Stemming in halve tonen (-0,5..0,5): positief = te hoog gestemd. */
  get tuning(): number {
    return this.tuningNow;
  }

  reset(): void {
    this.steps.reset();
    this.sx = this.sy = 0;
    this.lastTime = null;
    this.lastEval = -Infinity;
    this.current = 0;
    this.candidate = null;
    this.tuningNow = 0;
  }

  push(frame: FeatureFrame): void {
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(1, frame.time - this.lastTime));
    this.lastTime = frame.time;
    const decay = Math.exp(-dt / 12);
    this.sx *= decay;
    this.sy *= decay;
    this.steps.push(frame);
    const p = frame.pitch;
    if (!frame.silent && p && p.hz > 0) {
      const midi = hzToMidi(p.hz);
      const w = p.clarity * p.clarity * Math.max(dt, 0.02);
      this.sx += w * Math.cos(2 * Math.PI * (midi - Math.round(midi)));
      this.sy += w * Math.sin(2 * Math.PI * (midi - Math.round(midi)));
    }
    this.tuningNow = Math.atan2(this.sy, this.sx) / (2 * Math.PI);
    if (frame.time - this.lastEval < this.cfg.everySeconds) return;
    this.lastEval = frame.time;
    const w = this.steps.window(this.cfg.minSteps);
    if (!w) return;
    const q = Float32Array.from(w, (v) => (((v - this.tuningNow) % PC) + PC) % PC);
    // DTW-parameter s: gezongen + s = referentie, dus gezongen = referentie + shift met shift = -s
    const costs: number[] = [];
    for (let s = 0; s < PC; s += 1) costs.push(melodyDtw(q, s, this.ref));
    let bestS = 0;
    for (let s = 1; s < PC; s += 1) if (costs[s] < costs[bestS]) bestS = s;
    const best = (PC - bestS) % PC;
    const curS = (PC - this.current) % PC;
    if (best === this.current || costs[bestS] > costs[curS] - this.cfg.margin) {
      this.candidate = null;
      return;
    }
    if (!this.candidate || this.candidate.shift !== best) this.candidate = { shift: best, count: 1 };
    else this.candidate.count += 1;
    if (this.candidate.count >= this.cfg.confirmations) {
      this.current = best;
      this.candidate = null;
    }
  }
}

/**
 * Een kenmerkframe voor de melodievolger: beide banden samengevouwen (octaafonafhankelijk), `shift` halve tonen teruggeschoven en de
 * stemming `tuning` (halve tonen) lineair gecorrigeerd. De uitkomst heeft 12 toonklassen en is L2-genormaliseerd.
 */
export function foldFrame(frame: FeatureFrame, shift: number, tuning: number): FeatureFrame {
  const src = frame.chroma;
  const folded = new Float32Array(PC);
  const bands = src.length / PC;
  for (let b = 0; b < bands; b += 1) for (let i = 0; i < PC; i += 1) folded[i] += src[b * PC + i];
  const out = new Float32Array(PC);
  // Gezongen toonklasse q = referentie r + shift + tuning; terug: r = q - shift - tuning
  const t = Math.max(-0.5, Math.min(0.5, tuning));
  const frac = Math.abs(t);
  for (let r = 0; r < PC; r += 1) {
    const q = (((r + shift) % PC) + PC) % PC;
    const neighbour = t >= 0 ? (q + 1) % PC : (q + PC - 1) % PC;
    // bij te hoog gezongen (t>0) ligt de energie tussen q en q+1: kies de bin die het dichtst bij r + t ligt
    out[r] = (1 - frac) * folded[q] + frac * folded[neighbour];
  }
  let n = 0;
  for (let i = 0; i < PC; i += 1) n += out[i] * out[i];
  n = Math.sqrt(n);
  if (n > 1e-9) for (let i = 0; i < PC; i += 1) out[i] /= n;
  return { ...frame, chroma: out };
}
