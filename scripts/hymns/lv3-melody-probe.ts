// Meet de melodieherkenning (pitch + toonklassen-DTW) los van de rest van de engine: positie van de juiste lofzang in de
// ranglijst van alle composities met een betrouwbare melodie, na `--seconds` seconden zang.
//   npx tsx scripts/hymns/lv3-melody-probe.ts --count 24 --seconds 20 --scenarios solo,groep
import { readFileSync } from "node:fs";
import { ChromaExtractor } from "../../src/lib/hymns/audio/features";
import { constantTempo, synthesizeHymn, type SynthOptions } from "../../src/lib/hymns/eval/synth";
import { MelodyPrefilter } from "../../src/lib/hymns/recognize/melodyPrefilter";
import { loadRecognitionBundle, loadResolvedHymn } from "../../src/lib/hymns/library/server";
import { decodeNotation } from "../../src/lib/hymns/notation/decode";
import { reconstructMelody } from "../../src/lib/hymns/score/melody";

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const COUNT = Number(flag("count", "24"));
const SECONDS = Number(flag("seconds", "20"));
const SR = 22050;
const SCEN: Record<string, Partial<SynthOptions>> = {
  solo: { voiceOnly: true, voice: { singers: 1, vibratoCents: 20, intonationCents: 25 } },
  "solo-laag": { voiceOnly: true, voice: { singers: 1, registerShift: -12, vibratoCents: 20, intonationCents: 25 } },
  "solo-andere-toonsoort": { voiceOnly: true, voice: { singers: 1, registerShift: -5, vibratoCents: 20, intonationCents: 25, driftCents: -40 } },
  groep: { voiceOnly: true, voice: { singers: 6, vibratoCents: 40, intonationCents: 40, lagSeconds: 0.18, octaveJumpProbability: 0.2 } },
  "groep-4stemmig": { voiceOnly: true, voice: { singers: 4, voicing: "chords", vibratoCents: 40, intonationCents: 30, lagSeconds: 0.15 } },
  "solo-ademhaling": { voiceOnly: true, breaths: { everyMeasures: 4, seconds: 0.6, jitterSeconds: 0.5 }, voice: { singers: 1, vibratoCents: 25, intonationCents: 25 } },
  "solo+ruis": { voiceOnly: true, noiseDb: -14, voice: { singers: 1, vibratoCents: 20, intonationCents: 25 } },
  piano: { timbre: "piano" },
  "solo+piano": { timbre: "piano", singersDb: -3, voice: { singers: 1, intonationCents: 25, vibratoCents: 20 } },
};
const names = (flag("scenarios", Object.keys(SCEN).join(",")) as string).split(",");

const bundle = loadRecognitionBundle();
const groups = new Map<string, number[]>();
for (const m of bundle.members) groups.set(m.compositionId, [...(groups.get(m.compositionId) ?? []), m.number]);
const comps = bundle.compositions;
const cands = comps.map((c) => {
  const slug = c.id.replace(/^comp:/, "");
  let notation = null;
  try { notation = decodeNotation(JSON.parse(readFileSync(`src/lib/hymns/library/data/notation/${slug}.json`, "utf8"))); } catch { /* geen notatie */ }
  const h = loadResolvedHymn(groups.get(c.id)![0]);
  const st = h?.text.stanzas[0];
  const syl = st && st.linking === "word" ? st.lines.flatMap((l) => l.words).flatMap((w) => (w.syl ? w.syl.map((s) => s[1]) : w.b !== null ? [w.b] : [])) : [];
  const r = reconstructMelody(c, notation, { syllableBeats: syl });
  return { id: c.id, composition: c, melody: r.status === "ok" ? r.notes : [], totalBeats: c.totalBeats, ok: r.status === "ok" };
});
const usable = cands.filter((c) => c.ok);
console.error(`melodieën: ${usable.length}/${cands.length} bruikbaar`);
const sample = usable.filter((_, i) => i % Math.max(1, Math.floor(usable.length / COUNT)) === 0).slice(0, COUNT);
const frame = (a: number[], p: number) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
for (const name of names) {
  const ranks: number[] = [];
  const msPerFrame: number[] = [];
  let top1 = 0, top5 = 0, top1Margin: number[] = [];
  for (const c of sample) {
    const num = groups.get(c.id)![0];
    const hymn = loadResolvedHymn(num)!;
    const synth = synthesizeHymn(hymn.composition, { sampleRate: SR, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.5, seed: num, ...SCEN[name] });
    const ex = new ChromaExtractor({ sampleRate: SR });
    const mp = new MelodyPrefilter(usable);
    const audio = synth.samples.subarray(0, SECONDS * SR);
    const t0 = performance.now();
    let frames = 0;
    for (let i = 0; i < audio.length; i += 4096) for (const f of ex.push(audio.subarray(i, i + 4096))) { mp.push(f); frames += 1; }
    msPerFrame.push((performance.now() - t0) / Math.max(1, frames));
    const r = mp.rankNow();
    const rank = r ? r.ranking.findIndex((x) => x.id === c.id) + 1 : 999;
    ranks.push(rank); if (rank !== 1 && process.env.VERBOSE) console.error("  miss", c.id, rank, r?.voicedSteps);
    if (rank === 1) { top1 += 1; if (r) top1Margin.push(r.ranking[1].cost - r.ranking[0].cost); }
    if (rank <= 5) top5 += 1;
  }
  console.log(JSON.stringify({ scenario: name, n: sample.length, top1: top1 / sample.length, top5: top5 / sample.length, rankMedian: frame(ranks, 0.5), rankP90: frame(ranks, 0.9), marginTop1Median: top1Margin.length ? frame(top1Margin, 0.5) : null, msPerFrameExtractAndPush: +(msPerFrame.reduce((a, b) => a + b, 0) / msPerFrame.length).toFixed(2) }));
}
