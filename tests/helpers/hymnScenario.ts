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
