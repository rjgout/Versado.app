import assert from "node:assert/strict";
import test from "node:test";
import { estimateClockOffset } from "../src/lib/snelleZendeling/clock";
import { FIRST_OBSTACLE_X, MASCOT_X, MAX_GAP_STEP, OBSTACLE_WIDTH, PAIR_SPACING, PLAY_BOTTOM, WORLD_WIDTH, effectiveGapHeight, gapYBounds, passedPair, worldSpeed } from "../src/lib/snelleZendeling/gameplay";
import {
  SHARED_SCORE_GRACE_SECONDS,
  createSharedWorld,
  distanceAt,
  hashSeed,
  maxSharedScore,
  mulberry32,
  pairDifficultyScore,
  pairWorldX,
  passDistance,
  passTimeSeconds,
  passedPairsAtDistance,
  sharedProgressAt,
  validateSharedScore,
} from "../src/lib/snelleZendeling/sharedWorld";
import { decideMatch, deriveDuo, participantState, survivalOrder, type ParticipantState } from "../src/lib/snelleZendeling/matchRules";

// --- Eén wereld voor iedereen ------------------------------------------------------

test("dezelfde seed geeft dezelfde wereld, ongeacht in welke volgorde paren worden opgevraagd", () => {
  const a = createSharedWorld("seed-1");
  const b = createSharedWorld("seed-1");
  const forward = Array.from({ length: 200 }, (_, i) => a.pair(i + 1));
  // Een tweede client begint midden in de run (herverbinding): hij vraagt eerst paar 150.
  const jump = b.pair(150);
  assert.deepEqual(jump, forward[149]);
  const backward = Array.from({ length: 200 }, (_, i) => b.pair(200 - i)).reverse();
  assert.deepEqual(backward, forward);
});

test("een andere seed geeft een andere wereld", () => {
  const a = createSharedWorld("seed-1");
  const b = createSharedWorld("seed-2");
  assert.notDeepEqual(Array.from({ length: 30 }, (_, i) => a.pair(i + 1).gapY), Array.from({ length: 30 }, (_, i) => b.pair(i + 1).gapY));
});

test("de generator is stabiel: vaste seed geeft vaste getallen (geen verschil tussen toestellen en versies)", () => {
  assert.equal(hashSeed("versado"), hashSeed("versado"));
  const random = mulberry32(hashSeed("versado:1"));
  const first = [random(), random(), random()];
  const again = mulberry32(hashSeed("versado:1"));
  assert.deepEqual([again(), again(), again()], first);
  for (const value of first) assert.ok(value >= 0 && value < 1);
});

test("elk paar volgt de gewone regels: opening volgens de curve, binnen de speelzone, max. stapgrootte", () => {
  const world = createSharedWorld("regels");
  let previous: number | undefined;
  for (let id = 1; id <= 1500; id++) {
    const pair = world.pair(id);
    assert.equal(pair.id, id);
    assert.equal(pair.x, pairWorldX(id));
    assert.equal(pair.gapHeight, effectiveGapHeight(pairDifficultyScore(id)));
    const bounds = gapYBounds(pair.gapHeight);
    assert.ok(pair.gapY >= bounds.min && pair.gapY <= bounds.max, `paar ${id} binnen de speelzone`);
    assert.ok(pair.gapY + pair.gapHeight <= PLAY_BOTTOM);
    if (previous !== undefined) assert.ok(Math.abs(pair.gapY - previous) <= MAX_GAP_STEP + 1, `paar ${id} stap`);
    previous = pair.gapY;
  }
});

test("de moeilijkheid volgt de voortgang van de wereld: later in de run is de opening kleiner, nooit onder 70%", () => {
  const world = createSharedWorld("moeilijk");
  assert.equal(world.pair(1).gapHeight, effectiveGapHeight(0));
  assert.ok(world.pair(120).gapHeight < world.pair(5).gapHeight);
  assert.equal(world.pair(5000).gapHeight, effectiveGapHeight(1000));
});

// --- Eén tijdlijn voor iedereen -----------------------------------------------------

