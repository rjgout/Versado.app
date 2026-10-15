import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { constantTempo, synthesizeHymn } from "../src/lib/hymns/eval/synth";
import { POC_LIBRARY, listHymns } from "../src/lib/hymns/library";
import { loadRecognitionBundle, loadResolvedHymn } from "../src/lib/hymns/library/server";
import { HymnLiveEngine } from "../src/lib/hymns/live";
import { candidatesFromBundle } from "../src/lib/hymns/recognize/candidates";
import type { HymnComposition } from "../src/lib/hymns/types";
import { audioMissing } from "../src/components/hymns-poc/viewModel";
import { readWav } from "../scripts/hymns/wav";
import { SAMPLE_RATE, makeService } from "./helpers/hymnScenario";

// Regressiebescherming voor de live audioketen (extractor -> herkenner of volger -> positie -> UI), na de regressie van 15 oktober 2026
// (zie docs/hymns/19-REGRESSIE-LIVE-AUDIO.md). Wat hier wordt getest is de WEBKETEN en de engine; de microfoon, AudioContext en het
// achtergrondgedrag van een echte iPhone testen deze bestanden NIET.
//
// De tests met een echt audiobestand lezen het pad uit HYMNS_REAL_AUDIO_82 (mono 16-bit WAV van de officiële begeleiding van lofzang 82);
// het bestand staat nooit in git (bronrechten). Zonder dat bestand worden alleen die tests overgeslagen.

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const HYMNS = listHymns(POC_LIBRARY);
const FAST = { tempoSegments: constantTempo(90) } as const;
const SINGERS = { ...FAST, singersDb: -6 } as const;
const unknown = JSON.parse(readFileSync(new URL("./fixtures/hymns/unknown-melodies.json", import.meta.url), "utf8")).compositions as HymnComposition[];

function feed(engine: HymnLiveEngine, samples: Float32Array, rate: number, chunk = 2048, onChunk?: (t: number) => void): void {
  for (let i = 0; i < samples.length; i += chunk) {
    // zoals de client: een klein budget per audiobuffer (8 ms) en een flush van 8 ms per 100 ms audio
    engine.pushAudio(samples.subarray(i, Math.min(samples.length, i + chunk)), rate, 8);
    if (Math.floor(i / rate / 0.1) !== Math.floor((i + chunk) / rate / 0.1)) engine.drain(8);
    onChunk?.(i / rate);
  }
  engine.drainAll();
}

function libraryEngine(): HymnLiveEngine {
  const engine = new HymnLiveEngine([]);
  engine.setCandidates(candidatesFromBundle(loadRecognitionBundle()));
  return engine;
}

test("de oorspronkelijke drie proeflofzangen (24, 36, 82) worden direct gevolgd", () => {
  for (const number of [24, 36, 82]) {
    const sv = makeService(number, [{ options: FAST }, { gapBefore: 2.5, options: { ...SINGERS, laps: 1 } }]);
    const engine = new HymnLiveEngine(HYMNS);
    engine.followHymn(number, "manual");
    feed(engine, sv.samples, SAMPLE_RATE);
    const snap = engine.state().snapshot!;
    assert.ok(["locked", "recovered"].includes(snap.status), `lofzang ${number}: status ${snap.status}`);
    assert.ok(snap.time > sv.duration - 2, `lofzang ${number}: niet alle audio verwerkt`);
  }
});

test("de herkenningsbundel van de volledige bibliotheek laadt en bevat de proeflofzangen", () => {
  const bundle = loadRecognitionBundle();
  assert.ok(bundle.compositions.length >= 150, `slechts ${bundle.compositions.length} composities`);
  const candidates = candidatesFromBundle(bundle);
  assert.ok(candidates.length >= 150);
  for (const number of [24, 36, 82]) assert.ok(candidates.some((c) => c.number === number || (c.sharedWith ?? []).some((s) => s.number === number)), `lofzang ${number} ontbreekt`);
  assert.ok(Object.keys(bundle.calibration).length > 100, "kalibratie ontbreekt");
});

