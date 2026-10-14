import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { constantTempo, synthesizeHymn } from "../src/lib/hymns/eval/synth";
import { extractFrames } from "../src/lib/hymns/eval/harness";
import type { HymnComposition } from "../src/lib/hymns/types";
import { SAMPLE_RATE, accuracy, follow, makeScenario } from "./helpers/hymnScenario";

const unknown = JSON.parse(readFileSync(new URL("./fixtures/hymns/unknown-melodies.json", import.meta.url), "utf8")).compositions as HymnComposition[];

// Rondes, coupletten en synchronisatiestatus. Test 82 op 100/min: één ronde is ~29 s.
const FAST = { tempoSegments: constantTempo(100) } as const;
const T82 = 48;

/** De muziek begint bij het begin van het couplet en de zang ook: de gebruiker bevestigt het zangbegin zelf. */
const SING_FROM_START = (i: number, s: { confirmSingingStart(): void }) => {
  if (i === 30) s.confirmSingingStart();
};

/** Events tot het einde van de muziek: daarna klinkt alleen nog nagalm, en een rondewissel op het allerlaatste frame zegt niets. */
function untilEnd<T extends { time: number }>(events: T[], synthEnd: number): T[] {
  return events.filter((e) => e.time < synthEnd - 0.5);
}

test("rondes: elke nieuwe herhaling van de melodie wordt op de rondegrens herkend en schakelt het couplet door", () => {
  const sc = makeScenario(82, { ...FAST, laps: 3 });
  const { session } = follow(sc.hymn, sc.frames, {}, SING_FROM_START);
  const end = sc.synth.timeAt(T82 * 3);
  const laps = untilEnd(session.events.filter((e) => e.type === "lap"), end);
  assert.deepEqual(laps.map((l) => l.lap), [1, 2], "verwachtte twee rondewissels in drie rondes");
  // de gedetecteerde wissel valt dicht bij het werkelijke moment van de rondegrens
  laps.forEach((l, i) => {
    const truth = sc.synth.timeAt(T82 * (i + 1));
    assert.ok(Math.abs(l.time - truth) < 1.5, `ronde ${l.lap}: ${l.time.toFixed(1)} s versus werkelijk ${truth.toFixed(1)} s`);
  });
  assert.deepEqual(untilEnd(session.events.filter((e) => e.type === "stanza"), end).map((e) => e.stanza), [2, 3]);
});

test("handmatig couplet kiezen herstart de muziekherkenning niet: de posities zijn bit voor bit gelijk", () => {
  const sc = makeScenario(82, { ...FAST, laps: 2 });
  const plain = follow(sc.hymn, sc.frames, {}, SING_FROM_START);
  const picked = follow(sc.hymn, sc.frames, {}, (i, s) => {
    SING_FROM_START(i, s);
    if (i === 400) s.selectStanza(4);
  });
  assert.deepEqual(
    picked.snapshots.map((s) => [s.position, s.bpm, s.confidence]),
    plain.snapshots.map((s) => [s.position, s.bpm, s.confidence]),
    "de keuze van een couplet veranderde de muziekvolging"
  );
  // maar het getoonde couplet is meteen veranderd
  assert.equal(picked.snapshots[400].stanza, 4);
  assert.equal(plain.snapshots[400].stanza, 1);
});

test("een handmatige keuze heeft voorrang: de eerstvolgende rondewissel gaat verder vanaf de gekozen plek", () => {
  const sc = makeScenario(82, { ...FAST, laps: 3 });
  // gebruiker kiest couplet 1 terug net nadat de engine naar 2 is gegaan, en later couplet 4
  let chosen = false;
  const run = follow(sc.hymn, sc.frames, {}, (i, s) => {
    SING_FROM_START(i, s);
    const lap1 = s.events.find((e) => e.type === "lap" && e.lap === 1);
    if (lap1 && !chosen && s.snapshotNow.time > lap1.time + 3) {
      s.selectStanza(1);
      chosen = true;
    }
  });
  const changes = untilEnd(run.session.events.filter((e) => e.type === "stanza"), sc.synth.timeAt(T82 * 3)).map((e) => `${e.stanza}:${e.reason}`);
  assert.deepEqual(changes, ["2:auto-lap", "1:manual", "2:auto-lap"], `onverwachte coupletwissels: ${changes.join(", ")}`);
});

test("gekozen volgorde 1 -> 4: de tweede ronde gaat naar couplet 4 en daarna blijft het staan", () => {
  const sc = makeScenario(82, { ...FAST, laps: 3 });
  const { session } = follow(sc.hymn, sc.frames, {}, (i, s) => {
    if (i === 0) s.setStanzaOrder([1, 4]);
    SING_FROM_START(i, s);
  });
  assert.deepEqual(untilEnd(session.events.filter((e) => e.type === "stanza"), sc.synth.timeAt(T82 * 3)).map((e) => e.stanza), [4]);
});

