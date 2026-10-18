import assert from "node:assert/strict";
import test from "node:test";
import { constantTempo, synthesizeHymn, type SynthOptions } from "../src/lib/hymns/eval/synth";
import { cyclicError, extractFrames } from "../src/lib/hymns/eval/harness";
import { evaluateWords, wordTruth } from "../src/lib/hymns/eval/words";
import { HymnFollowSession, type FollowSnapshot } from "../src/lib/hymns/follow/session";
import { KeyEstimator, foldFrame, melodyHistogram } from "../src/lib/hymns/follow/transpose";
import { HymnLiveEngine } from "../src/lib/hymns/live";
import { candidatesFromBundle } from "../src/lib/hymns/recognize/candidates";
import { loadRecognitionBundle, loadResolvedHymn } from "../src/lib/hymns/library/server";
import { SAMPLE_RATE } from "./helpers/hymnScenario";

// Lofzangen V3, stappen C en D: hybride positievolger (volledige partituur of alleen de zangmelodie), toonsoort en stemming van zang,
// directe zangstart zonder voorspel, woordmeting en de herkenning van zang door dezelfde engine als bij instrumenten.

const BASE = { sampleRate: SAMPLE_RATE, laps: 1, timbre: "piano", leadInSeconds: 0.5, tempoSegments: constantTempo(80) } as const;
const SOLO: Partial<SynthOptions> = { voiceOnly: true, voice: { singers: 1, vibratoCents: 20, intonationCents: 25 } };

function run(number: number, options: Partial<SynthOptions>, seconds: number, config = {}) {
  const hymn = loadResolvedHymn(number)!;
  const synth = synthesizeHymn(hymn.composition, { ...BASE, seed: number, ...options });
  const frames = extractFrames(synth.samples.subarray(0, Math.floor(seconds * SAMPLE_RATE)), SAMPLE_RATE);
  const session = new HymnFollowSession(hymn, config);
  const snaps: FollowSnapshot[] = frames.map((f) => session.pushFrame(f));
  return { hymn, synth, frames, session, snaps };
}

function within1(r: ReturnType<typeof run>, from: number): number {
  let ok = 0;
  let n = 0;
  for (const s of r.snaps) {
    if (s.time < from || r.synth.inPause(s.time)) continue;
    n += 1;
    if (Math.abs(cyclicError(s.position, r.synth.beatAt(s.time), r.hymn.composition.totalBeats)) <= 1) ok += 1;
  }
  return ok / n;
}

test("hybride volger: solozang gebruikt de melodiereferentie, vierstemmige zang en een orgel de volledige partituur", () => {
  const solo = run(2, SOLO, 25);
  assert.equal(solo.snaps.at(-1)!.trackSource, "melody");
  assert.ok(within1(solo, 8) >= 0.95, `solo binnen 1 beat: ${within1(solo, 8)}`);
  const chords = run(2, { voiceOnly: true, voice: { singers: 4, voicing: "chords", vibratoCents: 40, intonationCents: 30, lagSeconds: 0.15 } }, 25);
  assert.equal(chords.snaps.at(-1)!.trackSource, "full");
  assert.ok(within1(chords, 8) >= 0.9, `vierstemmig binnen 1 beat: ${within1(chords, 8)}`);
  const organ = run(2, { timbre: "organ" }, 25);
  assert.equal(organ.snaps.at(-1)!.trackSource, "full");
  // het orgel verliest niets door de melodievolger: even goed als met melodyTracking uit
  const organOff = run(2, { timbre: "organ" }, 25, { melodyTracking: false });
  assert.ok(within1(organ, 8) >= within1(organOff, 8) - 0.01, `orgel ${within1(organ, 8)} t.o.v. ${within1(organOff, 8)}`);
});

