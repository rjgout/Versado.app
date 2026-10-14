import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { constantTempo, synthesizeHymn } from "../src/lib/hymns/eval/synth";
import { POC_LIBRARY, listHymns, resolveHymn } from "../src/lib/hymns/library";
import { HymnLiveEngine } from "../src/lib/hymns/live";
import type { HymnComposition, ResolvedHymn } from "../src/lib/hymns/types";
import { SAMPLE_RATE, follow, makeService } from "./helpers/hymnScenario";

// Herkennen en volgen zijn één luistersessie: dezelfde extractor, geen nieuwe microfoon, en de volger heeft
// het voorspel ook gehoord.

const HYMNS = listHymns(POC_LIBRARY);
const BPM = 90;
const FAST = { tempoSegments: constantTempo(BPM) } as const;
const SINGERS = { ...FAST, singersDb: -6 } as const;
const unknown = JSON.parse(readFileSync(new URL("./fixtures/hymns/unknown-melodies.json", import.meta.url), "utf8")).compositions as HymnComposition[];

function feed(engine: HymnLiveEngine, samples: Float32Array, chunk = 4096, onChunk?: (t: number) => void): void {
  for (let i = 0; i < samples.length; i += chunk) {
    engine.pushAudio(samples.subarray(i, Math.min(samples.length, i + chunk)), SAMPLE_RATE, Infinity);
    onChunk?.((i + chunk) / SAMPLE_RATE);
  }
}

test("scenario K: de juiste lofzang wordt midden in het voorspel herkend en de volger neemt over zonder nieuwe audiosessie", () => {
  // Voorspel van een heel couplet, een stilte, dan de zang: de herkenning valt ruim vóór het zangbegin.
  const sv = makeService(82, [{ options: FAST }, { gapBefore: 2.5, options: { ...SINGERS, laps: 2 } }]);
  const engine = new HymnLiveEngine(HYMNS);
  engine.startRecognizing();
  let extractorAtRecognition: unknown = null;
  let stageAtHandover: string | null = null;
  let handoverTime = 0;
  feed(engine, sv.samples, 4096, (t) => {
    if (extractorAtRecognition === null && engine.extractorInstance) extractorAtRecognition = engine.extractorInstance;
    if (stageAtHandover === null && engine.currentStage === "following") {
      stageAtHandover = engine.currentStage;
      handoverTime = t;
    }
  });
  assert.equal(stageAtHandover, "following", "geen automatische overgang naar volgen");
  assert.equal(engine.currentHymn?.number, 82);
  assert.equal(engine.state().choice, "auto");
  assert.ok(handoverTime < sv.partEnd[0] - 1, `overgang pas na het voorspel (${handoverTime.toFixed(1)} s, voorspel eindigt ${sv.partEnd[0].toFixed(1)} s)`);
  // dezelfde extractor, dus dezelfde audiopijplijn
  assert.equal(engine.extractorInstance, extractorAtRecognition);
  // de volger staat waar hij zou staan als hij vanaf het begin had meegeluisterd (bit voor bit)
  engine.drainAll();
  const direct = follow(sv.hymn, sv.frames);
  const a = engine.followSession!.snapshotNow;
  const b = direct.session.snapshotNow;
  assert.deepEqual([a.position, a.bpm, a.confidence, a.status, a.stanza, a.phase.phase], [b.position, b.bpm, b.confidence, b.status, b.stanza, b.phase.phase]);
  // en het zangbegin na de stilte is vastgesteld op basis van het volledige voorspel
  assert.equal(engine.followSession!.snapshotNow.phase.startReason, "wrap-gap");
});

test("herkende lofzang: tekst staat klaar, er is geen markering voor het zangbegin", () => {
  const sv = makeService(36, [{ options: FAST }, { gapBefore: 2.5, options: SINGERS }]);
  const engine = new HymnLiveEngine(HYMNS);
  engine.startRecognizing();
  let markedEarly = false;
  feed(engine, sv.samples, 4096, (t) => {
    const snap = engine.state().snapshot;
    if (snap && snap.cursor.line >= 0 && t < sv.partStart[1] - 0.5) markedEarly = true;
  });
  assert.equal(engine.currentHymn?.number, 36);
  assert.equal(markedEarly, false);
});

