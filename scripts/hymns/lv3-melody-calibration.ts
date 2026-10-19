// Lofzangen V3: hoe betrouwbaar is een herkenning via de zangmelodie? Reproduceerbare kalibratie van de melodiekop in recognizer.ts.
//
//   npx tsx scripts/hymns/lv3-melody-calibration.ts --count 30 --seconds 45 --out docs/hymns/v3/melody-calibration.json
//
// Per lofzang en scenario wordt dezelfde audio twee keer herkend: MET de juiste lofzang in de kandidaten ("in") en ZONDER ("uit": een
// onbekende melodie, elke uitspraak is dan fout). Gemeten wordt het eerste moment waarop de herkenner via de melodie een lofzang
// voorstelt (via === "melody") en de waarden waarmee dat gebeurde. Daaruit volgt de werkelijke precisie per marge; de getoonde
// "kans" van de melodie-route is daarop gebaseerd (zie melodyConfidence in recognizer.ts), niet op een formule.
//
// Let op: synthetische zang die dezelfde melodie zingt als de referentie (geen onafhankelijke test).
import { writeFileSync } from "node:fs";
import { constantTempo, synthesizeHymn, type SynthOptions } from "../../src/lib/hymns/eval/synth";
import { extractFrames } from "../../src/lib/hymns/eval/harness";
import { loadRecognitionBundle, loadResolvedHymn } from "../../src/lib/hymns/library/server";
import { HymnRecognizer, type RecognitionCandidate } from "../../src/lib/hymns/recognize/recognizer";

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args[i + 1] ?? "1") : d; };
const COUNT = Number(flag("count", "30"));
const SECONDS = Number(flag("seconds", "45"));
const OFFSET = Number(flag("offset", "0"));
const SR = 22050;
const V = (voice: NonNullable<SynthOptions["voice"]>) => voice;

const SCEN: { name: string; options: Partial<SynthOptions>; outOnly?: boolean }[] = [
  { name: "solo", options: { voiceOnly: true, voice: V({ singers: 1, vibratoCents: 20, intonationCents: 25 }) } },
  { name: "solo-laag", options: { voiceOnly: true, voice: V({ singers: 1, registerShift: -12, vibratoCents: 20, intonationCents: 25 }) } },
  { name: "solo-andere-toonsoort", options: { voiceOnly: true, voice: V({ singers: 1, registerShift: -5, vibratoCents: 20, intonationCents: 25, driftCents: -40 }) } },
  { name: "solo-ademhaling", options: { voiceOnly: true, breaths: { everyMeasures: 4, seconds: 0.6, jitterSeconds: 0.5 }, voice: V({ singers: 1, vibratoCents: 25, intonationCents: 25 }) } },
  { name: "solo+ruis", options: { voiceOnly: true, noiseDb: -14, voice: V({ singers: 1, vibratoCents: 20, intonationCents: 25 }) } },
  { name: "groep", options: { voiceOnly: true, voice: V({ singers: 6, vibratoCents: 40, intonationCents: 40, lagSeconds: 0.18, octaveJumpProbability: 0.2 }) } },
  // geen zang: mag via de melodie nooit iets voorstellen (alleen "uit" is zinvol, "in" is de gewone instrumentale herkenning)
  { name: "piano", options: { timbre: "piano" }, outOnly: true },
  { name: "ruis+gebabbel", options: { voiceOnly: false, timbre: "piano", noiseDb: -10, chatterDb: 0, singersDb: -40 }, outOnly: true },
];

const bundle = loadRecognitionBundle();
const compById = new Map(bundle.compositions.map((c) => [c.id, c]));
const groups = new Map<string, typeof bundle.members>();
for (const m of bundle.members) groups.set(m.compositionId, [...(groups.get(m.compositionId) ?? []), m]);
const all: RecognitionCandidate[] = [...groups.entries()].map(([id, g]) => ({
  id, number: g[0].number, title: g[0].title, composition: compById.get(id)!,
  sharedWith: g.slice(1).map((m) => ({ number: m.number, title: m.title })), melody: bundle.melodies[id],
}));
const withMelody = [...groups.entries()].filter(([id]) => bundle.melodies[id]);
const step = Math.max(1, Math.floor(withMelody.length / COUNT));
const sample = withMelody.filter((_, i) => i % step === OFFSET % step).slice(0, COUNT);

interface Row { scenario: string; hymn: number; mode: "in" | "uit"; fireAt: number | null; via: string | null; fired: string | null; correct: boolean | null; margin: number | null; cost: number | null; voicedSteps: number | null; streak: number | null; probability: number | null; traj: [number, string, number, number, number, number][] }
const rows: Row[] = [];

