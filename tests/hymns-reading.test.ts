import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { constantTempo } from "../src/lib/hymns/eval/synth";
import { POC_LIBRARY, listHymns } from "../src/lib/hymns/library";
import { HymnLiveEngine, candidatesFromHymns } from "../src/lib/hymns/live";
import type { FollowSnapshot } from "../src/lib/hymns/follow/session";
import {
  INITIAL_READING,
  displayedStanza,
  focusLine,
  musicalCursorVisible,
  navigationTarget,
  nextSticky,
  readingReducer,
  resumeVerdict,
  type ReadingState,
} from "../src/components/hymns-poc/reading";
import { SAMPLE_RATE, makeService } from "./helpers/hymnScenario";

// Lezen heeft voorrang: twee onafhankelijke posities (muziek en leesplek), handmatig bladeren dat alleen de
// automatische tekstnavigatie pauzeert, en hervatten zonder sprongen. Alles zonder browser; het echte
// scrollgedrag staat in scripts/hymns/e2e-reading.mjs.

const root = process.cwd();
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const HYMNS = listHymns(POC_LIBRARY);

function snap(partial: { status?: FollowSnapshot["status"]; phase?: "prelude" | "singing" | "interlude"; line?: number; frozen?: boolean; stanza?: number; lapUncertain?: boolean }): FollowSnapshot {
  return {
    time: 10,
    status: partial.status ?? "locked",
    confidence: 1,
    paused: false,
    position: 3,
    measure: 1,
    bpm: 90,
    lap: 0,
    lapUncertain: partial.lapUncertain ?? false,
    displayPosition: 3,
    positionSource: "measured",
    estimatedSeconds: 0,
    stanza: partial.stanza ?? 1,
    cursor: { section: "verse", line: partial.line ?? 2, word: null, frozen: partial.frozen ?? false, estimated: false },
    phase: { phase: partial.phase ?? "singing", entry: "mid", waiting: false, sungLaps: 0, coverage: 0, startReason: null, startEvidence: [], levelStepDb: 0, interludes: 0 },
  };
}

const manual = (stanza: number, line: number | null): ReadingState => ({ mode: "manual", stanza, line, note: null });

test("een eigen scrollgebaar tijdens het meeluisteren zet alleen het automatische bladeren op pauze", () => {
  const next = readingReducer(INITIAL_READING, { type: "scroll", following: true, stanza: 2 });
  assert.equal(next.mode, "manual");
  assert.equal(next.stanza, 2, "het getoonde couplet blijft staan waar de gebruiker leest");
  // nog een scrollgebaar verandert niets (en maakt geen nieuw object: geen onnodige render)
  assert.equal(readingReducer(next, { type: "scroll", following: true, stanza: 3 }), next);
});

test("zonder meeluisterende engine is scrollen gewoon lezen: er is niets te pauzeren", () => {
  assert.equal(readingReducer(INITIAL_READING, { type: "scroll", following: false, stanza: 1 }), INITIAL_READING);
  const tapped = readingReducer(INITIAL_READING, { type: "line", line: 3, following: false, stanza: 1 });
  assert.equal(tapped.mode, "auto");
  assert.equal(tapped.line, 3, "aangetikte regel wordt wel onthouden");
});

test("een regel aantikken en vorige/volgende regel zetten de leesplek en gaan naar handmatig", () => {
  const tapped = readingReducer(INITIAL_READING, { type: "line", line: 4, following: true, stanza: 2 });
  assert.deepEqual({ mode: tapped.mode, stanza: tapped.stanza, line: tapped.line }, { mode: "manual", stanza: 2, line: 4 });
  const down = readingReducer(tapped, { type: "step", dir: 1, from: 4, count: 8, following: true, stanza: 2 });
  assert.equal(down.line, 5);
  const up = readingReducer(down, { type: "step", dir: -1, from: 5, count: 8, following: true, stanza: 2 });
  assert.equal(up.line, 4);
  // grenzen: nooit voorbij de eerste of laatste regel
  assert.equal(readingReducer(manual(1, 0), { type: "step", dir: -1, from: 0, count: 8, following: true, stanza: 1 }).line, 0);
  assert.equal(readingReducer(manual(1, 7), { type: "step", dir: 1, from: 7, count: 8, following: true, stanza: 1 }).line, 7);
  // nog niets actief (-1): vooruit begint bij de eerste regel, terug ook
  assert.equal(readingReducer(INITIAL_READING, { type: "step", dir: 1, from: -1, count: 8, following: true, stanza: 1 }).line, 0);
  assert.equal(readingReducer(INITIAL_READING, { type: "step", dir: -1, from: -1, count: 8, following: true, stanza: 1 }).line, 0);
});

