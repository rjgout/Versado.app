// Parameter- en algoritmevergelijking op een vaste set moeilijke synthetische gevallen (hetzelfde als in
// docs/hymns/03-SCORE-FOLLOWING-POC.md). Aanroep:
//   npx tsx scripts/hymns/sweep.ts volg '[{"layout":{"splitsHz":[260],"power":0.5}}, {"tracker":{"outlier":0.04,"kappa":10}}]'
//   npx tsx scripts/hymns/sweep.ts herken '[{"tracker":{"rescueFraction":0}}]'
// Elk element heeft optioneel `layout` (kenmerkindeling) en `tracker` (trackerinstellingen).
import { readFileSync } from "node:fs";
import { ChromaExtractor, DEFAULT_LAYOUT, type FeatureLayout } from "../../src/lib/hymns/audio/features";
import { constantTempo, synthesizeHymn, type SynthOptions, type SynthResult } from "../../src/lib/hymns/eval/synth";
import { evaluateTrack, runTracker } from "../../src/lib/hymns/eval/harness";
import { POC_LIBRARY, listHymns } from "../../src/lib/hymns/library";
import { buildReference } from "../../src/lib/hymns/score/reference";
import { HymnRecognizer, type RecognitionCandidate } from "../../src/lib/hymns/recognize/recognizer";
import type { TrackerConfig } from "../../src/lib/hymns/follow/tracker";
import type { HymnComposition } from "../../src/lib/hymns/types";

const mode = process.argv[2] ?? "volg";
const variants: { layout?: FeatureLayout; tracker?: Partial<TrackerConfig>; name?: string }[] = JSON.parse(process.argv[3] ?? "[{}]");
const hymns = listHymns(POC_LIBRARY);
const SR = 22050;

function frames(synth: SynthResult, layout: FeatureLayout) {
  const ex = new ChromaExtractor({ sampleRate: SR, layout });
  const out = [];
  for (let i = 0; i < synth.samples.length; i += 4096) out.push(...ex.push(synth.samples.subarray(i, i + 4096)));
  return out;
}

if (mode === "volg") {
  // 3 lofzangen x 6 omstandigheden. "voorspel" = de opname begint op 25, 55 of 80% van de cyclus.
  const cases: { name: string; comp: HymnComposition; synth: SynthResult }[] = [];
  for (const h of hymns) {
    const T = h.composition.totalBeats;
    const sc: Record<string, Partial<SynthOptions>> = {
      "voorspel 25%": { startBeat: T * 0.25, laps: 2 },
      "voorspel 55%": { startBeat: T * 0.55, laps: 2 },
      "voorspel 80%": { startBeat: T * 0.8, laps: 2 },
      normaal: { laps: 1 },
      "gemeente+ruis+galm": { laps: 1, singersDb: -6, noiseDb: -18, reverbSeconds: 1.8 },
      "orgel+gemeente+galm": { laps: 1, timbre: "organ", singersDb: -4, noiseDb: -20, reverbSeconds: 2.2 },
    };
    for (const [name, extra] of Object.entries(sc)) {
      cases.push({ name: `${h.number} ${name}`, comp: h.composition, synth: synthesizeHymn(h.composition, { sampleRate: SR, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.5, seed: h.number, ...extra }) });
    }
  }
  console.log("| Variant | Gemiddeld binnen 1 beat | Slechtste geval | Gevallen onder 90% |");
  console.log("|---|---|---|---|");
  for (const v of variants) {
    const layout = v.layout ?? DEFAULT_LAYOUT;
    const w: number[] = [];
    const bad: string[] = [];
    for (const c of cases) {
      const ref = buildReference(c.comp, { layout });
      const out = runTracker(frames(c.synth, layout), ref, v.tracker ?? {});
      const m = evaluateTrack(out, c.synth, ref.cycleBeats, { firstNoteSeconds: 0.5, settleSeconds: 6 });
      w.push(m.within1);
      if (m.within1 < 0.9) bad.push(`${c.name} ${(m.within1 * 100).toFixed(0)}%`);
    }
    const label = v.name ?? JSON.stringify({ layout: v.layout, tracker: v.tracker });
    console.log(`| \`${label}\` | ${((w.reduce((a, b) => a + b, 0) / w.length) * 100).toFixed(1)}% | ${(Math.min(...w) * 100).toFixed(0)}% | ${bad.length === 0 ? "geen" : bad.join(", ")} |`);
  }
}

if (mode === "herken") {
  const unknown = JSON.parse(readFileSync(new URL("../../tests/fixtures/hymns/unknown-melodies.json", import.meta.url), "utf8")).compositions as HymnComposition[];
  const cands: RecognitionCandidate[] = hymns.map((h) => ({ id: h.composition.id, number: h.number, title: h.text.title, composition: h.composition }));
  const sources = [...hymns.map((h) => ({ comp: h.composition, truth: h.number as number | null })), ...unknown.map((c) => ({ comp: c, truth: null as number | null }))];
  const conditions: Record<string, Partial<SynthOptions>> = { "piano 80": {}, "orgel 65": { timbre: "organ", tempoSegments: constantTempo(65) }, "piano 100 + gemeente/ruis/galm": { tempoSegments: constantTempo(100), singersDb: -6, noiseDb: -18, reverbSeconds: 1.8 } };
  const data: { truth: number | null; fr: ReturnType<typeof frames>; layout: FeatureLayout }[] = [];
  const cps = [6, 10, 15, 21];
  console.log("| Variant | Bewijs voor de juiste lofzang minus beste andere (minimum over 9 gevallen) na 6/10/15/21 s | Hoogste bewijs voor een onbekende melodie (6 gevallen) na 6/10/15/21 s |");
  console.log("|---|---|---|");
  for (const v of variants) {
    const layout = v.layout ?? DEFAULT_LAYOUT;
    const pos: number[][] = cps.map(() => []);
    const neg: number[][] = cps.map(() => []);
    for (const s of sources) {
      for (const cond of Object.values(conditions)) {
        const synth = synthesizeHymn(s.comp, { sampleRate: SR, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.3, seed: 5, ...cond });
        const fr = frames(synth, layout).filter((f) => f.time < 22);
        const candsL = cands.map((c) => ({ ...c }));
        const rec = new HymnRecognizer(candsL, { tracker: { start: "uniform", particles: 500, rescueFraction: 0, rateSigma: 0.08, ...(v.tracker ?? {}) } });
        let cp = 0;
        for (const f of fr) {
          const st = rec.update(f);
          if (cp < cps.length && f.time >= cps[cp]) {
            const ev = new Map(st.ranking.map((r) => [r.number, r.evidence]));
            if (s.truth) pos[cp].push(ev.get(s.truth)! - Math.max(...[...ev.entries()].filter(([n]) => n !== s.truth).map(([, e]) => e)));
            else neg[cp].push(Math.max(...ev.values()));
            cp += 1;
          }
        }
      }
    }
    void data;
    const label = v.name ?? JSON.stringify({ layout: v.layout, tracker: v.tracker });
    console.log(`| \`${label}\` | ${pos.map((a) => Math.min(...a).toFixed(0)).join(" / ")} | ${neg.map((a) => Math.max(...a).toFixed(0)).join(" / ")} |`);
  }
}
