// Meting van de herkenning op de hele Nederlandse bibliotheek, met de officiële begeleidingsopnamen (piano/orgel).
//  - elke opname wordt gedecodeerd (ffmpeg), door dezelfde kenmerkextractor en dezelfde herkenner gehaald als in de app;
//  - per lofzang: na hoeveel seconden luistertijd wordt de juiste lofzang voorgesteld, en wordt er ooit een verkeerde voorgesteld;
//  - CPU per frame en het aantal actieve kandidaten van de volledige score-follower.
// Opnamen zijn Engelstalige begeleiding van dezelfde melodieën; ze zijn de enige echte audio die beschikbaar is.
// Aanroep: npx tsx scripts/hymns/eval-library.ts [--seconds 70] [--only 24,36] [--tempo 0.8] [--every 4] [--no-melody] [--leave-out] [--noise 0.05]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ChromaExtractor } from "../../src/lib/hymns/audio/features";
import { candidatesFromHymns } from "../../src/lib/hymns/live";
import { HymnRecognizer, type RecognitionCandidate } from "../../src/lib/hymns/recognize/recognizer";
import { loadRecognitionBundle } from "../../src/lib/hymns/library/server";

const args = process.argv.slice(2);
const flag = (name: string, def?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1]?.startsWith("--") || args[i + 1] === undefined ? "1" : args[i + 1]) : def;
};
const SECONDS = Number(flag("seconds", "70"));
const ONLY = new Set((flag("only", "") ?? "").split(",").filter(Boolean).map(Number));
const TEMPO = Number(flag("tempo", "1"));
const NOISE = Number(flag("noise", "0"));
// Onbekende melodie: de lofzang zelf wordt uit de kandidaten gehaald; goed = nooit een lofzang voorgesteld.
const LEAVE_OUT = Boolean(flag("leave-out"));
const EVERY = Number(flag("every", "1"));
const SR = 44100;
const cache = ".cache/hymns/nld";
const index = JSON.parse(readFileSync(`${cache}/index.json`, "utf8")).hymns as { number: number; slug: string }[];
const slugOf = new Map(index.map((h) => [h.number, h.slug]));

function decode(mp3: string): Float32Array {
  const filters = TEMPO !== 1 ? ["-af", `atempo=${TEMPO}`] : [];
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", mp3, ...filters, "-t", String(SECONDS / Math.min(1, TEMPO)), "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(String(r.stderr));
  const b = r.stdout;
  const x = new Float32Array(b.buffer, b.byteOffset, Math.floor(b.byteLength / 4)).slice();
  if (NOISE > 0) {
    let s = 12345;
    for (let i = 0; i < x.length; i += 1) {
      s = (s * 1664525 + 1013904223) >>> 0;
      x[i] += ((s / 4294967296) * 2 - 1) * NOISE;
    }
  }
  return x;
}

const bundle = loadRecognitionBundle();
const compById = new Map(bundle.compositions.map((c) => [c.id, c]));
const groups = new Map<string, typeof bundle.members>();
for (const m of bundle.members) groups.set(m.compositionId, [...(groups.get(m.compositionId) ?? []), m]);
const candidates: RecognitionCandidate[] = [...groups.entries()].map(([id, g]) => ({
  id,
  number: g[0].number,
  title: g[0].title,
  composition: compById.get(id)!,
  sharedWith: g.slice(1).map((m) => ({ number: m.number, title: m.title })),
  // V3: gecontroleerde zangmelodie zoals in de app (candidatesFromBundle); met --no-melody de situatie van vóór V3.
  ...(flag("no-melody") ? {} : { melody: bundle.melodies?.[id] }),
}));
void candidatesFromHymns;