test("zonder melodie (of met melodyTracking uit) blijft alles zoals voorheen: alleen de volledige partituur", () => {
  const off = run(2, SOLO, 12, { melodyTracking: false });
  assert.ok(off.snaps.every((s) => s.trackSource === "full"));
  const hymn = loadResolvedHymn(2)!;
  const without = new HymnFollowSession({ ...hymn, melody: null });
  const synth = synthesizeHymn(hymn.composition, { ...BASE, seed: 2, ...SOLO });
  const frames = extractFrames(synth.samples.subarray(0, SAMPLE_RATE * 6), SAMPLE_RATE);
  for (const f of frames) assert.equal(without.pushFrame(f).trackSource, "full");
});

test("toonsoort en octaaf: solo een kwart lager en een octaaf lager wordt gevolgd, met stemming die zakt", () => {
  for (const shift of [-5, -12]) {
    const r = run(2, { voiceOnly: true, voice: { singers: 1, registerShift: shift, vibratoCents: 20, intonationCents: 25, driftCents: shift === -5 ? -40 : 0 } }, 28);
    assert.equal(r.snaps.at(-1)!.trackSource, "melody", `shift ${shift}`);
    assert.ok(within1(r, 10) >= 0.9, `shift ${shift}: binnen 1 beat ${within1(r, 10)}`);
  }
});

test("KeyEstimator en foldFrame: de verschuiving wordt uit de gezongen grondtonen geschat en teruggedraaid", () => {
  const hymn = loadResolvedHymn(2)!;
  assert.ok(Math.abs(melodyHistogram(hymn.melody!).reduce((a, b) => a + b, 0) - 1) < 1e-6);
  const synth = synthesizeHymn(hymn.composition, { ...BASE, seed: 2, voiceOnly: true, voice: { singers: 1, registerShift: -5, vibratoCents: 20, intonationCents: 10 } });
  const est = new KeyEstimator(hymn.melody!, hymn.composition.totalBeats);
  for (const f of extractFrames(synth.samples.subarray(0, SAMPLE_RATE * 12), SAMPLE_RATE)) est.push(f);
  // 5 halve tonen te laag gezongen = -5 = +7 modulo 12
  assert.equal(est.shift, 7);
  assert.ok(Math.abs(est.tuning) < 0.35);
  // foldFrame: genormaliseerd, 12 toonklassen, de energie komt op de teruggeschoven toonklasse
  const chroma = new Float32Array(24);
  chroma[7] = 1;
  const folded = foldFrame({ time: 0, chroma, rmsDb: -20, flux: 0, silent: false }, 7, 0);
  assert.equal(folded.chroma.length, 12);
  assert.ok(Math.abs(folded.chroma[0] - 1) < 1e-6);
});

test("directe zangstart: a capella begint zonder voorspel; een instrumentaal voorspel start nooit vanzelf", () => {
  const solo = run(2, SOLO, 14);
  const start = solo.session.events.find((e) => e.type === "phase" && e.phaseEvent === "start");
  assert.ok(start && start.time < 4.5, `zangstart na ${start?.time}`);
  assert.match(start!.reason ?? "", /voice-start/);
  // de markering loopt mee zodra de positie betrouwbaar is, en nooit vóór de zang
  const marked = solo.snaps.find((s) => s.cursor.word !== null);
  assert.ok(marked && marked.time < 7, `eerste markering na ${marked?.time}`);
  // een piano met voorspel van een heel couplet (instrument) levert geen zangstart op zolang er geen rondegrens is
  const piano = run(2, { timbre: "piano" }, 40);
  assert.ok(!piano.session.events.some((e) => e.type === "phase" && e.phaseEvent === "start"), "piano mag het zingen niet beginnen");
  // met directVoiceStart uit gebeurt er voor zang ook niets
  const off = run(2, SOLO, 14, { phase: { directVoiceStart: false } });
  assert.ok(!off.session.events.some((e) => e.type === "phase" && e.phaseEvent === "start"));
});

test("woordmeting: een solist die langzamer zingt wordt gevolgd, de markering loopt nooit voor op de zang", () => {
  const slow = run(98, { ...SOLO, tempoSegments: constantTempo(60) }, 70);
  const truth = wordTruth(slow.hymn.text, slow.synth);
  assert.ok(truth.length > 20);
  const m = evaluateWords(slow.snaps, truth);
  assert.ok(m.marked >= 0.8, `gemarkeerd ${m.marked}`);
  assert.ok(m.withinOne >= 0.7, `binnen één woord ${m.withinOne}`);
  assert.ok(m.ahead <= 0.08, `markering voor op de zang ${m.ahead}`);
  assert.ok(m.delayMedianMs !== null && m.delayMedianMs < 600, `vertraging ${m.delayMedianMs}`);
});