test("een couplet kiezen tijdens handmatig lezen verandert alleen de leesplek, ook zonder meeluisteren is het gewoon een keuze", () => {
  const picked = readingReducer(manual(2, 5), { type: "stanza", stanza: 4, following: true });
  assert.deepEqual(picked, { mode: "manual", stanza: 4, line: null, note: null });
  // in de automatische stand is een coupletkeuze een correctie voor de engine: de leesstand begint schoon
  assert.deepEqual(readingReducer(INITIAL_READING, { type: "stanza", stanza: 3, following: true }), INITIAL_READING);
  assert.deepEqual(readingReducer({ ...INITIAL_READING, line: 6 }, { type: "stanza", stanza: 3, following: false }), INITIAL_READING);
});

test("hervatten: bij een betrouwbare synchronisatie weer automatisch, anders blijft de leesplek ongemoeid", () => {
  const reading = manual(2, 5);
  assert.deepEqual(readingReducer(reading, { type: "resume", verdict: { ok: true } }), INITIAL_READING);
  const unsure = readingReducer(reading, { type: "resume", verdict: { ok: false, reason: "unsure" } });
  assert.deepEqual({ mode: unsure.mode, stanza: unsure.stanza, line: unsure.line }, { mode: "manual", stanza: 2, line: 5 }, "leesplek verschoof bij onzekerheid");
  assert.equal(unsure.note, "unsure");
  assert.equal(readingReducer(unsure, { type: "clearNote" }).note, null);
  assert.equal(readingReducer(INITIAL_READING, { type: "clearNote" }), INITIAL_READING);
  assert.equal(readingReducer(unsure, { type: "reset" }).mode, "auto");
});

test("hervattoets: alleen locked/recovered met een stabiele regel (of voorspel/tussenspel) telt als betrouwbaar", () => {
  assert.deepEqual(resumeVerdict(snap({}), 2), { ok: true });
  assert.deepEqual(resumeVerdict(snap({ status: "recovered" }), 1), { ok: true });
  assert.deepEqual(resumeVerdict(snap({ phase: "prelude", line: -1 }), 1), { ok: true }, "voorspel: er valt niets te springen");
  assert.deepEqual(resumeVerdict(snap({ phase: "interlude", line: -1 }), 1), { ok: true });
  assert.deepEqual(resumeVerdict(snap({ status: "uncertain" }), 1), { ok: false, reason: "unsure" });
  assert.deepEqual(resumeVerdict(snap({ status: "lost" }), 1), { ok: false, reason: "lost" });
  assert.deepEqual(resumeVerdict(snap({ status: "acquiring" }), 1), { ok: false, reason: "waiting" });
  assert.deepEqual(resumeVerdict(null, 1), { ok: false, reason: "waiting" });
  assert.deepEqual(resumeVerdict(snap({ frozen: true }), 1), { ok: false, reason: "unsure" }, "vastgezette markering is geen vertrouwen");
  assert.deepEqual(resumeVerdict(snap({ line: -1 }), 1), { ok: false, reason: "unsure" });
  // mogelijk gemiste ronde en de gebruiker leest een ander couplet dan de engine: niet blind overnemen
  assert.deepEqual(resumeVerdict(snap({ lapUncertain: true, stanza: 3 }), 2), { ok: false, reason: "unsure" });
  assert.deepEqual(resumeVerdict(snap({ lapUncertain: true, stanza: 2 }), 2), { ok: true });
});