test("volledige bibliotheek: lofzang 82 wordt herkend, de tekst wordt aangeleverd en de engine volgt automatisch (zoals de app)", () => {
  const sv = makeService(82, [{ options: FAST }, { gapBefore: 2.5, options: { ...SINGERS, laps: 2 } }]);
  const engine = libraryEngine();
  engine.startRecognizing();
  let needed: number | null = null;
  let followedAt: number | null = null;
  feed(engine, sv.samples, SAMPLE_RATE, 4096, (t) => {
    const st = engine.state();
    // de app haalt de tekst op zodra de herkenning een lofzang kiest (needHymn) en meldt hem met registerHymn
    if (st.needHymn !== null && needed === null) {
      needed = st.needHymn;
      engine.registerHymn(loadResolvedHymn(st.needHymn)!);
    }
    if (followedAt === null && st.stage === "following") followedAt = t;
  });
  assert.equal(needed, 82, "de herkenning koos niet lofzang 82");
  assert.equal(engine.currentHymn?.number, 82);
  assert.equal(engine.state().choice, "auto");
  assert.ok(followedAt !== null && followedAt < sv.partEnd[0] - 1, `overgang pas na het voorspel (${followedAt})`);
});

test("herkenning wacht op de gegevens (microfoon luistert al): het geheugen wordt daarna alsnog doorlopen", () => {
  const sv = makeService(82, [{ options: FAST }, { gapBefore: 2.5, options: { ...SINGERS, laps: 1 } }]);
  const engine = new HymnLiveEngine([]);
  engine.startRecognizing({ awaitCandidates: true });
  assert.equal(engine.state().diag.awaitingCandidates, true);
  // 40 s luisteren zonder herkenningsgegevens (bijvoorbeeld een trage of mislukte server): niets gaat verloren en niets crasht
  feed(engine, sv.samples.subarray(0, Math.floor(40 * SAMPLE_RATE)), SAMPLE_RATE);
  assert.equal(engine.currentStage, "recognizing");
  assert.ok(engine.state().diag.frames > 700, "er zijn geen frames geproduceerd terwijl de gegevens ontbraken");
  engine.setCandidates(candidatesFromBundle(loadRecognitionBundle()));
  engine.drainAll();
  assert.equal(engine.state().diag.awaitingCandidates, false);
  assert.ok(engine.state().diag.candidates >= 150);
  assert.ok(engine.state().recognition, "de herkenner is niet gestart nadat de gegevens binnenkwamen");
});

test("duurtest: ruim twee minuten audio, de keten blijft frames produceren en de positie blijft vooruitgaan", () => {
  const sv = makeService(82, [{ options: FAST }, { gapBefore: 2, options: { ...SINGERS, laps: 3 } }]);
  assert.ok(sv.duration > 130, `de testopname is maar ${sv.duration.toFixed(0)} s`);
  const engine = new HymnLiveEngine(HYMNS);
  engine.followHymn(82, "manual");
  let lastFrames = 0;
  const positions: number[] = [];
  let stalls = 0;
  let nextCheck = 10;
  feed(engine, sv.samples, SAMPLE_RATE, 2048, (t) => {
    if (t >= nextCheck) {
      nextCheck += 10;
      const st = engine.state();
      if (st.diag.frames <= lastFrames) stalls += 1;
      lastFrames = st.diag.frames;
      if (st.snapshot) positions.push(st.snapshot.position);
    }
  });
  const st = engine.state();
  assert.equal(stalls, 0, "de keten stopte met frames produceren");
  assert.ok(st.diag.frames > sv.duration * 18, `te weinig frames: ${st.diag.frames}`);
  assert.equal(st.backlog, 0);
  assert.ok(new Set(positions.map((p) => Math.round(p))).size > 10, "de positie schreed niet voort");
  assert.ok(["locked", "recovered"].includes(st.snapshot!.status));
});

