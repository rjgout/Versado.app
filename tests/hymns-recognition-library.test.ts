import assert from "node:assert/strict";
import test from "node:test";
import { constantTempo, synthesizeHymn, type SynthOptions } from "../src/lib/hymns/eval/synth";
import { extractFrames } from "../src/lib/hymns/eval/harness";
import { loadRecognitionBundle, loadResolvedHymn } from "../src/lib/hymns/library/server";
import { candidatesFromBundle } from "../src/lib/hymns/recognize/candidates";
import { CandidatePrefilter, compositionSteps, windowDtw } from "../src/lib/hymns/recognize/prefilter";
import { HymnRecognizer, type RecognitionState } from "../src/lib/hymns/recognize/recognizer";
import { HymnLiveEngine } from "../src/lib/hymns/live";
import type { HymnComposition } from "../src/lib/hymns/types";
import { SAMPLE_RATE } from "./helpers/hymnScenario";

// Herkenning tegen de hele Nederlandse bibliotheek (alle gevalideerde composities), met synthetische opnamen (bekende
// waarheid). De echte begeleidingsopnamen worden gemeten met scripts/hymns/eval-library.ts (docs/hymns/12).

const bundle = loadRecognitionBundle();
const candidates = candidatesFromBundle(bundle);
const comp = (n: number) => loadResolvedHymn(n)!.composition;

function listen(c: HymnComposition, options: Partial<SynthOptions>, seconds: number, cands = candidates) {
  const synth = synthesizeHymn(c, { sampleRate: SAMPLE_RATE, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.3, seed: 5, ...options });
  const frames = extractFrames(synth.samples, synth.sampleRate).filter((f) => f.time < seconds);
  const rec = new HymnRecognizer(cands);
  let state!: RecognitionState;
  let first: { id: string; number: number; time: number } | null = null;
  let maxActive = 0;
  let ms = 0;
  for (const f of frames) {
    const t0 = performance.now();
    state = rec.update(f);
    ms += performance.now() - t0;
    maxActive = Math.max(maxActive, rec.activeCount);
    if (!first && state.status === "identified") first = { id: state.suggestion!.id, number: state.suggestion!.number, time: state.heardSeconds };
  }
  return { state, first, maxActive, msPerFrame: ms / frames.length };
}

test("de bibliotheek is herkenbaar: ruim 100 unieke composities, minder kandidaten dan lofzangen waar melodieën gedeeld worden", () => {
  assert.ok(candidates.length > 100, `kandidaten: ${candidates.length}`);
  assert.ok(candidates.length <= bundle.members.length);
});

test("voorfilter: de juiste compositie staat bij een luisterfragment van 16 s bij de beste twaalf (piano 80/min)", () => {
  const pf = new CandidatePrefilter(candidates);
  for (const n of [24, 82, 5, 12, 14]) {
    const c = comp(n);
    const synth = synthesizeHymn(c, { sampleRate: SAMPLE_RATE, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.3, seed: n });
    const frames = extractFrames(synth.samples, synth.sampleRate).filter((f) => f.time < 16);
    pf.reset();
    for (const f of frames) pf.tracker.push(f);
    const rank = pf.rankNow();
    assert.ok(rank, `${n}: te weinig gehoord`);
    const pos = rank.findIndex((r) => r.id === c.id);
    assert.ok(pos >= 0 && pos < 12, `lofzang ${n} staat op plaats ${pos + 1}`);
  }
});

test("voorfilter: tempo-onafhankelijk genoeg (zelfde melodie, 55 en 100 per minuut, blijft binnen de beste twaalf)", () => {
  const pf = new CandidatePrefilter(candidates);
  const c = comp(14);
  for (const bpm of [55, 100]) {
    const synth = synthesizeHymn(c, { sampleRate: SAMPLE_RATE, laps: 1, timbre: "organ", tempoSegments: constantTempo(bpm), leadInSeconds: 0.3, seed: 3 });
    const frames = extractFrames(synth.samples, synth.sampleRate).filter((f) => f.time < 22);
    pf.reset();
    for (const f of frames) pf.tracker.push(f);
    const pos = pf.rankNow()!.findIndex((r) => r.id === c.id);
    assert.ok(pos < 12, `14 @ ${bpm}: plaats ${pos + 1}`);
  }
  assert.ok(compositionSteps(c).n > 0 && windowDtw(compositionSteps(c), compositionSteps(c)) < 0.05);
});

