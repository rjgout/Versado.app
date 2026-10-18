// Woordniveau-meting (zie src/lib/hymns/eval/words.ts): hoe snel en hoe juist volgt de woordmarkering de zang?
//   npx tsx scripts/hymns/lv3-words.ts --count 12 --scenarios piano,solo --variant base|v3 --out docs/hymns/v3/words-v3.json
// Variant "base": melodyTracking uit (ongewijzigde volger met alleen de volledige partituur). "v3": hybride volger met melodie.
import { writeFileSync } from "node:fs";
import { DEFAULT_CHROMA_CONFIG } from "../../src/lib/hymns/audio/features";
import { constantTempo, synthesizeHymn, type SynthOptions } from "../../src/lib/hymns/eval/synth";
import { extractFrames } from "../../src/lib/hymns/eval/harness";
import { evaluateWords, wordTruth, type WordMetrics } from "../../src/lib/hymns/eval/words";
import { HymnFollowSession, type FollowSnapshot } from "../../src/lib/hymns/follow/session";
import { loadRecognitionBundle, loadResolvedHymn } from "../../src/lib/hymns/library/server";

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const COUNT = Number(flag("count", "12"));
const VARIANT = flag("variant", "v3") as "base" | "v3";
const SR = 22050;
if (VARIANT === "base") DEFAULT_CHROMA_CONFIG.pitch = false;

const V = (o: NonNullable<SynthOptions["voice"]>) => o;
const SCEN: Record<string, Partial<SynthOptions>> = {
  piano: { timbre: "piano" },
  orgel: { timbre: "organ" },
  solo: { voiceOnly: true, voice: V({ singers: 1, vibratoCents: 20, intonationCents: 25 }) },
  "solo-langzaam": { voiceOnly: true, tempoSegments: constantTempo(55), voice: V({ singers: 1, vibratoCents: 20, intonationCents: 25 }) },
  "solo-snel": { voiceOnly: true, tempoSegments: constantTempo(110), voice: V({ singers: 1, vibratoCents: 20, intonationCents: 25 }) },
  "solo-laag": { voiceOnly: true, voice: V({ singers: 1, registerShift: -12, vibratoCents: 20, intonationCents: 25 }) },
  "solo-andere-toonsoort": { voiceOnly: true, voice: V({ singers: 1, registerShift: -5, vibratoCents: 20, intonationCents: 25, driftCents: -40 }) },
  "solo-ademhaling": { voiceOnly: true, breaths: { everyMeasures: 4, seconds: 0.6, jitterSeconds: 0.5 }, voice: V({ singers: 1, vibratoCents: 25, intonationCents: 25 }) },
  groep: { voiceOnly: true, voice: V({ singers: 6, vibratoCents: 40, intonationCents: 40, lagSeconds: 0.18, octaveJumpProbability: 0.2 }) },
  "groep-4stemmig": { voiceOnly: true, voice: V({ singers: 4, voicing: "chords", vibratoCents: 40, intonationCents: 30, lagSeconds: 0.15 }) },
  "solo+piano": { timbre: "piano", singersDb: -3, voice: V({ singers: 1, intonationCents: 25, vibratoCents: 20 }) },
  "gemeente+orgel": { timbre: "organ", singersDb: -6, voice: V({ singers: 6, intonationCents: 35, vibratoCents: 35 }) },
};
const names = (flag("scenarios", Object.keys(SCEN).join(",")) as string).split(",");
const bundle = loadRecognitionBundle();
const groups = new Map<string, number[]>();
for (const m of bundle.members) groups.set(m.compositionId, [...(groups.get(m.compositionId) ?? []), m.number]);
const picks = [...groups.values()].filter((_, i) => i % Math.max(1, Math.floor(groups.size / COUNT)) === 0).slice(0, COUNT).map((g) => g[0]);

const q = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
const rows: { scenario: string; hymn: number; m: WordMetrics; trackSource: string; cpuMsPerAudioSecond: number }[] = [];
for (const name of names) {
  for (const num of picks) {
    const hymn = loadResolvedHymn(num)!;
    if (VARIANT === "base") hymn.melody = null;
    const synth = synthesizeHymn(hymn.composition, { sampleRate: SR, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.5, seed: num, ...SCEN[name] });
    const truth = wordTruth(hymn.text, synth);
    if (truth.length < 10) continue;
    const end = truth[truth.length - 1].start + 3;
    const frames = extractFrames(synth.samples.subarray(0, Math.min(synth.samples.length, Math.ceil(end * SR))), SR);
    const session = new HymnFollowSession(hymn, VARIANT === "base" ? { melodyTracking: false } : {});
    const snaps: FollowSnapshot[] = [];
    const t0 = performance.now();
    for (const f of frames) snaps.push(session.pushFrame(f));
    const cpu = (performance.now() - t0) / (frames.length * 0.0464 || 1);
    rows.push({ scenario: name, hymn: num, m: evaluateWords(snaps, truth), trackSource: snaps[snaps.length - 1].trackSource ?? "full", cpuMsPerAudioSecond: cpu });
    process.stderr.write(`${name} ${num}\n`);
  }
}
const summary = names.map((name) => {
  const r = rows.filter((x) => x.scenario === name);
  const pick = (f: (m: WordMetrics) => number | null) => q(r.map((x) => f(x.m)).filter((v): v is number => v !== null), 0.5);
  return {
    scenario: name,
    n: r.length,
    exactMedian: pick((m) => m.exact),
    withinOneMedian: pick((m) => m.withinOne),
    withinOneP10: q(r.map((x) => x.m.withinOne), 0.1),
    aheadMedian: pick((m) => m.ahead),
    noneMedian: pick((m) => m.none),
    delayMedianMs: pick((m) => m.delayMedianMs),
    delayP90Ms: q(r.map((x) => x.m.delayP90Ms).filter((v): v is number => v !== null), 0.5),
    firstMarkMedianS: pick((m) => m.firstMarkSeconds),
    markedMedian: pick((m) => m.marked),
    melodySource: r.filter((x) => x.trackSource === "melody").length,
    cpuMsPerAudioSecondMedian: q(r.map((x) => x.cpuMsPerAudioSecond), 0.5),
  };
});
console.log(JSON.stringify({ variant: VARIANT, summary }, null, 1));
if (flag("out")) writeFileSync(flag("out") as string, JSON.stringify({ variant: VARIANT, summary, rows }, null, 1));