test("selectors: handmatig bepaalt de gebruiker couplet en regel, automatisch de muziek", () => {
  assert.equal(displayedStanza(manual(4, null), 2, true), 4);
  assert.equal(displayedStanza(manual(4, null), 2, false), 2, "zonder meeluisteren geldt het couplet van de keuze vooraf");
  assert.equal(displayedStanza(INITIAL_READING, 2, true), 2);
  // karaoke-focus: leesregel > muziekregel > laatst bekende regel > eerste regel
  assert.equal(focusLine(manual(1, 5), 2, 1, 8), 5);
  assert.equal(focusLine(manual(1, null), 2, 1, 8), 0, "nieuw couplet tijdens bladeren begint bovenaan");
  assert.equal(focusLine(INITIAL_READING, 3, 1, 8), 3);
  assert.equal(focusLine(INITIAL_READING, -1, 6, 8), 6, "tijdelijk geen regel: blijf bij de laatst bekende");
  assert.equal(focusLine(INITIAL_READING, -1, -1, 8), 0, "voorspel: de eerste regel staat klaar");
  assert.equal(focusLine(INITIAL_READING, 99, -1, 8), 7, "binnen de grenzen");
  assert.equal(focusLine(INITIAL_READING, 0, -1, 0), -1);
  // navigatie in het volledige couplet scrollt alleen naar een bekende regel
  assert.equal(navigationTarget(INITIAL_READING, -1, -1, 8, "stanza"), -1);
  assert.equal(navigationTarget(manual(1, 6), 2, 1, 8, "stanza"), 6);
  assert.equal(navigationTarget(INITIAL_READING, 3, 1, 8, "stanza"), 3);
  assert.equal(navigationTarget(manual(1, 6), 2, 1, 8, "karaoke"), 6);
  // de muzikale markering verschijnt alleen als de engine in het getoonde couplet zit
  assert.equal(musicalCursorVisible(2, 2), true);
  assert.equal(musicalCursorVisible(3, 2), false);
  assert.equal(musicalCursorVisible(null, 2), false);
});

test("laatste muziekregel blijft de focus bij tijdelijke onzekerheid; een nieuw couplet of het voorspel begint opnieuw", () => {
  let held = { key: "82:1:voorspel", value: -1 };
  held = nextSticky(held, "82:1:zang", 2);
  assert.equal(held.value, 2);
  held = nextSticky(held, "82:1:zang", 3);
  assert.equal(held.value, 3);
  const afterLoss = nextSticky(held, "82:1:zang", -1);
  assert.equal(afterLoss, held, "geen terugval bij verlies van de regel");
  assert.equal(nextSticky(held, "82:2:zang", -1).value, -1, "nieuw couplet");
  assert.equal(nextSticky(held, "82:1:voorspel", -1).value, -1, "opnieuw synchroniseren (voorspel)");
});

