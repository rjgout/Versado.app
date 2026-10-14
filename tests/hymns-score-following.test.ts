import assert from "node:assert/strict";
import test from "node:test";
import { constantTempo } from "../src/lib/hymns/eval/synth";
import { accuracy, follow, makeScenario, medianError } from "./helpers/hymnScenario";

// Score following op synthetische opnamen met een EXACT bekende tijdlijn (zie src/lib/hymns/eval/synth.ts).
// Elke test haalt de opname door de echte engine (ChromaExtractor -> ScoreTracker -> HymnFollowSession).
// De posities komen uit de muziek, niet uit klokken: de tests gebruiken ook opnamen waarvan het tempo
// verandert of die stilvallen, en controleren dat de engine dat volgt.

test("1. normaal pianotempo: positie binnen 1 beat, mediane fout onder de 0,15 beat en snel gesynchroniseerd", () => {
  const sc = makeScenario(82, { laps: 2 });
  const { snapshots, session } = follow(sc.hymn, sc.frames);
  assert.ok(accuracy(sc, snapshots, 1, 5) >= 0.97, `binnen 1 beat: ${accuracy(sc, snapshots, 1, 5)}`);
  assert.ok(medianError(sc, snapshots, 5) < 0.15, `mediane fout ${medianError(sc, snapshots, 5)}`);
  const locked = session.events.find((e) => e.type === "status" && e.to === "locked");
  assert.ok(locked && locked.time < 8, "niet binnen 8 s gesynchroniseerd");
});

test("2. langzaam pianotempo (55/min)", () => {
  const sc = makeScenario(82, { tempoSegments: constantTempo(55), laps: 1 });
  const { snapshots } = follow(sc.hymn, sc.frames);
  assert.ok(accuracy(sc, snapshots, 1, 6) >= 0.95, `binnen 1 beat: ${accuracy(sc, snapshots, 1, 6)}`);
});

test("3. versneld pianotempo (110/min)", () => {
  const sc = makeScenario(36, { tempoSegments: constantTempo(110), laps: 1 });
  const { snapshots } = follow(sc.hymn, sc.frames);
  assert.ok(accuracy(sc, snapshots, 1, 5) >= 0.95, `binnen 1 beat: ${accuracy(sc, snapshots, 1, 5)}`);
});

test("4. vertraagd orgelspel: de engine volgt een ritardando en meldt het lagere tempo", () => {
  const T = 48;
  const segs = [90, 82, 74, 66, 58, 52].map((bpm, i) => ({ fromBeat: (i * T) / 6, bps: bpm / 60 }));
  const sc = makeScenario(82, { timbre: "organ", tempoSegments: segs, laps: 1 });
  const { snapshots } = follow(sc.hymn, sc.frames);
  assert.ok(accuracy(sc, snapshots, 1, 5) >= 0.93, `binnen 1 beat: ${accuracy(sc, snapshots, 1, 5)}`);
  const early = snapshots.filter((s) => s.time > 6 && s.time < 14).map((s) => s.bpm);
  const late = snapshots.filter((s) => s.time > sc.synth.duration - 14 && s.time < sc.synth.duration - 4).map((s) => s.bpm);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(late) < avg(early) * 0.85, `tempo-schatting daalde niet mee: ${avg(early).toFixed(0)} -> ${avg(late).toFixed(0)}`);
});

test("5. geleidelijk versnellen wordt gevolgd en het tempo loopt mee omhoog", () => {
  const T = 60;
  const segs = [60, 70, 80, 90, 100, 110].map((bpm, i) => ({ fromBeat: (i * T) / 6, bps: bpm / 60 }));
  const sc = makeScenario(36, { tempoSegments: segs, laps: 1 });
  const { snapshots } = follow(sc.hymn, sc.frames);
  assert.ok(accuracy(sc, snapshots, 1, 5) >= 0.93, `binnen 1 beat: ${accuracy(sc, snapshots, 1, 5)}`);
  const early = snapshots.filter((s) => s.time > 5 && s.time < 12).map((s) => s.bpm);
  const late = snapshots.filter((s) => s.time > sc.synth.duration - 12 && s.time < sc.synth.duration - 3).map((s) => s.bpm);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(late) > avg(early) * 1.2, `tempo-schatting steeg niet mee: ${avg(early).toFixed(0)} -> ${avg(late).toFixed(0)}`);
});