test("regressie: lofzang 36 bij 55 per minuut (orgel) wordt snel en juist herkend tegen de hele bibliotheek", () => {
  const { first, state, maxActive } = listen(comp(36), { timbre: "organ", tempoSegments: constantTempo(55) }, 45);
  assert.ok(first, `niet herkend: ${state.status}`);
  assert.equal(first.number, 36);
  assert.ok(first.time < 40, `herkend na ${first.time.toFixed(1)} s (was 126 s in de dienstmatrix)`);
  assert.ok(maxActive <= 12, `actieve kandidaten ${maxActive}`);
});

test("herkenning in de hele bibliotheek: juiste uitspraak voor piano en orgel, nooit een verkeerde", () => {
  const cases: [number, Partial<SynthOptions>][] = [
    [24, {}],
    [82, { timbre: "organ", tempoSegments: constantTempo(70) }],
    [5, { tempoSegments: constantTempo(95) }],
  ];
  for (const [n, opts] of cases) {
    const { first, state } = listen(comp(n), opts, 40);
    assert.ok(first, `${n}: niet herkend (${state.status})`);
    assert.equal(first.number, n, `${n}: verkeerd herkend als ${first.number}`);
    assert.ok(first.time < 36, `${n}: herkend na ${first.time.toFixed(1)} s`);
  }
});

test("onbekende melodie (leave-one-out): zonder de eigen kandidaat wordt nooit een andere lofzang voorgesteld (kinderen, galm, gemeentezang)", () => {
  // De te spelen lofzang ontbreekt als kandidaat: dit is wat een lofzang buiten de bibliotheek voor de herkenner is.
  for (const n of [26, 100, 12]) {
    const c = comp(n);
    const without = candidates.filter((cand) => cand.id !== c.id);
    for (const v of [{}, { tempoSegments: constantTempo(100), singersDb: -6, noiseDb: -18, reverbSeconds: 1.8, chatterDb: -14 }]) {
      const { first, state } = listen(c, v, 32, without);
      assert.equal(first, null, `lofzang ${n} (niet in de kandidatenlijst) ten onrechte herkend als ${first?.number}`);
      assert.equal(state.suggestion, null);
    }
  }
});

test("de herkenning rekent per frame zuinig: gemiddeld ruim onder het frame-interval van 46 ms", () => {
  const { msPerFrame } = listen(comp(14), {}, 30);
  assert.ok(msPerFrame < 12, `gemiddeld ${msPerFrame.toFixed(1)} ms per frame`);
});

test("gedeelde melodie: de engine kiest de tekst niet zelf maar vraagt de gebruiker (geen automatisch volgen)", () => {
  const shared = candidates.filter((c) => (c.sharedWith?.length ?? 0) > 0);
  assert.ok(shared.length >= 1);
  const cand = shared[0];
  const hymnsForEngine = [cand.number, ...(cand.sharedWith ?? []).map((m) => m.number)].map((n) => loadResolvedHymn(n)!);
  const engine = new HymnLiveEngine(hymnsForEngine, { autoFollow: true });
  engine.setCandidates([cand]);
  engine.startRecognizing();
  const synth = synthesizeHymn(cand.composition, { sampleRate: SAMPLE_RATE, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.3, seed: 2 });
  const frames = extractFrames(synth.samples, synth.sampleRate).filter((f) => f.time < 25);
  for (const f of frames) engine.pushFrame(f);
  const st = engine.state();
  assert.equal(st.stage, "recognizing", "bij een gedeelde melodie mag de engine niet zelf een tekst kiezen");
  assert.ok(st.recognition?.suggestion, "wel een voorstel");
  assert.ok((st.recognition!.suggestion!.sharedWith.length ?? 0) > 0);
});

test("bibliotheekmodus: een herkende lofzang waarvan de tekst nog niet geladen is, wordt gemeld en daarna gevolgd vanaf het geheugen", () => {
  const target = comp(24);
  const engine = new HymnLiveEngine([], { autoFollow: true });
  engine.setCandidates(candidates);
  engine.startRecognizing();
  const synth = synthesizeHymn(target, { sampleRate: SAMPLE_RATE, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.3, seed: 4 });
  const frames = extractFrames(synth.samples, synth.sampleRate).filter((f) => f.time < 40);
  let need: number | null = null;
  for (const f of frames) {
    engine.pushFrame(f);
    need = engine.state().needHymn;
    if (need !== null) break;
  }
  assert.equal(need, 24);
  assert.equal(engine.state().stage, "recognizing");
  engine.registerHymn(loadResolvedHymn(24)!);
  engine.drainAll();
  assert.equal(engine.state().stage, "following");
  assert.equal(engine.state().choice, "auto");
});