function run(frames: ReturnType<typeof extractFrames>, cands: RecognitionCandidate[], truth: Set<number>, scenario: string, hymn: number, mode: "in" | "uit"): Row {
  const rec = new HymnRecognizer(cands);
  let row: Row = { scenario, hymn, mode, fireAt: null, via: null, fired: null, correct: null, margin: null, cost: null, voicedSteps: null, streak: null, probability: null, traj: [] };
  let lastSec = -1;
  for (const f of frames) {
    const st = rec.update(f);
    // verloop van de melodiekop (per seconde), zodat varianten van de beslisregel achteraf op dezelfde metingen vergeleken kunnen worden
    if (st.melodyLead && Math.floor(f.time) !== lastSec) {
      lastSec = Math.floor(f.time);
      const ml = st.melodyLead;
      const num = cands.find((c) => c.id === ml.id)?.number ?? -1;
      row.traj.push([Math.round(f.time * 10) / 10, String(num), Math.round(ml.margin * 1000) / 1000, Math.round(ml.cost * 1000) / 1000, ml.voicedSteps, ml.streak]);
    }
    if (row.via) continue;
    if (st.status === "identified" && st.suggestion && st.via === "melody") {
      const ml = st.melodyLead;
      row = { ...row, fireAt: f.time, via: "melody", fired: `${st.suggestion.number}`, correct: truth.has(st.suggestion.number), margin: ml?.margin ?? null, cost: ml?.cost ?? null, voicedSteps: ml?.voicedSteps ?? null, streak: ml?.streak ?? null, probability: st.suggestion.probability };
      continue;
    }
    if (st.status === "identified" && st.suggestion && st.via === "chroma") {
      row = { ...row, fireAt: f.time, via: "chroma", fired: `${st.suggestion.number}`, correct: truth.has(st.suggestion.number) };
      continue;
    }
  }
  return row;
}

for (const sc of SCEN) {
  for (const [id, g] of sample) {
    const member = g[0];
    const hymn = loadResolvedHymn(member.number)!;
    const synth = synthesizeHymn(hymn.composition, { sampleRate: SR, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.5, seed: member.number, ...sc.options });
    const frames = extractFrames(synth.samples.subarray(0, Math.min(synth.samples.length, SECONDS * SR)), SR);
    const truth = new Set(g.map((m) => m.number));
    if (!sc.outOnly) rows.push(run(frames, all, truth, sc.name, member.number, "in"));
    rows.push(run(frames, all.filter((c) => c.id !== id), truth, sc.name, member.number, "uit"));
    process.stderr.write(".");
  }
  process.stderr.write(` ${sc.name}\n`);
}

const wilsonLow = (k: number, n: number, z = 1.96) => (n === 0 ? null : (k / n + (z * z) / (2 * n) - z * Math.sqrt((k / n) * (1 - k / n) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n));
const summarize = (rs: Row[]) => {
  const fired = rs.filter((r) => r.via === "melody");
  const ok = fired.filter((r) => r.correct).length;
  return { n: rs.length, firedMelody: fired.length, correct: ok, wrong: fired.length - ok, firedChroma: rs.filter((r) => r.via === "chroma").length, precisionLow95: wilsonLow(ok, fired.length) };
};
const bins = [0.03, 0.05, 0.08, 0.12, 0.2, 1];
const byMargin = bins.map((hi, i) => {
  const lo = i === 0 ? 0 : bins[i - 1];
  const rs = rows.filter((r) => r.via === "melody" && r.margin !== null && r.margin >= lo && r.margin < hi);
  const ok = rs.filter((r) => r.correct).length;
  return { margin: `[${lo},${hi})`, fired: rs.length, correct: ok, wrong: rs.length - ok, precisionLow95: wilsonLow(ok, rs.length) };
});
const out = {
  compositions: sample.length, seconds: SECONDS,
  perScenario: Object.fromEntries(SCEN.map((s) => [s.name, { in: summarize(rows.filter((r) => r.scenario === s.name && r.mode === "in")), uit: summarize(rows.filter((r) => r.scenario === s.name && r.mode === "uit")) }])),
  overall: { in: summarize(rows.filter((r) => r.mode === "in")), uit: summarize(rows.filter((r) => r.mode === "uit")) },
  byMargin, rows,
};
if (flag("out")) writeFileSync(flag("out")!, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ ...out, rows: undefined }, null, 1));
