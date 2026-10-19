// Lofzangen V3: verloop van de melodiekop per seconde (alleen de melodie-voorfilter, zonder de zware score-followers), op
//  - synthetische zang (solo, andere toonhoogte, adempauzes, ruis, koor), MET ("in") en ZONDER ("uit") de juiste lofzang als kandidaat;
//  - de officiële opnamen (piano/orgel), altijd als "uit" (geen zang: de melodieroute mag daar nooit iets herkennen) en als "in".
// De uitvoer is de grondstof om beslisregels achteraf op dezelfde metingen te vergelijken (zie scripts/hymns/lv3-melody-rules.py en
// docs/hymns/21-LOFZANGEN-V3.md): kosten, marge, z-score ten opzichte van alle kandidaten, aantal gestemde stappen en aandeel gestemd.
//   npx tsx scripts/hymns/lv3-melody-rules.ts --count 24 --seconds 80 --official 39 --out docs/hymns/v3/melody-rules-traj.json
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ChromaExtractor } from "../../src/lib/hymns/audio/features";
import { constantTempo, synthesizeHymn, type SynthOptions } from "../../src/lib/hymns/eval/synth";
import { MelodyPrefilter } from "../../src/lib/hymns/recognize/melodyPrefilter";
import { loadRecognitionBundle, loadResolvedHymn } from "../../src/lib/hymns/library/server";

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? "1") : d; };
const COUNT = Number(flag("count", "24"));
const SECONDS = Number(flag("seconds", "80"));
const OFFICIAL = Number(flag("official", "39"));
const V = (v: NonNullable<SynthOptions["voice"]>) => v;
const SCEN: Record<string, Partial<SynthOptions>> = {
  solo: { voiceOnly: true, voice: V({ singers: 1, vibratoCents: 20, intonationCents: 25 }) },
  "solo-laag": { voiceOnly: true, voice: V({ singers: 1, registerShift: -12, vibratoCents: 20, intonationCents: 25 }) },
  "solo-andere-toonsoort": { voiceOnly: true, voice: V({ singers: 1, registerShift: -5, vibratoCents: 20, intonationCents: 25, driftCents: -40 }) },
  "solo-ademhaling": { voiceOnly: true, breaths: { everyMeasures: 4, seconds: 0.6, jitterSeconds: 0.5 }, voice: V({ singers: 1, vibratoCents: 25, intonationCents: 25 }) },
  "solo+ruis": { voiceOnly: true, noiseDb: -14, voice: V({ singers: 1, vibratoCents: 20, intonationCents: 25 }) },
  groep: { voiceOnly: true, voice: V({ singers: 6, vibratoCents: 40, intonationCents: 40, lagSeconds: 0.18, octaveJumpProbability: 0.2 }) },
};

const bundle = loadRecognitionBundle();
const groups = new Map<string, number[]>();
for (const m of bundle.members) groups.set(m.compositionId, [...(groups.get(m.compositionId) ?? []), m.number]);
const melodyIds = [...groups.keys()].filter((id) => bundle.melodies[id]);
const entries = (exclude: string | null) => melodyIds.filter((id) => id !== exclude).map((id) => ({ id, melody: bundle.melodies[id], totalBeats: bundle.compositions.find((c) => c.id === id)!.totalBeats }));
const numberOf = (id: string) => groups.get(id)![0];

type Sweep = { t: number; vs: number; steps: number; top: [number, number][]; med: number; mad: number };
interface Traj { source: string; scenario: string; hymn: number; mode: "in" | "uit"; sweeps: Sweep[] }
const out: Traj[] = [];

function trace(frames: ReturnType<ChromaExtractor["push"]>, ids: string[], truthId: string | null, source: string, scenario: string, hymn: number, mode: "in" | "uit", pre: MelodyPrefilter) {
  void ids; void truthId;
  const sweeps: Sweep[] = [];
  let last = -Infinity;
  for (const f of frames) {
    pre.push(f);
    if (f.time - last < 1) continue;
    last = f.time;
    const vs = pre.tracker.voicedShare();
    const r = pre.rankNow(22);
    if (!r) continue;
    const costs = r.ranking.map((x) => x.cost).sort((a, b) => a - b);
    const med = costs[Math.floor(costs.length / 2)];
    const mad = costs.map((c) => Math.abs(c - med)).sort((a, b) => a - b)[Math.floor(costs.length / 2)];
    sweeps.push({ t: Math.round(f.time * 10) / 10, vs: Math.round(vs * 100) / 100, steps: r.voicedSteps, top: r.ranking.slice(0, 3).map((x) => [numberOf(x.id), Math.round(x.cost * 1000) / 1000]), med: Math.round(med * 1000) / 1000, mad: Math.round(mad * 10000) / 10000 });
  }
  out.push({ source, scenario, hymn, mode, sweeps });
}

// ---- synthetische zang
const step = Math.max(1, Math.floor(melodyIds.length / COUNT));
const sample = melodyIds.filter((_, i) => i % step === 0).slice(0, COUNT);
for (const [name, opts] of Object.entries(SCEN)) {
  for (const id of sample) {
    const num = numberOf(id);
    const hymn = loadResolvedHymn(num)!;
    const synth = synthesizeHymn(hymn.composition, { sampleRate: 22050, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.5, seed: num, ...opts });
    const ex = new ChromaExtractor({ sampleRate: 22050 });
    const frames: ReturnType<ChromaExtractor["push"]> = [];
    const audio = synth.samples.subarray(0, Math.min(synth.samples.length, SECONDS * 22050));
    for (let i = 0; i < audio.length; i += 4096) frames.push(...ex.push(audio.subarray(i, i + 4096)));
    for (const mode of ["in", "uit"] as const) trace(frames, [], id, "synth", name, num, mode, new MelodyPrefilter(entries(mode === "uit" ? id : null)));
    process.stderr.write(".");
  }
  process.stderr.write(` ${name}\n`);
}

// ---- officiële opnamen (instrumentaal)
const cache = ".cache/hymns/nld";
const index = JSON.parse(readFileSync(`${cache}/index.json`, "utf8")).hymns as { number: number; slug: string }[];
const slugOf = new Map(index.map((h) => [h.number, h.slug]));
let done = 0;
for (const [mi, m] of bundle.members.entries()) {
  if (done >= OFFICIAL) break;
  if (mi % 4 !== 0) continue;
  const mp3 = `${cache}/audio/${slugOf.get(m.number)}.mp3`;
  if (!existsSync(mp3) || !bundle.melodies[m.compositionId]) continue;
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", mp3, "-t", String(SECONDS), "-ac", "1", "-ar", "44100", "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  const audio = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4)).slice();
  const ex = new ChromaExtractor({ sampleRate: 44100 });
  const frames: ReturnType<ChromaExtractor["push"]> = [];
  for (let i = 0; i < audio.length; i += 4096) frames.push(...ex.push(audio.subarray(i, i + 4096)));
  for (const mode of ["in", "uit"] as const) trace(frames, [], m.compositionId, "officieel", "officieel", m.number, mode, new MelodyPrefilter(entries(mode === "uit" ? m.compositionId : null)));
  done += 1;
  process.stderr.write("o");
}
process.stderr.write("\n");
if (flag("out")) writeFileSync(flag("out")!, JSON.stringify(out));
console.log(JSON.stringify({ trajectories: out.length }));
