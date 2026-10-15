// Kalibreert het tracker-bewijs per compositie (z-normalisatie).
//
// Sommige lofzangen verzamelen op bijna elke muziek veel bewijs (harmonisch algemene "aantrekkers"). Door voor elke compositie vast
// te leggen hoeveel bewijs ze gemiddeld én hoe wisselend op ANDERE muziek haalt, op een paar vaste luistermomenten, kan de herkenner
// dat bewijs omzetten naar "hoeveel afwijkt dit van toeval voor déze lofzang".
// Gebruik: npx tsx scripts/hymns/calibrate-evidence.ts <shard> <aantalShards> [--out bestand]
//   en daarna: python3 scripts/hymns/merge_calibration.py (of handmatig samenvoegen)
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ChromaExtractor, type FeatureFrame } from "../../src/lib/hymns/audio/features";
import { loadRecognitionBundle } from "../../src/lib/hymns/library/server";
import { HymnRecognizer } from "../../src/lib/hymns/recognize/recognizer";
import { candidatesFromBundle } from "../../src/lib/hymns/recognize/candidates";

const shard = Number(process.argv[2] ?? 0);
const shards = Number(process.argv[3] ?? 1);
const outIdx = process.argv.indexOf("--out");
const out = outIdx >= 0 ? process.argv[outIdx + 1] : `/tmp/calib-${shard}.json`;
const CHECK = [10, 20, 30, 45, 60];
const SR = 44100;
const POOL = 60;
const PER_TARGET = 24;
const cache = ".cache/hymns/nld";
const index = JSON.parse(readFileSync(`${cache}/index.json`, "utf8")).hymns as { number: number; slug: string }[];
const slugOf = new Map(index.map((h) => [h.number, h.slug]));

const bundle = loadRecognitionBundle();
const candidates = candidatesFromBundle(bundle);
const withAudio = bundle.members.filter((m) => existsSync(`${cache}/audio/${slugOf.get(m.number)}.mp3`));

function frames(number: number): FeatureFrame[] {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", `${cache}/audio/${slugOf.get(number)}.mp3`, "-t", String(CHECK[CHECK.length - 1] + 1), "-ac", "1", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
  const x = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.byteLength / 4)).slice();
  const ex = new ChromaExtractor({ sampleRate: SR });
  const out: FeatureFrame[] = [];
  for (let i = 0; i < x.length; i += 4096) for (const f of ex.push(x.subarray(i, i + 4096))) out.push(f);
  return out;
}

// vaste, verspreide pool van fragmenten (elke n-de lofzang met opname)
const step = Math.max(1, Math.floor(withAudio.length / POOL));
const pool = withAudio.filter((_, i) => i % step === 0).slice(0, POOL).map((m) => ({ member: m, frames: frames(m.number) }));
console.error(`pool: ${pool.length} fragmenten`);

const result: Record<string, { t: number[]; mean: number[]; std: number[]; n: number }> = {};
const mine = candidates.filter((_, i) => i % shards === shard);
for (const [ci, cand] of mine.entries()) {
  const group = new Set([cand.number, ...(cand.sharedWith ?? []).map((m) => m.number)]);
  const others = pool.filter((p) => !group.has(p.member.number));
  const picks = others.filter((_, i) => i % Math.max(1, Math.floor(others.length / PER_TARGET)) === 0).slice(0, PER_TARGET);
  const samples: number[][] = CHECK.map(() => []);
  for (const clip of picks) {
    const rec = new HymnRecognizer([cand]);
    let next = 0;
    for (const f of clip.frames) {
      const st = rec.update(f);
      while (next < CHECK.length && st.heardSeconds >= CHECK[next]) {
        samples[next].push(st.ranking[0]?.evidence ?? 0);
        next += 1;
      }
      if (next >= CHECK.length) break;
    }
  }
  const mean = samples.map((a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0));
  const std = samples.map((a, i) => (a.length > 1 ? Math.sqrt(a.reduce((s, v) => s + (v - mean[i]) ** 2, 0) / (a.length - 1)) : 10));
  result[cand.id] = { t: CHECK, mean: mean.map((v) => +v.toFixed(2)), std: std.map((v) => +v.toFixed(2)), n: picks.length };
  if (ci % 5 === 0) console.error(`${shard}: ${ci + 1}/${mine.length} ${cand.id} mean@30=${mean[2].toFixed(1)} std@30=${std[2].toFixed(1)}`);
}
writeFileSync(out, JSON.stringify(result));
console.error(`klaar: ${Object.keys(result).length} composities -> ${out}`);
