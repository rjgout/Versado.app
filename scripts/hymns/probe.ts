// Snelle verkenning: laat de engine een opname volgen en print de positie ten opzichte van de offline uitlijning.
import { ChromaExtractor, type FeatureFrame } from "../../src/lib/hymns/audio/features";
import { POC_LIBRARY, resolveHymn } from "../../src/lib/hymns/library";
import { buildReference } from "../../src/lib/hymns/score/reference";
import { ScoreTracker } from "../../src/lib/hymns/follow/tracker";
import { alignOffline } from "../../src/lib/hymns/eval/offlineAlign";
import { readWav } from "./wav";
import { cyclicError } from "../../src/lib/hymns/eval/harness";

const [, , numberArg, wavPath, lapsArg] = process.argv;
const hymn = resolveHymn(POC_LIBRARY, Number(numberArg))!;
const laps = Number(lapsArg ?? 4);
const { sampleRate, samples } = readWav(wavPath);
const ex = new ChromaExtractor({ sampleRate });
const frames: FeatureFrame[] = [];
for (let i = 0; i < samples.length; i += 4096) frames.push(...ex.push(samples.subarray(i, i + 4096)));
console.log("frames", frames.length, "hop", ex.hopSeconds.toFixed(3));
const ref = buildReference(hymn.composition);
const t0 = Date.now();
const truth = alignOffline(frames, ref, laps);
console.log("offline uitlijning", Date.now() - t0, "ms; eindpositie beats", truth[truth.length - 1].beat.toFixed(1), "van", (ref.cycleBeats * laps).toFixed(1));
const tracker = new ScoreTracker(ref, { start: (process.env.START as "start") ?? "start", particles: Number(process.env.N ?? 320), kappa: Number(process.env.KAPPA ?? 10) });
const t1 = Date.now();
const errs: number[] = [];
for (let i = 0; i < frames.length; i += 1) {
  const o = tracker.update(frames[i]);
  const err = cyclicError(o.position, truth[i].beat, ref.cycleBeats);
  errs.push(err);
  if (i % 108 === 0) console.log(frames[i].time.toFixed(1).padStart(6), "truth", (truth[i].beat % ref.cycleBeats).toFixed(1).padStart(6), "est", o.position.toFixed(1).padStart(6), "err", err.toFixed(2).padStart(6), "bpm", o.bpm.toFixed(0), "conc", o.concentration.toFixed(2), "fit", o.fit.toFixed(2), "z", o.z.toFixed(1), "zmax", o.zMax.toFixed(1));
}
console.log("tracker", Date.now() - t1, "ms voor", frames.length, "frames");
const abs = errs.map(Math.abs);
const tail = abs.slice(Math.floor(abs.length * 0.2)).sort((a, b) => a - b);
console.log("na 20%: mediane |fout|", tail[Math.floor(tail.length / 2)].toFixed(3), "p90", tail[Math.floor(tail.length * 0.9)].toFixed(3), "binnen 1 beat", (tail.filter((e) => e <= 1).length / tail.length).toFixed(2));