test("meerdere even goede kandidaten: de engine kiest niet zelf, de gebruiker kiest zonder nieuwe audiosessie", () => {
  const h24 = resolveHymn(POC_LIBRARY, 24)!;
  const twin: ResolvedHymn = { ...h24, number: 99, composition: { ...h24.composition, id: "comp:twin" }, text: { ...h24.text, title: "Tweeling" } };
  const sv = makeService(24, [{ options: FAST }], {});
  const engine = new HymnLiveEngine([h24, twin]);
  engine.startRecognizing();
  feed(engine, sv.samples);
  const state = engine.state();
  assert.equal(engine.currentStage, "recognizing");
  assert.equal(state.recognition?.status, "ambiguous");
  assert.equal(state.recognition?.suggestion, null);
  const extractor = engine.extractorInstance;
  engine.followHymn(24, "manual");
  engine.drainAll();
  assert.equal(engine.currentStage, "following");
  assert.equal(engine.state().choice, "manual");
  assert.equal(engine.extractorInstance, extractor);
  assert.ok(engine.followSession!.snapshotNow.time > 10, "de volger kreeg het voorspel niet te horen");
});

test("een onbekende melodie wordt nooit automatisch gevolgd", () => {
  const synth = synthesizeHymn(unknown[0], { sampleRate: SAMPLE_RATE, laps: 1, timbre: "piano", tempoSegments: constantTempo(84), leadInSeconds: 1, seed: 3 });
  const engine = new HymnLiveEngine(HYMNS);
  engine.startRecognizing();
  feed(engine, synth.samples);
  assert.equal(engine.currentStage, "recognizing");
  assert.notEqual(engine.state().recognition?.status, "identified");
});

test("zonder automatisch volgen blijft een herkende lofzang een voorstel", () => {
  const sv = makeService(82, [{ options: FAST }, { gapBefore: 2.5, options: SINGERS }]);
  const engine = new HymnLiveEngine(HYMNS, { autoFollow: false });
  engine.startRecognizing();
  feed(engine, sv.samples);
  assert.equal(engine.currentStage, "recognizing");
  assert.equal(engine.state().recognition?.suggestion?.number, 82);
});

test("wissel van lofzang tijdens het luisteren herstart de extractor niet en speelt het geheugen opnieuw af", () => {
  const sv = makeService(82, [{ options: FAST }, { gapBefore: 2.5, options: SINGERS }]);
  const engine = new HymnLiveEngine(HYMNS);
  engine.followHymn(24, "manual");
  let switched = false;
  let extractor: unknown = null;
  feed(engine, sv.samples, 4096, (t) => {
    if (!switched && t > 10) {
      switched = true;
      extractor = engine.extractorInstance;
      engine.followHymn(82, "manual");
    }
  });
  assert.equal(engine.extractorInstance, extractor);
  assert.equal(engine.currentHymn?.number, 82);
  engine.drainAll();
  const direct = follow(sv.hymn, sv.frames);
  const a = engine.followSession!.snapshotNow;
  assert.deepEqual([a.position, a.confidence, a.phase.phase], [direct.session.snapshotNow.position, direct.session.snapshotNow.confidence, direct.session.snapshotNow.phase.phase]);
});

test("achterstand: met een heel klein tijdsbudget wordt het geheugen toch volledig en in dezelfde volgorde verwerkt", () => {
  const sv = makeService(82, [{ options: FAST }, { gapBefore: 2.5, options: SINGERS }]);
  const a = new HymnLiveEngine(HYMNS, { autoFollow: false });
  feed(a, sv.samples.subarray(0, Math.floor(20 * SAMPLE_RATE)));
  a.followHymn(82, "manual");
  assert.ok(a.backlog > 100, "geheugen niet in de wachtrij gezet");
  let rounds = 0;
  while (a.drain(0.01)) rounds += 1;
  assert.ok(rounds > 1, "niet in stukken verwerkt");
  const b = new HymnLiveEngine(HYMNS, { autoFollow: false });
  b.followHymn(82, "manual");
  feed(b, sv.samples.subarray(0, Math.floor(20 * SAMPLE_RATE)));
  assert.equal(a.followSession!.snapshotNow.position, b.followSession!.snapshotNow.position);
  assert.equal(a.backlog, 0);
});

test("coupletkeuze en volgorde overleven een wissel naar volgen", () => {
  const sv = makeService(82, [{ options: FAST }, { gapBefore: 2.5, options: { ...SINGERS, laps: 2 } }]);
  const engine = new HymnLiveEngine(HYMNS);
  engine.setStanzaOrder([1, 4]);
  engine.startRecognizing();
  feed(engine, sv.samples);
  engine.drainAll();
  const stanzas = engine.followSession!.events.filter((e) => e.type === "stanza").map((e) => e.stanza);
  assert.ok(stanzas.includes(4) && !stanzas.includes(2), `coupletwissels: ${stanzas.join(", ")}`);
});

test("herstart: een nieuwe luistersessie begint schoon", () => {
  const engine = new HymnLiveEngine(HYMNS);
  engine.followHymn(24);
  engine.restart();
  assert.equal(engine.currentStage, "idle");
  assert.equal(engine.currentHymn, null);
  assert.equal(engine.backlog, 0);
});