test("6. tijdelijke stilte (6 s): de positie wordt vastgehouden, niet doorgeschoven, en daarna volgt de engine weer", () => {
  const T = 48;
  const sc = makeScenario(82, { laps: 2, pauses: [{ atBeat: T * 0.6, seconds: 6 }] });
  const { snapshots } = follow(sc.hymn, sc.frames);
  const pauseFrames = snapshots.filter((s) => s.paused && sc.synth.inPause(s.time));
  assert.ok(pauseFrames.length > 40, "stilte is niet herkend");
  // tijdens de stilte verandert de positie niet
  const positions = pauseFrames.map((s) => s.position);
  assert.ok(Math.max(...positions) - Math.min(...positions) < 0.01, "positie schoof tijdens de stilte");
  // na de stilte: terug binnen 1 beat nadat er weer klank is
  const resume = snapshots.find((s) => !s.paused && sc.synth.beatAt(s.time) > T * 0.6 + 0.2 && s.time > sc.synth.timeAt(T * 0.6) + 6);
  assert.ok(resume);
  assert.ok(accuracy(sc, snapshots.filter((s) => s.time > resume!.time + 3), 1, 0) >= 0.9, "na de stilte niet hersteld");
});

test("7. fermate/pauze met uitklinkend akkoord leidt niet tot doorspringen", () => {
  const T = 60;
  const sc = makeScenario(36, { laps: 1, pauses: [{ atBeat: T * 0.5, seconds: 4, ringOut: true }] });
  const { snapshots } = follow(sc.hymn, sc.frames);
  // tijdens de fermate nooit meer dan 2,6 beat voorbij het vastgehouden punt (gemeten: 2,0; het akkoord klinkt
  // nog 2,5 s door en klinkt voor de engine als doorgaande muziek, ruim 3 beat bij 80/min)
  const holdBeat = T * 0.5;
  const during = snapshots.filter((s) => sc.synth.inPause(s.time));
  for (const s of during) {
    const ahead = ((s.position - holdBeat + T) % T);
    assert.ok(ahead < 2.6 || ahead > T - 3, `sprong ${ahead.toFixed(1)} beat vooruit tijdens de fermate`);
  }
  assert.ok(accuracy(sc, snapshots.filter((s) => s.time > sc.synth.timeAt(holdBeat) + 8), 1.5, 0) >= 0.9);
});

test("8. verkeerde noten (25% in een deel van het stuk): de engine blijft bij of herstelt zichzelf", () => {
  const T = 48;
  const sc = makeScenario(82, { laps: 2, wrongNoteProbability: 0.25, wrongNoteRange: [T * 0.3, T * 0.7] });
  const { snapshots } = follow(sc.hymn, sc.frames);
  assert.ok(accuracy(sc, snapshots, 1, 5) >= 0.88, `binnen 1 beat: ${accuracy(sc, snapshots, 1, 5)}`);
});

test("9. achtergrondgeluid: gemeentezang, ruis en nagalm samen", () => {
  const sc = makeScenario(24, { laps: 1, singersDb: -6, noiseDb: -18, reverbSeconds: 1.8 });
  const { snapshots } = follow(sc.hymn, sc.frames);
  assert.ok(accuracy(sc, snapshots, 1, 6) >= 0.88, `binnen 1 beat: ${accuracy(sc, snapshots, 1, 6)}`);
});

test("10. voorspel: de opname begint midden in de cyclus en de engine vindt zijn plaats zonder vast beginpunt", () => {
  const sc = makeScenario(82, { laps: 2, startBeat: 48 * 0.7 });
  const { snapshots } = follow(sc.hymn, sc.frames);
  assert.ok(accuracy(sc, snapshots, 1, 6) >= 0.93, `binnen 1 beat: ${accuracy(sc, snapshots, 1, 6)}`);
});

test("11. de positie hangt niet af van verstreken seconden: dezelfde muziek op twee tempo's geeft dezelfde partituurpositie", () => {
  const slow = makeScenario(82, { tempoSegments: constantTempo(60) });
  const fast = makeScenario(82, { tempoSegments: constantTempo(100) });
  const a = follow(slow.hymn, slow.frames).snapshots;
  const b = follow(fast.hymn, fast.frames).snapshots;
  // op 25% van de speeltijd staan beide ongeveer op dezelfde plek in de partituur (nooit op dezelfde seconde)
  const at = (snaps: typeof a, frac: number) => snaps[Math.floor(snaps.length * frac)].position;
  for (const f of [0.3, 0.5, 0.7]) {
    const d = Math.abs(at(a, f) - at(b, f));
    assert.ok(d < 2.5, `bij ${f * 100}% verschillen de posities ${d.toFixed(1)} beat`);
  }
  assert.ok(Math.abs(slow.synth.duration - fast.synth.duration) > 15, "testopnamen hebben te weinig verschil in duur");
});

test("12. werkt ook op de samplefrequenties van echte telefoons (44,1 en 48 kHz)", () => {
  for (const sampleRate of [44100, 48000]) {
    const sc = makeScenario(82, { sampleRate, tempoSegments: constantTempo(90), laps: 1 });
    const { snapshots, session } = follow(sc.hymn, sc.frames);
    assert.ok(accuracy(sc, snapshots, 1, 6) >= 0.95, `${sampleRate} Hz: binnen 1 beat ${accuracy(sc, snapshots, 1, 6)}`);
    assert.ok(session.events.some((e) => e.type === "status" && e.to === "locked"));
  }
});