test("de tijdlijn is continu en monotoon: afstand groeit altijd en spoort met de wereldsnelheid", () => {
  let last = 0;
  for (let t = 0; t <= 400; t += 0.05) {
    const d = distanceAt(t);
    assert.ok(d >= last, `afstand daalt niet bij t=${t}`);
    last = d;
  }
  assert.equal(distanceAt(0), 0);
  assert.equal(distanceAt(-5), 0);
  assert.equal(distanceAt(Number.NaN), 0);
  // Vlak voor het eerste paar is de snelheid 100%.
  assert.ok(Math.abs(distanceAt(1) - worldSpeed(0)) < 1e-9);
});

test("op het moment dat paar k gepasseerd wordt staat de wereld precies op passDistance(k)", () => {
  for (const k of [1, 2, 3, 10, 50, 200, 999, 1500]) {
    assert.ok(Math.abs(distanceAt(passTimeSeconds(k)) - passDistance(k)) < 1e-6, `paar ${k}`);
    assert.equal(sharedProgressAt(passTimeSeconds(k) + 1e-6), k);
    assert.equal(sharedProgressAt(passTimeSeconds(k) - 1e-6), k - 1);
  }
});

test("het passeren op de tijdlijn komt overeen met passedPair uit solo", () => {
  const world = createSharedWorld("passeren");
  for (const t of [3, 7.7, 20, 45.2, 120, 333]) {
    const distance = distanceAt(t);
    const count = passedPairsAtDistance(distance);
    for (const pair of world.visiblePairs(distance)) {
      const passedHere = passedPair(MASCOT_X, pair, false);
      assert.equal(passedHere, pair.id <= count, `t=${t} paar ${pair.id}`);
    }
  }
});

test("zichtbare paren bij een afstand hebben schermposities en blijven binnen beeld", () => {
  const world = createSharedWorld("zicht");
  assert.deepEqual(world.visiblePairs(0), [], "het eerste paar begint nog buiten beeld");
  const pairs = world.visiblePairs(120);
  assert.equal(pairs[0].id, 1);
  assert.equal(pairs[0].x, FIRST_OBSTACLE_X - 120);
  assert.ok(pairs.every((p) => p.x <= WORLD_WIDTH && p.x + OBSTACLE_WIDTH >= -2));
  const later = world.visiblePairs(distanceAt(60));
  assert.ok(later.length >= 2 && later.every((p) => p.x <= WORLD_WIDTH));
  assert.equal(later[1].x - later[0].x, PAIR_SPACING);
});

test("twee toestellen op hetzelfde servermoment zien dezelfde wereld, ook met verschillende framerates", () => {
  const a = createSharedWorld("sync");
  const b = createSharedWorld("sync");
  // Toestel A tekent elke 16 ms, toestel B elke 40 ms, allebei vanuit de servertijd (geen dt-optelling).
  for (const t of [10, 10.4, 20.8, 99.2]) {
    const pa = a.visiblePairs(distanceAt(t));
    const pb = b.visiblePairs(distanceAt(t));
    assert.deepEqual(pa, pb);
  }
});

// --- Servervalidatie -----------------------------------------------------------------

test("de server accepteert een score alleen als de gezamenlijke tijdlijn zo ver is", () => {
  const startsAt = new Date("2026-10-18T10:00:00Z");
  const at = (seconds: number) => new Date(startsAt.getTime() + seconds * 1000);
  assert.equal(maxSharedScore(at(0), at(0), 0), 0);
  const t30 = at(30);
  const limit = maxSharedScore(startsAt, t30);
  assert.equal(limit, sharedProgressAt(30 + SHARED_SCORE_GRACE_SECONDS));
  assert.deepEqual(validateSharedScore(startsAt, t30, 0, limit), { ok: true, score: limit });
  assert.deepEqual(validateSharedScore(startsAt, t30, 0, limit + 1), { ok: false, reason: "SCORE_TOO_FAST" });
  assert.deepEqual(validateSharedScore(startsAt, t30, 5, 4), { ok: false, reason: "SCORE_DECREASED" });
  assert.deepEqual(validateSharedScore(startsAt, t30, 0, -1), { ok: false, reason: "INVALID_SCORE" });
  assert.deepEqual(validateSharedScore(startsAt, t30, 0, 1.5), { ok: false, reason: "INVALID_SCORE" });
  // Voor het begin van de tijdlijn (aftellen) kan nog geen punt bestaan.
  assert.equal(maxSharedScore(new Date(startsAt.getTime() + 60_000), startsAt, 0), 0);
});