const results: Record<string, unknown> = {};
let n = 0;
let ok = 0;
let wrong = 0;
let notIdentified = 0;
const times: number[] = [];
let totalMs = 0;
let totalFrames = 0;
let maxMsFrame = 0;
for (const [mi, m] of bundle.members.entries()) {
  if (ONLY.size && !ONLY.has(m.number)) continue;
  if (mi % EVERY !== 0) continue;
  const slug = slugOf.get(m.number);
  const mp3 = `${cache}/audio/${slug}.mp3`;
  if (!existsSync(mp3)) continue;
  const audio = decode(mp3);
  const extractor = new ChromaExtractor({ sampleRate: SR });
  const recognizer = new HymnRecognizer(LEAVE_OUT ? candidates.filter((c) => c.id !== m.compositionId) : candidates);
  let firstCorrect: number | null = null;
  let firstWrong: string | null = null;
  let activeMax = 0;
  let detail: Record<string, unknown> | null = null;
  let sug: { ok: boolean; t: number } | null = null;
  const chunk = 4096;
  for (let i = 0; i < audio.length; i += chunk) {
    for (const frame of extractor.push(audio.subarray(i, i + chunk))) {
      const t0 = performance.now();
      const st = recognizer.update(frame);
      const ms = performance.now() - t0;
      totalMs += ms;
      totalFrames += 1;
      maxMsFrame = Math.max(maxMsFrame, ms);
      activeMax = Math.max(activeMax, recognizer.activeCount);
      if ((st.status === "suggested" || st.status === "identified") && st.suggestion && sug === null) sug = { ok: st.suggestion.id === m.compositionId, t: +st.heardSeconds.toFixed(1) };
      // Alleen de eerste uitspraak telt: de app begint dan te volgen (wat daarna gebeurt, is volgen en geen herkennen meer).
      if (st.status === "identified" && st.suggestion && firstCorrect === null && firstWrong === null) {
        if (st.suggestion.id === m.compositionId) firstCorrect = st.heardSeconds;
        else firstWrong = `${st.suggestion.number}@${st.heardSeconds.toFixed(1)}s`;
        const others = st.ranking.filter((r) => r.id !== st.suggestion!.id);
        const truth = st.ranking.find((r) => r.id === m.compositionId);
        detail = { t: +st.heardSeconds.toFixed(1), margin: +(st.lead?.margin ?? 0).toFixed(3), cost: +(st.lead?.cost ?? 0).toFixed(3), streak: st.lead?.streak, ev: +st.suggestion.evidence.toFixed(0), evOther: +(others[0]?.evidence ?? 0).toFixed(0), evTruth: truth ? +truth.evidence.toFixed(0) : null, z: +st.suggestion.z.toFixed(1), zOther: +(others.length ? Math.max(...others.map((r) => r.z)) : -9).toFixed(1), zTruth: truth ? +truth.z.toFixed(1) : null };
      }
    }
  }
  n += 1;
  const good = LEAVE_OUT ? firstCorrect === null && firstWrong === null : firstCorrect !== null && firstWrong === null;
  if (good) {
    ok += 1;
    if (firstCorrect !== null) times.push(firstCorrect);
  } else if (firstWrong || (LEAVE_OUT && firstCorrect !== null)) wrong += 1;
  else notIdentified += 1;
  results[String(m.number)] = { ok: good, seconds: firstCorrect, wrong: firstWrong, shared: (groups.get(m.compositionId)?.length ?? 1) > 1, detail, suggestion: sug };
  console.log(m.number, JSON.stringify(results[String(m.number)]), `actief≤${activeMax}`);
}
times.sort((a, b) => a - b);
const pct = (p: number): number => times[Math.min(times.length - 1, Math.floor(times.length * p))] ?? NaN;
const summary = {
  hymns: n,
  correct: ok,
  wrongSuggestion: wrong,
  notIdentified,
  secondsMedian: pct(0.5),
  secondsP90: pct(0.9),
  msPerFrameAvg: totalMs / Math.max(1, totalFrames),
  msPerFrameMax: maxMsFrame,
  frames: totalFrames,
  tempo: TEMPO,
  noise: NOISE,
  leaveOut: LEAVE_OUT,
  candidates: candidates.length,
};
console.log(JSON.stringify(summary));
if (flag("results-out")) writeFileSync(flag("results-out") as string, JSON.stringify(results, null, 1));
if (flag("summary-out")) writeFileSync(flag("summary-out") as string, JSON.stringify(summary, null, 1));