test("voorspel van een deel van het couplet: de zang begint op de rondegrens, couplet 1 wordt niet doorgeschakeld", () => {
  const sc = makeScenario(82, { ...FAST, laps: 3, startBeat: T82 * 0.7, leadInSeconds: 1.5 });
  const { session } = follow(sc.hymn, sc.frames);
  const end = sc.synth.timeAt(T82 * 3);
  const start = session.events.find((e) => e.type === "phase" && e.phaseEvent === "start");
  assert.ok(start, "geen zangbegin vastgesteld op de rondegrens");
  assert.ok(Math.abs(start.time - sc.synth.timeAt(T82)) < 1.5, `zangbegin ${start.time.toFixed(1)} s versus rondegrens ${sc.synth.timeAt(T82).toFixed(1)} s`);
  assert.deepEqual(untilEnd(session.events.filter((e) => e.type === "lap"), end).map((e) => e.lap), [1]);
  assert.deepEqual(untilEnd(session.events.filter((e) => e.type === "stanza"), end).map((e) => e.stanza), [2], "couplet 2 pas na de eerste echte zangronde");
});

test("verlies en herstel: onbekende muziek midden in het stuk geeft 'verloren' en daarna 'hersteld' en weer gesynchroniseerd", () => {
  const sc = makeScenario(82, { ...FAST, laps: 2 });
  const noise = synthesizeHymn(unknown[0], { sampleRate: SAMPLE_RATE, laps: 1, timbre: "piano", tempoSegments: constantTempo(84), leadInSeconds: 0 });
  const noiseFrames = extractFrames(noise.samples, noise.sampleRate);
  const GAP_START = 20;
  const GAP_END = 38;
  const frames = [
    ...sc.frames.filter((f) => f.time < GAP_START),
    ...noiseFrames.filter((f) => f.time < GAP_END - GAP_START).map((f) => ({ ...f, time: f.time + GAP_START })),
    ...sc.frames.filter((f) => f.time >= GAP_END),
  ];
  const { session, snapshots } = follow(sc.hymn, frames);
  const statuses = session.events.filter((e) => e.type === "status").map((e) => e.to);
  assert.ok(statuses.includes("locked"), "nooit gesynchroniseerd");
  assert.ok(statuses.includes("uncertain"), "geen 'onzeker' tijdens het gat");
  assert.ok(statuses.includes("lost"), `geen 'verloren': ${statuses.join(" > ")}`);
  assert.ok(statuses.includes("recovered"), `geen 'hersteld': ${statuses.join(" > ")}`);
  // na het herstel klopt de positie weer
  const lateOk = accuracy(sc, snapshots.filter((s) => s.time > GAP_END + 12), 1, 0);
  assert.ok(lateOk >= 0.9, `na herstel binnen 1 beat: ${lateOk}`);
  // een tijdens het verlies mogelijk gemiste ronde wordt gemeld in plaats van stil aangenomen
  assert.ok(snapshots.some((s) => s.lapUncertain), "mogelijk gemiste ronde niet gemeld");
});

test("de weergave verschuift niet zolang de synchronisatie onzeker of verloren is", () => {
  const sc = makeScenario(82, { ...FAST, laps: 2 });
  const noise = synthesizeHymn(unknown[0], { sampleRate: SAMPLE_RATE, laps: 1, timbre: "piano", tempoSegments: constantTempo(84), leadInSeconds: 0 });
  const noiseFrames = extractFrames(noise.samples, noise.sampleRate);
  const frames = [
    ...sc.frames.filter((f) => f.time < 20),
    ...noiseFrames.filter((f) => f.time < 18).map((f) => ({ ...f, time: f.time + 20 })),
  ];
  const { snapshots } = follow(sc.hymn, frames, {}, SING_FROM_START);
  const unreliable = snapshots.filter((s) => s.status === "uncertain" || s.status === "lost");
  assert.ok(unreliable.length > 100, "te weinig onzekere frames om te testen");
  const lines = new Set(unreliable.map((s) => `${s.cursor.section}:${s.cursor.line}`));
  assert.equal(lines.size, 1, `de markering sprong tijdens onzekerheid: ${[...lines].join(", ")}`);
  assert.ok(unreliable.every((s) => s.cursor.frozen));
});

test("de markering springt tijdens normaal volgen niet terug binnen een ronde", () => {
  const sc = makeScenario(24, { ...FAST, laps: 1, singersDb: -6, noiseDb: -18, reverbSeconds: 1.8 });
  const { snapshots } = follow(sc.hymn, sc.frames);
  let prev = -1;
  let backwards = 0;
  const endOfMusic = sc.synth.timeAt(sc.cycle); // daarna klinkt alleen nog nagalm
  for (const s of snapshots) {
    if (s.cursor.line < 0 || s.time > endOfMusic) continue;
    const idx = (s.cursor.section === "chorus" ? 100 : 0) + s.cursor.line;
    if (idx < prev) backwards += 1;
    prev = Math.max(prev, idx);
  }
  assert.equal(backwards, 0, "de regelmarkering sprong terug");
});