// --- Deelnemerstoestanden en einde van de run ------------------------------------------

const states = (list: Record<string, ParticipantState>) => Object.entries(list).map(([userId, state]) => ({ userId, state }));

test("participantState volgt de run-status en de eliminatievolgorde", () => {
  assert.equal(participantState({ status: "IN_PROGRESS", eliminatedSeq: null }), "ACTIVE");
  assert.equal(participantState({ status: "DEAD_AWAITING_REVIVE", eliminatedSeq: null }), "REVIVE_PENDING");
  assert.equal(participantState({ status: "REVIVE_READY", eliminatedSeq: null }), "REVIVE_PENDING");
  assert.equal(participantState({ status: "FINISHED", eliminatedSeq: 3 }), "ELIMINATED");
  assert.equal(participantState({ status: "FINISHED", eliminatedSeq: null }), "FINISHED");
});

test("de run gaat door zolang er meer dan één deelnemer meedoet", () => {
  assert.deepEqual(decideMatch(states({ a: "ACTIVE", b: "ACTIVE" })), { over: false });
  assert.deepEqual(decideMatch(states({ a: "ACTIVE", b: "ACTIVE", c: "ELIMINATED" })), { over: false });
  // Genees stelt de eliminatie uit: een wachtende speler doet nog mee.
  assert.deepEqual(decideMatch(states({ a: "ACTIVE", b: "REVIVE_PENDING" })), { over: false });
  assert.deepEqual(decideMatch(states({ a: "REVIVE_PENDING", b: "REVIVE_PENDING" })), { over: false });
});

test("zodra nog één speler vliegt stopt de run: die speler wint, ook zonder zelf te botsen", () => {
  assert.deepEqual(decideMatch(states({ a: "ACTIVE", b: "ELIMINATED" })), { over: true, reason: "LAST_STANDING", survivorId: "a", voidedIds: [] });
  assert.deepEqual(decideMatch(states({ a: "ELIMINATED", b: "ELIMINATED", c: "ELIMINATED", d: "ACTIVE", e: "ELIMINATED" })), { over: true, reason: "LAST_STANDING", survivorId: "d", voidedIds: [] });
});

test("iedereen dood: blijft alleen een wachtende over, dan is de run voorbij en komt die niet terug", () => {
  // A wacht op een Genees-vraag; B valt definitief af.
  assert.deepEqual(decideMatch(states({ a: "REVIVE_PENDING", b: "ELIMINATED" })), { over: true, reason: "NOBODY_FLYING", survivorId: null, voidedIds: ["a"] });
  assert.deepEqual(decideMatch(states({ a: "ELIMINATED", b: "ELIMINATED" })), { over: true, reason: "NOBODY_FLYING", survivorId: null, voidedIds: [] });
});

test("er is geen productlimiet op het aantal deelnemers", () => {
  const many: Record<string, ParticipantState> = {};
  for (let i = 0; i < 500; i++) many[`u${i}`] = "ACTIVE";
  assert.deepEqual(decideMatch(states(many)), { over: false });
  for (let i = 1; i < 500; i++) many[`u${i}`] = "ELIMINATED";
  assert.deepEqual(decideMatch(states(many)), { over: true, reason: "LAST_STANDING", survivorId: "u0", voidedIds: [] });
});

// --- Duo: de laatste twee ------------------------------------------------------------------

