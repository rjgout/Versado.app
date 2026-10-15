import type { FeatureFrame } from "../audio/features";
import type { Reference } from "../score/reference";

// Offline (niet-causale) uitlijning met klassieke DTW. Dit is GEEN onderdeel van de live engine: het is
// de maatstaf waarmee opnamen zonder bekende tijdlijn (echte begeleidingsopnamen) van een "bijna
// waarheid" worden voorzien. Offline kan het pad voor én na een frame meewegen en is daardoor veel
// nauwkeuriger dan de live engine, maar het blijft een schatting: zie docs/hymns/05-TEST-RESULTS.md.

export interface AlignedPoint {
  time: number;
  /** Positie in beats binnen de uitgerolde partituur (laps * cyclus). */
  beat: number;
}

/**
 * Lijn de frames uit met `laps` keer de cyclus. Open begin en einde (de opname mag een voorspel of
 * stilte bevatten). Stap per referentie-element = ref.stepBeats * `decimate`.
 */
export function alignOffline(frames: FeatureFrame[], ref: Reference, laps: number, frameStride = 3): AlignedPoint[] {
  // Een opname kan met een voorspel uit een willekeurig deel van de cyclus beginnen: het begin is vrij,
  // met een kleine straf buiten het eerste kwart. De uitgerolde as krijgt daarom een lap extra.
  laps += 1;
  // Frames worden uitgedund zodat een stap in de partituur (1/8 beat) ongeveer één frame beslaat; de
  // toegestane stappen (0..4 referentie-elementen per frame) dekken dan een tempobereik van ~0,5x-2x.
  const sub: FeatureFrame[] = [];
  for (let i = 0; i < frames.length; i += frameStride) sub.push(frames[i]);
  const stepsPerCycle = ref.steps;
  const R = stepsPerCycle * laps;
  const N = sub.length;
  const INF = 1e9;
  const MOVE_COST = [0.2, 0.03, 0, 0.03, 0.2];
  const MAXMOVE = MOVE_COST.length - 1;

  let prev = new Float32Array(R).fill(INF);
  let cur = new Float32Array(R);
  const back = new Uint8Array(N * R);

  // Posities waar een noot begint (met een marge van twee stappen), per referentie-element.
  const isOnsetStep = new Uint8Array(stepsPerCycle);
  for (const o of ref.onsets) {
    const s0 = Math.round(o / ref.stepBeats);
    for (let d = -2; d <= 2; d += 1) isOnsetStep[(((s0 + d) % stepsPerCycle) + stepsPerCycle) % stepsPerCycle] = 1;
  }
  let fluxMean = 0;
  for (const f of sub) fluxMean += f.flux;
  fluxMean /= Math.max(1, sub.length);

  const cost = (frame: FeatureFrame, j: number): number => {
    if (frame.silent) return 0.5;
    const base = (j % stepsPerCycle) * ref.dim;
    let sim = 0;
    for (let k = 0; k < ref.dim; k += 1) sim += frame.chroma[k] * ref.chroma[base + k];
    let c = 1 - sim;
    // een duidelijke onset hoort bij een partituurpositie waar iets begint; zonder onset juist niet
    if (frame.flux > fluxMean * 2) c += isOnsetStep[j % stepsPerCycle] ? -0.08 : 0.08;
    return c;
  };

  for (let j = 0; j < R; j += 1) prev[j] = cost(sub[0], j) + (j < stepsPerCycle / 4 ? 0 : j < stepsPerCycle ? 0.15 : 0.6);
  for (let i = 1; i < N; i += 1) {
    const f = sub[i];
    for (let j = 0; j < R; j += 1) {
      let best = INF;
      let arg = 0;
      for (let m = 0; m <= MAXMOVE && m <= j; m += 1) {
        const v = prev[j - m] + MOVE_COST[m];
        if (v < best) {
          best = v;
          arg = m;
        }
      }
      cur[j] = best + cost(f, j);
      back[i * R + j] = arg;
    }
    const tmp = prev;
    prev = cur;
    cur = tmp;
  }
  let end = 0;
  for (let j = 1; j < R; j += 1) if (prev[j] < prev[end]) end = j;

  const pathRef = new Int32Array(N);
  let j = end;
  for (let i = N - 1; i >= 0; i -= 1) {
    pathRef[i] = j;
    if (i > 0) j -= back[i * R + j];
  }
  // interpoleren naar alle oorspronkelijke frames en licht gladstrijken (~0,4 s)
  const out: AlignedPoint[] = [];
  for (let i = 0; i < frames.length; i += 1) {
    const x = i / frameStride;
    const a = Math.min(N - 1, Math.floor(x));
    const b = Math.min(N - 1, a + 1);
    const t = x - a;
    out.push({ time: frames[i].time, beat: (pathRef[a] * (1 - t) + pathRef[b] * t) * ref.stepBeats });
  }
  const smooth: AlignedPoint[] = [];
  const win = 4;
  for (let i = 0; i < out.length; i += 1) {
    let s = 0;
    let c = 0;
    for (let d = -win; d <= win; d += 1) {
      const k = i + d;
      if (k >= 0 && k < out.length) {
        s += out[k].beat;
        c += 1;
      }
    }
    smooth.push({ time: out[i].time, beat: s / c });
  }
  return smooth;
}
