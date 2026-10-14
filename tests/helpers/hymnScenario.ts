import { POC_LIBRARY, resolveHymn } from "../../src/lib/hymns/library";
import type { FeatureFrame } from "../../src/lib/hymns/audio/features";
import { buildReference } from "../../src/lib/hymns/score/reference";
import { constantTempo, synthesizeHymn, type SynthOptions, type SynthResult } from "../../src/lib/hymns/eval/synth";
import { cyclicError, extractFrames } from "../../src/lib/hymns/eval/harness";
import { HymnFollowSession, type FollowSnapshot, type SessionConfig } from "../../src/lib/hymns/follow/session";
import type { ResolvedHymn } from "../../src/lib/hymns/types";

// Gedeelde hulpjes voor de lofzang-tests: een scenario = synthetische opname met bekende tijdlijn, door de
// echte engine gehaald. Zo meten de tests de engine zelf en niet een nagebouwde versie ervan.

export const SAMPLE_RATE = 22050;

export interface Scenario {
  hymn: ResolvedHymn;
  synth: SynthResult;
  frames: FeatureFrame[];
  cycle: number;
}

export function makeScenario(number: number, options: Partial<SynthOptions> = {}): Scenario {
  const hymn = resolveHymn(POC_LIBRARY, number)!;
  const synth = synthesizeHymn(hymn.composition, {
    sampleRate: SAMPLE_RATE,
    laps: 1,
    timbre: "piano",
    tempoSegments: constantTempo(80),
    leadInSeconds: 0.5,
    seed: number,
    ...options,
  });
  return { hymn, synth, frames: extractFrames(synth.samples, synth.sampleRate), cycle: hymn.composition.totalBeats };
}

export interface FollowRun {
  session: HymnFollowSession;
  snapshots: FollowSnapshot[];
}

export function follow(hymn: ResolvedHymn, frames: FeatureFrame[], config: Partial<SessionConfig> = {}, hook?: (i: number, session: HymnFollowSession) => void): FollowRun {
  const session = new HymnFollowSession(hymn, config);
  const snapshots: FollowSnapshot[] = [];
  frames.forEach((f, i) => {
    hook?.(i, session);
    snapshots.push(session.pushFrame(f));
  });
  return { session, snapshots };
}

/** Fractie frames (na `from` seconden, buiten pauzes) met cyclische fout <= `beats`. */
export function accuracy(sc: Scenario, snaps: FollowSnapshot[], beats = 1, from = 0): number {
  let ok = 0;
  let n = 0;
  for (const s of snaps) {
    if (s.time < from || sc.synth.inPause(s.time)) continue;
    n += 1;
    if (Math.abs(cyclicError(s.position, sc.synth.beatAt(s.time), sc.cycle)) <= beats) ok += 1;
  }
  return n === 0 ? 0 : ok / n;
}

export function medianError(sc: Scenario, snaps: FollowSnapshot[], from = 0): number {
  const errs = snaps
    .filter((s) => s.time >= from && !sc.synth.inPause(s.time))
    .map((s) => Math.abs(cyclicError(s.position, sc.synth.beatAt(s.time), sc.cycle)))
    .sort((a, b) => a - b);
  return errs[Math.floor(errs.length / 2)] ?? NaN;
}

export function referenceFor(hymn: ResolvedHymn) {
  return buildReference(hymn.composition);
}

// --- een hele "dienst": voorspel, eventuele pauze, daarna de zang. Elk deel is een eigen synthetische
// opname met bekende tijdlijn; ze worden achter elkaar gezet zodat het voorspel een ander begin kan hebben
// dan de samenzang (de laatste vier maten, een heel couplet) en er een echte stilte tussen kan zitten.

export interface ServicePart {
  /** Opties voor dit deel; `startBeat` bepaalt waar in de melodie het deel begint. */
  options: Partial<SynthOptions>;
  /** Stilte (s) vóór dit deel. */
  gapBefore?: number;
}

export interface Service {
  hymn: ResolvedHymn;
  frames: FeatureFrame[];
  cycle: number;
  duration: number;
  /** Tijdstip (s) waarop elk deel begint (de eerste noot, na de stilte ervoor). */
  partStart: number[];
  /** Tijdstip (s) waarop elk deel eindigt (de laatste klank van de muziek). */
  partEnd: number[];
}

export function makeService(number: number, parts: ServicePart[], shared: Partial<SynthOptions> = {}, leadIn = 1.5): Service {
  const hymn = resolveHymn(POC_LIBRARY, number)!;
  const chunks: Float32Array[] = [];
  const partStart: number[] = [];
  const partEnd: number[] = [];
  let offset = 0;
  const push = (a: Float32Array) => {
    chunks.push(a);
    offset += a.length / SAMPLE_RATE;
  };
  push(new Float32Array(Math.round(leadIn * SAMPLE_RATE)));
  parts.forEach((part, i) => {
    if (part.gapBefore) push(new Float32Array(Math.round(part.gapBefore * SAMPLE_RATE)));
    const synth = synthesizeHymn(hymn.composition, {
      sampleRate: SAMPLE_RATE,
      laps: 1,
      timbre: "piano",
      tempoSegments: constantTempo(80),
      leadInSeconds: 0,
      seed: number + 17 * i,
      ...shared,
      ...part.options,
    });
    partStart.push(offset + synth.timeAt(part.options.startBeat ?? 0));
    const last = i === parts.length - 1;
    const keep = last ? synth.samples.length : Math.min(synth.samples.length, Math.ceil(synth.duration * SAMPLE_RATE));
    partEnd.push(offset + synth.duration);
    push(synth.samples.subarray(0, keep));
  });
  const total = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    total.set(c, at);
    at += c.length;
  }
  return { hymn, frames: extractFrames(total, SAMPLE_RATE), cycle: hymn.composition.totalBeats, duration: total.length / SAMPLE_RATE, partStart, partEnd };
}