test("echte engine: tijdens handmatig lezen loopt de muziek door en verschuift de leesplek nooit; hervatten sluit zonder sprong aan", () => {
  // Voorspel, daarna drie coupletrondes zang: de engine schakelt zelf door naar couplet 2 en 3.
  const sv = makeService(82, [{ options: { tempoSegments: constantTempo(90) } }, { gapBefore: 1.5, options: { tempoSegments: constantTempo(90), singersDb: -6, laps: 3 } }]);
  const engine = new HymnLiveEngine(HYMNS);
  engine.followHymn(82, "manual");
  let reading: ReadingState = INITIAL_READING;
  const seen: { t: number; stanza: number; shown: number; line: number; position: number; status: string }[] = [];
  let userStartedAt = -1;
  let userStanza = 0;
  const chunk = 4096;
  for (let i = 0; i < sv.samples.length; i += chunk) {
    engine.pushAudio(sv.samples.subarray(i, Math.min(sv.samples.length, i + chunk)), SAMPLE_RATE, Infinity);
    const s = engine.state().snapshot;
    if (!s) continue;
    const t = i / SAMPLE_RATE;
    // de gebruiker begint te bladeren zodra de zang loopt (couplet 1) en leest dan zelf verder in couplet 1
    if (userStartedAt < 0 && s.phase.phase === "singing" && s.cursor.line >= 1) {
      userStartedAt = t;
      userStanza = s.stanza;
      reading = readingReducer(reading, { type: "line", line: 1, following: true, stanza: s.stanza });
    }
    const shown = displayedStanza(reading, s.stanza, true);
    seen.push({ t, stanza: s.stanza, shown, line: reading.line ?? -1, position: s.position, status: s.status });
  }
  assert.ok(userStartedAt > 0, "de zang is nooit begonnen");
  const after = seen.filter((x) => x.t > userStartedAt);
  assert.ok(after.length > 50);
  // 1. de leesplek is nooit verschoven, hoeveel de muziek ook verder ging
  assert.ok(after.every((x) => x.shown === userStanza && x.line === 1), "de leesplek is door de muziek overschreven");
  // 2. de engine liep intussen gewoon door: nieuwe coupletten, de positie bewoog, de status bleef bestaan
  assert.ok(after.some((x) => x.stanza > userStanza), "de engine ging niet door naar het volgende couplet");
  assert.ok(new Set(after.map((x) => Math.round(x.position))).size > 10, "de muzikale positie bewoog niet");
  assert.ok(after.some((x) => x.status === "locked" || x.status === "recovered"));
  // 3. hervatten midden in de zang: betrouwbaar, en de weergave volgt dan precies de engine (geen tussenstand)
  const s = engine.state().snapshot!;
  const verdict = resumeVerdict(s, reading.stanza);
  if (verdict.ok) {
    const resumed = readingReducer(reading, { type: "resume", verdict });
    assert.equal(displayedStanza(resumed, s.stanza, true), s.stanza);
    assert.equal(resumed.line, null);
  } else {
    // aan het einde van de opname kan de status onzeker zijn: dan blijft de leesplek staan
    const kept = readingReducer(reading, { type: "resume", verdict });
    assert.equal(displayedStanza(kept, s.stanza, true), userStanza);
  }
});

test("echte engine: bij verloren synchronisatie blijft de gebruiker lezen en wordt hervatten geweigerd tot het weer klopt", () => {
  const sv = makeService(82, [{ options: { tempoSegments: constantTempo(90) } }, { gapBefore: 1.5, options: { tempoSegments: constantTempo(90), singersDb: -6, laps: 2 } }]);
  const engine = new HymnLiveEngine(HYMNS);
  engine.followHymn(82, "manual");
  // eerst normaal meeluisteren, dan 20 seconden ruis die niets met de lofzang te maken heeft
  const half = Math.floor(sv.samples.length * 0.6);
  const chunk = 4096;
  for (let i = 0; i < half; i += chunk) engine.pushAudio(sv.samples.subarray(i, Math.min(half, i + chunk)), SAMPLE_RATE, Infinity);
  const before = engine.state().snapshot!;
  let seed = 7;
  const noise = new Float32Array(SAMPLE_RATE * 20).map(() => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return (seed / 4294967296 - 0.5) * 0.4;
  });
  for (let i = 0; i < noise.length; i += chunk) engine.pushAudio(noise.subarray(i, Math.min(noise.length, i + chunk)), SAMPLE_RATE, Infinity);
  const lost = engine.state().snapshot!;
  const reading = manual(before.stanza, 3);
  assert.ok(lost.status === "uncertain" || lost.status === "lost", `verwachtte verloren/onzekere synchronisatie, kreeg ${lost.status}`);
  const verdict = resumeVerdict(lost, reading.stanza);
  assert.equal(verdict.ok, false);
  const kept = readingReducer(reading, { type: "resume", verdict });
  assert.deepEqual({ mode: kept.mode, stanza: kept.stanza, line: kept.line }, { mode: "manual", stanza: before.stanza, line: 3 }, "leesplek ging verloren door onzekerheid");
  // de microfoonpijplijn en de volger bestaan nog: dezelfde sessie, geen herstart
  assert.ok(engine.extractorInstance);
  assert.equal(engine.currentStage, "following");
});