test("het duo zijn de laatste twee: acht spelers, G en H blijven over", () => {
  const players = ["A", "B", "C", "D", "E", "F", "G", "H"].map((userId, i) => ({
    userId,
    score: 100 + i,
    // A..F vallen af in volgorde; G valt als laatste af (seq 7), H overleeft.
    eliminatedSeq: userId === "H" ? null : i + 1,
  }));
  const duo = deriveDuo(players)!;
  assert.deepEqual([duo.a.userId, duo.b.userId].sort(), ["G", "H"]);
  assert.deepEqual(survivalOrder(players).map((p) => p.userId), ["H", "G", "F", "E", "D", "C", "B", "A"]);
});

test("bij precies twee deelnemers zijn beiden automatisch het duo", () => {
  const duo = deriveDuo([
    { userId: "B", score: 31, eliminatedSeq: 1 },
    { userId: "A", score: 33, eliminatedSeq: null },
  ])!;
  assert.deepEqual([duo.a.userId, duo.b.userId], ["A", "B"], "gesorteerd op userId");
  assert.equal(duo.a.score, 33);
  assert.equal(duo.b.score, 31);
});

test("bij drie spelers vormen de laatste twee het duo; wie eerst afviel zit er nooit in", () => {
  const duo = deriveDuo([
    { userId: "first", score: 12, eliminatedSeq: 1 },
    { userId: "second", score: 40, eliminatedSeq: 2 },
    { userId: "winner", score: 41, eliminatedSeq: null },
  ])!;
  assert.deepEqual([duo.a.userId, duo.b.userId].sort(), ["second", "winner"]);
  assert.equal(deriveDuo([{ userId: "alone", score: 1, eliminatedSeq: null }]), null);
});

test("een wachtende die bij het afsluiten vervalt krijgt de hoogste eliminatievolgorde en hoort bij het duo", () => {
  // B viel eerst definitief af (seq 1); A wachtte op een Genees en vervalt bij het afsluiten (seq 2).
  const duo = deriveDuo([
    { userId: "A", score: 20, eliminatedSeq: 2 },
    { userId: "B", score: 20, eliminatedSeq: 1 },
  ])!;
  assert.deepEqual([duo.a.userId, duo.b.userId], ["A", "B"]);
});

test("klokcorrectie: de meting met de kortste rondreis wint en een afwijkende klok wordt rechtgezet", () => {
  // Toestel loopt 5 s achter op de server; rondreizen van 400, 60 en 200 ms.
  const serverAt = (clientTime: number) => clientTime + 5_000;
  const samples = [
    { sentAt: 1000, receivedAt: 1400, serverNow: serverAt(1000 + 100) },
    { sentAt: 2000, receivedAt: 2060, serverNow: serverAt(2000 + 30) },
    { sentAt: 3000, receivedAt: 3200, serverNow: serverAt(3000 + 150) },
  ];
  const offset = estimateClockOffset(samples);
  assert.ok(offset !== null);
  assert.ok(Math.abs(offset - 5_000) <= 30, `offset ${offset}`);
  assert.equal(estimateClockOffset([]), null);
  assert.equal(estimateClockOffset([{ sentAt: 10, receivedAt: 5, serverNow: 0 }]), null, "negatieve rondreis is onbruikbaar");
});

test("beslissing: een verdiend Genees-antwoord wint van een tegenstander die afvalt; zonder antwoord vervalt de Genees", () => {
  assert.deepEqual(decideMatch([{ userId: "a", state: "REVIVE_PENDING", reviveGranted: true }, { userId: "b", state: "ELIMINATED" }]), { over: true, reason: "LAST_STANDING", survivorId: "a", voidedIds: [] });
  assert.deepEqual(decideMatch([{ userId: "a", state: "REVIVE_PENDING" }, { userId: "b", state: "ELIMINATED" }]), { over: true, reason: "NOBODY_FLYING", survivorId: null, voidedIds: ["a"] });
  assert.deepEqual(decideMatch([{ userId: "a", state: "REVIVE_PENDING" }, { userId: "b", state: "REVIVE_PENDING" }]), { over: false });
});
