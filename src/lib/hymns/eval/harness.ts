import { ChromaExtractor, type FeatureFrame } from "../audio/features";
import type { Reference } from "../score/reference";
import { ScoreTracker, type TrackerConfig, type TrackerOutput } from "../follow/tracker";
import type { SynthResult } from "./synth";

// Hulpfuncties om een opname (synthetisch of uit een bestand) door de echte engine te halen en de uitkomst
// met een bekende tijdlijn te vergelijken. Alleen voor tests en scripts.

export function extractFrames(samples: Float32Array, sampleRate: number, chunk = 4096): FeatureFrame[] {
  const ex = new ChromaExtractor({ sampleRate });
  const frames: FeatureFrame[] = [];
  for (let i = 0; i < samples.length; i += chunk) frames.push(...ex.push(samples.subarray(i, Math.min(samples.length, i + chunk))));
  return frames;
}

export function runTracker(frames: FeatureFrame[], ref: Reference, config: Partial<TrackerConfig> = {}): TrackerOutput[] {
  const tracker = new ScoreTracker(ref, config);
  return frames.map((f) => tracker.update(f));
}

export interface TrackMetrics {
  frames: number;
  /** Mediane absolute fout in beats (alleen frames buiten pauzes en na `settleSeconds`). */
  medianErrBeats: number;
  p90ErrBeats: number;
  /** Mediane fout in milliseconden, omgerekend met het werkelijke tempo op dat moment. */
  medianErrMs: number;
  p90ErrMs: number;
  /** Aandeel frames met fout <= 0,5 beat. */
  within05: number;
  /** Aandeel frames met fout <= 1 beat. */
  within1: number;
  /** Eerste tijdstip waarop de fout 3 s achtereen <= 1 beat blijft (seconden sinds de eerste noot); null = nooit. */
  lockTimeSeconds: number | null;
}

/** Cyclische fout in beats (schatting versus waarheid), tussen -T/2 en T/2. */
export function cyclicError(est: number, truth: number, cycle: number): number {
  let d = est - (((truth % cycle) + cycle) % cycle);
  d -= Math.round(d / cycle) * cycle;
  return d;
}

export function evaluateTrack(
  outputs: TrackerOutput[],
  truth: Pick<SynthResult, "beatAt" | "inPause">,
  cycle: number,
  opts: { settleSeconds?: number; firstNoteSeconds?: number; skip?: (t: number) => boolean } = {}
): TrackMetrics {
  const settle = opts.settleSeconds ?? 0;
  const t0 = opts.firstNoteSeconds ?? 0;
  const errs: number[] = [];
  const errsMs: number[] = [];
  let okSince: number | null = null;
  let lockTime: number | null = null;
  for (let i = 0; i < outputs.length; i += 1) {
    const o = outputs[i];
    if (o.time < t0) continue;
    const e = cyclicError(o.position, truth.beatAt(o.time), cycle);
    if (Math.abs(e) <= 1) {
      if (okSince === null) okSince = o.time;
      if (lockTime === null && o.time - okSince >= 3) lockTime = okSince - t0;
    } else okSince = null;
    if (o.time - t0 < settle || truth.inPause(o.time) || opts.skip?.(o.time)) continue;
    errs.push(Math.abs(e));
    const dt = 0.5;
    const bps = Math.max(0.2, Math.abs(truth.beatAt(o.time + dt) - truth.beatAt(o.time - dt)) / (2 * dt));
    errsMs.push((Math.abs(e) / bps) * 1000);
  }
  const q = (a: number[], p: number) => {
    if (a.length === 0) return NaN;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  };
  return {
    frames: errs.length,
    medianErrBeats: q(errs, 0.5),
    p90ErrBeats: q(errs, 0.9),
    medianErrMs: q(errsMs, 0.5),
    p90ErrMs: q(errsMs, 0.9),
    within05: errs.filter((e) => e <= 0.5).length / Math.max(1, errs.length),
    within1: errs.filter((e) => e <= 1).length / Math.max(1, errs.length),
    lockTimeSeconds: lockTime,
  };
}