test("engine: herkennen kan beginnen vóór de herkenningsgegevens binnen zijn en loopt daarna het geheugen door", () => {
  const sv = makeService(82, [{ options: { tempoSegments: constantTempo(90) } }, { gapBefore: 2.5, options: { tempoSegments: constantTempo(90), singersDb: -6, laps: 1 } }]);
  const chunk = 4096;
  const run = (loadAfterSeconds: number | null) => {
    const engine = new HymnLiveEngine(HYMNS);
    if (loadAfterSeconds === null) {
      engine.setCandidates(candidatesFromHymns(HYMNS));
      engine.startRecognizing();
    } else engine.startRecognizing({ awaitCandidates: true });
    let handover = -1;
    let waiting = engine.state();
    for (let i = 0; i < sv.samples.length; i += chunk) {
      engine.pushAudio(sv.samples.subarray(i, Math.min(sv.samples.length, i + chunk)), SAMPLE_RATE, Infinity);
      const t = i / SAMPLE_RATE;
      if (loadAfterSeconds !== null && !engine.hasCandidates) {
        waiting = engine.state();
        if (t >= loadAfterSeconds) engine.setCandidates(candidatesFromHymns(HYMNS));
      }
      if (handover < 0 && engine.currentStage === "following") handover = t;
    }
    engine.drainAll();
    return { engine, handover, waiting };
  };
  const control = run(null);
  const late = run(6);
  assert.equal(late.waiting.stage, "recognizing", "tijdens het wachten luistert de engine al");
  assert.equal(late.waiting.recognition, null, "zonder gegevens is er nog geen herkenningsstand");
  assert.equal(late.engine.state().stage, "following");
  assert.equal(late.engine.state().hymn?.number, 82);
  assert.equal(late.engine.state().choice, "auto");
  // het begin van het voorspel ging niet verloren: even snel herkend als wanneer de gegevens er vooraf waren
  assert.ok(control.handover > 0 && Math.abs(late.handover - control.handover) <= 1, `te laat: ${late.handover} tegenover ${control.handover}`);
});

test("ontwerp: de leesbediening ligt nergens over de tekst en de regels zijn aantikbaar en scrollbaar", () => {
  const client = read("src/components/hymns-poc/HymnsPocClient.tsx");
  const lyrics = read("src/components/hymns-poc/LyricsView.tsx");
  const scroll = read("src/components/hymns-poc/useReadingScroll.ts");
  // de strook met "Zelf bladeren" is een gewoon flexkind tussen leesruimte en bediening, geen overlay
  const strip = client.slice(client.indexOf("data-hymns-reading"), client.indexOf("data-hymns-bar"));
  assert.ok(strip.length > 200);
  assert.equal(/\b(absolute|fixed|sticky)\b/.test(strip), false, "leesbediening ligt over de tekst heen");
  assert.match(client, /COPY\.browsing/);
  assert.match(client, /COPY\.resumeAuto/);
  assert.match(lyrics, /data-seq=/);
  assert.match(lyrics, /onClick=\{tap\}/);
  // alleen de gebruiker pauzeert het meelopen: de scrollhaak meldt eigen gebaren en scrolt nooit terug
  assert.match(scroll, /touchmove/);
  assert.match(scroll, /wheel/);
  assert.equal(/scrollIntoView|window\.scroll/.test(scroll), false);
  // de engine en de microfoon kennen de leesstand niet
  for (const file of ["src/lib/hymns/live.ts", "src/lib/hymns/follow/session.ts", "src/lib/hymns/audio/micListener.ts"]) {
    assert.equal(/reading|leesstand|Zelf bladeren/i.test(read(file).replace(/\/\/.*$/gm, "")), false, `${file} kent de leesstand`);
  }
  // handmatig lezen raakt de microfoon niet: er is geen stop/restart in de leesacties
  const handlers = client.slice(client.indexOf("const tapLine"), client.indexOf("// De melding"));
  assert.equal(/restart|stopMic|micRef|startListening|resync|followHymn/.test(handlers), false);
});