test("een onbekende melodie: de engine blijft luisteren (geen stop, geen crash) en kiest nooit zelf", () => {
  const candidates = candidatesFromBundle(loadRecognitionBundle());
  const engine = new HymnLiveEngine([]);
  engine.setCandidates(candidates);
  engine.startRecognizing();
  const synth = synthesizeHymn(unknown[0], { sampleRate: SAMPLE_RATE, laps: 4, timbre: "piano", tempoSegments: constantTempo(84), leadInSeconds: 1, seed: 3 });
  assert.ok(synth.samples.length / SAMPLE_RATE > 120);
  feed(engine, synth.samples, SAMPLE_RATE);
  assert.equal(engine.currentStage, "recognizing");
  assert.notEqual(engine.state().recognition?.status, "identified");
  assert.ok(engine.state().diag.frames > 120 * 18, "de keten bleef niet draaien");
});

const REAL = process.env.HYMNS_REAL_AUDIO_82;
const realTest = REAL && existsSync(REAL) ? test : test.skip;

realTest("ECHT AUDIO (officiële begeleiding, lofzang 82): direct volgen vindt de positie en schrijdt voort", () => {
  const { samples, sampleRate } = readWav(REAL!);
  const engine = new HymnLiveEngine(HYMNS);
  engine.followHymn(82, "manual");
  const positions: number[] = [];
  feed(engine, samples, sampleRate, 2048, (t) => {
    if (Math.floor(t * 10) % 200 === 0) {
      const s = engine.state().snapshot;
      if (s) positions.push(s.position);
    }
  });
  const s = engine.state().snapshot!;
  assert.ok(["locked", "recovered"].includes(s.status), `status ${s.status}`);
  assert.ok(s.lap >= 3, `slechts ${s.lap} rondes`);
  assert.ok(new Set(positions.map((p) => Math.round(p))).size > 10);
  assert.equal(s.phase.phase === "singing" || s.phase.phase === "interlude" || s.phase.phase === "prelude", true);
});

realTest("ECHT AUDIO (officiële begeleiding, lofzang 82): de volledige bibliotheek herkent hem en gaat automatisch volgen", () => {
  const { samples, sampleRate } = readWav(REAL!);
  const engine = libraryEngine();
  engine.startRecognizing();
  let firstSuggestion: number | null = null;
  feed(engine, samples, sampleRate, 2048, (t) => {
    const st = engine.state();
    if (st.needHymn !== null) engine.registerHymn(loadResolvedHymn(st.needHymn)!);
    if (firstSuggestion === null && st.recognition?.suggestion) firstSuggestion = t;
  });
  assert.equal(engine.currentStage, "following");
  assert.equal(engine.currentHymn?.number, 82);
  assert.ok(firstSuggestion !== null && firstSuggestion < 120, `voorstel pas na ${firstSuggestion} s`);
  assert.ok(["locked", "recovered"].includes(engine.state().snapshot!.status));
});

test("audioMissing: stilte in de keten (geen buffers of te lang geen buffer) wordt gemeld, een gezonde keten niet", () => {
  assert.equal(audioMissing(null), false);
  assert.equal(audioMissing({ state: "idle", buffers: 0, msListening: null, msSinceLastBuffer: null }), false);
  assert.equal(audioMissing({ state: "listening", buffers: 0, msListening: 1500, msSinceLastBuffer: null }), false, "de eerste seconden zijn nog opstarten");
  assert.equal(audioMissing({ state: "listening", buffers: 0, msListening: 4000, msSinceLastBuffer: null }), true);
  assert.equal(audioMissing({ state: "listening", buffers: 500, msListening: 30000, msSinceLastBuffer: 40 }), false);
  assert.equal(audioMissing({ state: "listening", buffers: 500, msListening: 30000, msSinceLastBuffer: 5000 }), true);
});

