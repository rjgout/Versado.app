import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { constantTempo, synthesizeHymn, type SynthOptions } from "../src/lib/hymns/eval/synth";
import { extractFrames } from "../src/lib/hymns/eval/harness";
import { POC_LIBRARY, listHymns } from "../src/lib/hymns/library";
import { HymnRecognizer, type RecognitionCandidate, type RecognitionState } from "../src/lib/hymns/recognize/recognizer";
import type { HymnComposition } from "../src/lib/hymns/types";
import { SAMPLE_RATE } from "./helpers/hymnScenario";

const unknown = JSON.parse(readFileSync(new URL("./fixtures/hymns/unknown-melodies.json", import.meta.url), "utf8")).compositions as HymnComposition[];

const candidates: RecognitionCandidate[] = listHymns(POC_LIBRARY).map((h) => ({ id: h.composition.id, number: h.number, title: h.text.title, composition: h.composition }));

function listen(comp: HymnComposition, options: Partial<SynthOptions>, seconds = 30, cands = candidates) {
  const synth = synthesizeHymn(comp, { sampleRate: SAMPLE_RATE, laps: 1, timbre: "piano", tempoSegments: constantTempo(80), leadInSeconds: 0.3, seed: 5, ...options });
  const frames = extractFrames(synth.samples, synth.sampleRate).filter((f) => f.time < seconds);
  const rec = new HymnRecognizer(cands);
  let state!: RecognitionState;
  let firstIdentified: { number: number; time: number } | null = null;
  for (const f of frames) {
    state = rec.update(f);
    if (!firstIdentified && state.status === "identified") firstIdentified = { number: state.suggestion!.number, time: f.time };
  }
  return { state, firstIdentified };
}

// "Herken lofzang": alleen de drie proeflofzangen als kandidaten. Dit is een afzonderlijk resultaat van het volgen.

test("herkenning: elke proeflofzang wordt binnen 12 s en zonder voorkennis van tempo herkend (piano 80/min)", () => {
  for (const c of candidates) {
    const { firstIdentified, state } = listen(c.composition, {}, 14);
    assert.ok(firstIdentified, `${c.number}: niet herkend (${state.status}: ${state.ranking.map((r) => `${r.number}=${r.evidence.toFixed(0)}`).join(", ")})`);
    assert.equal(firstIdentified.number, c.number);
    assert.ok(firstIdentified.time < 12, `${c.number}: herkend na ${firstIdentified.time.toFixed(1)} s`);
  }
});

test("herkenning werkt ook bij een ander tempo, ander instrument en een voorspel dat midden in het stuk begint", () => {
  const variants: Partial<SynthOptions>[] = [
    { timbre: "organ", tempoSegments: constantTempo(65) },
    { tempoSegments: constantTempo(55) },
    {},
  ];
  for (const [i, v] of variants.entries()) {
    const target = candidates[i];
    const startBeat = i === 2 ? target.composition.totalBeats * 0.55 : 0;
    const { firstIdentified } = listen(target.composition, { ...v, startBeat }, 22);
    assert.equal(firstIdentified?.number, target.number, `variant ${i}: ${JSON.stringify(firstIdentified)}`);
  }
});

test("onbekende lofzang: er wordt nooit een van de drie voorgesteld (3 onbekende melodieën, 3 omstandigheden)", () => {
  for (const comp of unknown) {
    for (const v of [{}, { timbre: "organ" as const, tempoSegments: constantTempo(65) }, { tempoSegments: constantTempo(100), singersDb: -6, noiseDb: -18, reverbSeconds: 1.8 }]) {
      const { firstIdentified, state } = listen(comp, v, 30);
      assert.equal(firstIdentified, null, `${comp.id}: ten onrechte herkend als ${firstIdentified?.number}`);
      assert.notEqual(state.status, "identified");
      assert.equal(state.suggestion, null);
    }
  }
});

test("onbekend wordt als onbekend gemeld na voldoende luistertijd, niet als een gok", () => {
  const { state } = listen(unknown[0], {}, 32);
  assert.equal(state.status, "unknown");
  assert.ok(state.ranking.every((r) => r.evidence < 70), "bewijs voor een onbekende melodie mag de drempel niet halen");
});

test("ambigu: twee lofzangen met dezelfde melodie worden niet als één lofzang voorgesteld", () => {
  const alias: RecognitionCandidate = {
    id: "comp:alias-van-24",
    number: 999,
    title: "Andere tekst op dezelfde melodie",
    composition: { ...candidates[0].composition, id: "comp:alias-van-24" },
  };
  const { state, firstIdentified } = listen(candidates[0].composition, {}, 30, [candidates[0], alias, candidates[1]]);
  assert.equal(firstIdentified, null, "een ambigue melodie werd als eenduidig voorgesteld");
  assert.equal(state.status, "ambiguous");
  const top2 = state.ranking.slice(0, 2).map((r) => r.number).sort();
  assert.deepEqual(top2, [24, 999]);
});

test("kansen zijn nooit kunstmatig hoog zonder bewijs: bij stilte of ruis blijft de stand 'luisteren'", () => {
  const rec = new HymnRecognizer(candidates);
  let state!: RecognitionState;
  const silent = { time: 0, chroma: new Float32Array(24), rmsDb: -120, flux: 0, silent: true };
  for (let i = 0; i < 400; i += 1) state = rec.update({ ...silent, time: i * 0.046 });
  assert.equal(state.status, "listening");
  assert.equal(state.heardSeconds, 0);
  assert.equal(state.suggestion, null);
  assert.ok(state.ranking.every((r) => r.evidence === 0));
});

test("herkenning kiest niet altijd iets: ruis (willekeurige toonklassen) geeft geen voorstel", () => {
  const rec = new HymnRecognizer(candidates);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  let state!: RecognitionState;
  for (let i = 0; i < 700; i += 1) {
    const chroma = new Float32Array(24);
    let n = 0;
    for (let k = 0; k < 24; k += 1) {
      chroma[k] = rnd();
      n += chroma[k] ** 2;
    }
    n = Math.sqrt(n);
    for (let k = 0; k < 24; k += 1) chroma[k] /= n;
    state = rec.update({ time: i * 0.046, chroma, rmsDb: -30, flux: 0.1, silent: false });
  }
  assert.notEqual(state.status, "identified");
  assert.equal(state.suggestion, null);
});