test("evaluateWords: juiste woorden, vertraging en voorlopen worden apart geteld", () => {
  const truth = [0, 1, 2, 3].map((i) => ({ line: 0, word: i, text: `w${i}`, beat: i, start: 1 + i }));
  const cursor = (word: number | null) => ({ section: "verse" as const, line: 0, word, frozen: false, estimated: false });
  // marker precies op tijd, daarna één woord te vroeg
  const snaps = [0.5, 1.2, 2.2, 3.2, 3.9, 4.2].map((time, i) => ({ time, cursor: cursor(i === 0 ? null : i === 5 ? 3 : Math.min(i - 1, 3)) }));
  const m = evaluateWords(snaps, truth, { tailSeconds: 1 });
  assert.equal(m.words, 4);
  assert.ok(m.exact > 0.5);
  assert.ok(Math.abs((m.firstMarkSeconds ?? 99) - 0.2) < 1e-9);
});

test("herkenning van zang: dezelfde luisterknop herkent een a capella melodie en volgt hem met de melodiereferentie", () => {
  const bundle = loadRecognitionBundle();
  const candidates = candidatesFromBundle(bundle);
  assert.ok(candidates.filter((c) => c.melody).length >= 150);
  const number = 2;
  const hymn = loadResolvedHymn(number)!;
  const synth = synthesizeHymn(hymn.composition, { ...BASE, seed: number, ...SOLO, voice: { singers: 1, registerShift: -5, vibratoCents: 20, intonationCents: 25 } });
  const engine = new HymnLiveEngine([]);
  engine.setCandidates(candidates);
  engine.startRecognizing();
  let followAt: number | null = null;
  const audio = synth.samples.subarray(0, SAMPLE_RATE * 45);
  for (let i = 0; i < audio.length; i += 4096) {
    engine.pushAudio(audio.subarray(i, i + 4096), SAMPLE_RATE, Infinity);
    const st = engine.state();
    if (st.needHymn !== null) engine.registerHymn(loadResolvedHymn(st.needHymn)!);
    if (engine.state().stage === "following" && followAt === null) followAt = (i + 4096) / SAMPLE_RATE;
  }
  assert.ok(followAt !== null, "niet herkend");
  const st = engine.state();
  assert.equal(st.hymn?.number, number);
  assert.equal(st.choice, "auto");
  assert.ok(followAt < 30, `herkend na ${followAt} s`);
  // dezelfde extractor en dezelfde sessie: de volger loopt de gehoorde zang vanaf het begin door
  engine.drainAll();
  assert.equal(engine.state().snapshot?.trackSource, "melody");
});

test("herkenning van zang: een onbekende melodie (niet in de bibliotheek) wordt niet ten onrechte herkend", () => {
  const bundle = loadRecognitionBundle();
  const candidates = candidatesFromBundle(bundle);
  for (const number of [2, 18]) {
    const hymn = loadResolvedHymn(number)!;
    const synth = synthesizeHymn(hymn.composition, { ...BASE, seed: number, ...SOLO });
    const engine = new HymnLiveEngine([]);
    engine.setCandidates(candidates.filter((c) => c.id !== hymn.composition.id));
    engine.startRecognizing();
    const audio = synth.samples.subarray(0, SAMPLE_RATE * 40);
    for (let i = 0; i < audio.length; i += 4096) {
      engine.pushAudio(audio.subarray(i, i + 4096), SAMPLE_RATE, Infinity);
      const st = engine.state();
      if (st.needHymn !== null) engine.registerHymn(loadResolvedHymn(st.needHymn)!);
    }
    assert.notEqual(engine.state().stage, "following", `lofzang ${number}: onbekende melodie ten onrechte herkend als ${engine.state().hymn?.number}`);
  }
});