test("opslag en netwerk: een indexedDB die nooit antwoordt houdt het laden van de herkenningsgegevens niet tegen", async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const oldIdb = g.indexedDB;
  const oldFetch = g.fetch;
  g.indexedDB = { open: () => ({}) }; // geen onsuccess, geen onerror: zoals een vastgelopen iOS-Safari
  let calls = 0;
  g.fetch = async () => {
    calls += 1;
    return { ok: true, status: 200, json: async () => ({ dataVersion: "t", compositions: [], members: [], calibration: {} }) };
  };
  try {
    const { loadRecognitionBundle: load, getLibraryDiagnostics } = await import("../src/lib/hymnLibraryClient");
    const started = Date.now();
    const bundle = await load();
    assert.deepEqual(bundle.compositions, []);
    assert.ok(Date.now() - started < 5000, "het laden wachtte op de opslag");
    assert.equal(calls, 1);
    assert.equal(getLibraryDiagnostics().bundle, "ready");
    assert.equal(getLibraryDiagnostics().bundleSource, "netwerk");
  } finally {
    g.indexedDB = oldIdb;
    g.fetch = oldFetch;
  }
});

test("netwerk: een tijdelijke serverfout wordt één keer opnieuw geprobeerd, een weigering (4xx) niet, en elke fout wordt gemeld", async () => {
  const g = globalThis as unknown as Record<string, unknown>;
  const oldFetch = g.fetch;
  const oldIdb = g.indexedDB;
  g.indexedDB = undefined;
  try {
    const mod = await import("../src/lib/hymnLibraryClient");
    let calls = 0;
    g.fetch = async () => {
      calls += 1;
      return calls === 1 ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ dataVersion: "x", hymns: [] }) };
    };
    const res = await mod.loadHymnIndex();
    assert.equal(calls, 2);
    assert.deepEqual(res.hymns, []);
    // 4xx: één verzoek, daarna een fout (de UI toont die)
    calls = 0;
    g.fetch = async () => {
      calls += 1;
      return { ok: false, status: 401, json: async () => ({}) };
    };
    await assert.rejects(() => mod.loadHymn(98765));
    assert.equal(calls, 1);
  } finally {
    g.fetch = oldFetch;
    g.indexedDB = oldIdb;
  }
});

test("client: een mislukte herkenningsbundel stopt de microfoon niet en laat de engine niet vallen; de fout is zichtbaar", () => {
  const client = read("src/components/hymns-poc/HymnsPocClient.tsx");
  const fn = client.slice(client.indexOf("const loadBundleInto"), client.indexOf("const startListening"));
  assert.ok(fn.length > 100);
  assert.doesNotMatch(fn, /\.stop\(|\.restart\(/, "de bundelfout mag de microfoon niet stoppen of de engine niet wissen");
  assert.match(fn, /setBundleFailed\(true\)/);
  assert.match(client, /data-hymns-bundle-error/);
  assert.match(client, /data-hymns-bundle-retry/);
  // elke andere plek die de microfoon stopt, geeft een reden op
  for (const m of client.matchAll(/micRef\.current\?\.stop\(([^)]*)\)/g)) assert.ok(m[1] === "" || m[1].includes('"'), `stop zonder reden: ${m[0]}`);
  // handmatig kiezen tijdens het luisteren volgt altijd, ook als de engine nog niet in "herkennen" stond
  assert.match(client, /eng\.currentStage !== "idle" \|\| micRef\.current\?\.listening/);
});

test("microfoon: stop tijdens het aanvragen annuleert de start, en elke stop heeft een reden", () => {
  const mic = read("src/lib/hymns/audio/micListener.ts");
  assert.match(mic, /cancelRequested/);
  assert.match(mic, /if \(this\.cancelRequested\)/);
  for (const reason of ["achtergrond", "systeem", "gebruiker", "fout"]) assert.match(mic, new RegExp(`"${reason}"`));
  assert.match(mic, /diagnostics\(\): MicDiagnostics/);
  // een onbekende melodie of herkenningsstatus komt hier nergens in voor: de microfoon stopt alleen door gebruiker, systeem, achtergrond of fout
  assert.doesNotMatch(mic, /from ".*recogni|RecognitionState|"unknown"/);
});
