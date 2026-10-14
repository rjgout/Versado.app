import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry";
import { boardPosition, boardSnapTarget, connectGroups, findSnapConnection, groupFor, moveGroup, newPuzzleSnapshot } from "../src/lib/puzzle/engine";
import { createNearSnapTracker, NEAR_SNAP_FADE_MS, withGroupAt } from "../src/lib/puzzle/nearSnap";
import { puzzlePolicy, type PuzzleDifficulty, type PuzzleSnapshot } from "../src/lib/puzzle/types";

const DIFFICULTIES: PuzzleDifficulty[] = ["DISCOVERER", "ADVENTURER", "EXPERT", "MASTER"];
const geometry = createPuzzleGeometry(24, "bijna-passend", 2);

/** Stuk 0 ligt vast op (5,5) en stuk 1 (de rechterbuur) staat `error` units van zijn canonieke plek ernaast. */
function pair(difficulty: PuzzleDifficulty, error: number, rotation: 0 | 90 = 0) {
  let snapshot = newPuzzleSnapshot(geometry, difficulty);
  snapshot = { ...snapshot, groups: snapshot.groups.map((group) => ({ ...group, rotation: 0, x: group.x, y: group.y })) };
  snapshot = moveGroup(snapshot, geometry, "p0", 5, 5); snapshot = moveGroup(snapshot, geometry, "p1", 6 + error, 5);
  snapshot = { ...snapshot, groups: snapshot.groups.map((group) => group.id === "p1" ? { ...group, rotation } : group) };
  return snapshot;
}
const ask = (snapshot: PuzzleSnapshot, difficulty: PuzzleDifficulty, groupId: string, extra: { x?: number; y?: number; now?: number; reducedMotion?: boolean; rulesVersion?: number; tracker?: ReturnType<typeof createNearSnapTracker> } = {}) => {
  const group = snapshot.groups.find((candidate) => candidate.id === groupId) ?? { x: 0, y: 0 }; const tracker = extra.tracker ?? createNearSnapTracker();
  return { tracker, glow: tracker.update({ snapshot, geometry, difficulty, rulesVersion: extra.rulesVersion ?? 2, groupId, x: extra.x ?? group.x, y: extra.y ?? group.y, now: extra.now ?? 1000, reducedMotion: extra.reducedMotion ?? false }) };
};

test("bijna passend: verschijnt binnen de bestaande snapafstand en verdwijnt erbuiten, voor elke moeilijkheid", () => {
  for (const difficulty of DIFFICULTIES) {
    const snap = puzzlePolicy(difficulty).snap;
    assert.equal(snap, .36, "alle niveaus delen de snapafstand van de regels (v2)");
    const near = ask(pair(difficulty, snap - .02), difficulty, "p1").glow; assert.ok(near && near.edgeCount === 2, `${difficulty}: binnen de afstand`);
    assert.deepEqual([near.edges[0].piece, near.edges[0].neighbour, near.edges[1].piece, near.edges[1].neighbour], [0, 1, 1, 0], "stilstaand stuk 0, gesleept stuk 1");
    assert.equal(ask(pair(difficulty, snap + .02), difficulty, "p1").glow, null, `${difficulty}: buiten de afstand`);
  }
});

test("bijna passend: gelijk aan de engine, over veel willekeurige standen, niveaus en regelversies", () => {
  let seed = 7; const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let shown = 0; let hidden = 0; let boards = 0;
  for (let round = 0; round < 1500; round++) {
    const difficulty = DIFFICULTIES[round % 4]; const rulesVersion = round % 5 === 0 ? 1 : 2;
    let snapshot = newPuzzleSnapshot(geometry, difficulty);
    const id = Math.floor(random() * 24); const other = (id + 1 + Math.floor(random() * 23)) % 24;
    const group = snapshot.groups.find((candidate) => candidate.id === `p${id}`)!; const target = snapshot.groups.find((candidate) => candidate.id === `p${other}`)!;
    // Dicht bij de canonieke plek ten opzichte van elk willekeurig stuk, soms bij de bordpositie.
    const to = random() < .3 ? boardPosition(geometry, group) : { x: target.x + geometry.pieces[id].column - geometry.pieces[other].column, y: target.y + geometry.pieces[id].row - geometry.pieces[other].row };
    const x = to.x + (random() - .5) * 1.2; const y = to.y + (random() - .5) * 1.2;
    snapshot = { ...snapshot, groups: snapshot.groups.map((candidate) => candidate.id === group.id ? { ...candidate, x, y, rotation: difficulty === "MASTER" && random() < .5 ? 90 : 0 } : candidate.id === target.id && difficulty === "MASTER" ? { ...candidate, rotation: 0 } : candidate) };
    const view = withGroupAt(snapshot, group.id, x, y);
    const expectedConnection = findSnapConnection(view, geometry, difficulty, group.id, rulesVersion); const expectedBoard = boardSnapTarget(view, geometry, difficulty, group.id, rulesVersion);
    const glow = ask(snapshot, difficulty, group.id, { rulesVersion, reducedMotion: true }).glow;
    assert.equal(!!glow && glow.edgeCount === 2, expectedConnection !== null, `verbinding ${difficulty} v${rulesVersion} #${round}`);
    assert.equal(!!glow && glow.slot.active, expectedBoard !== null, `bord ${difficulty} v${rulesVersion} #${round}`);
    if (glow) shown++; else hidden++;
    if (glow?.slot.active) boards++;
  }
  assert.ok(shown > 60 && hidden > 100 && boards > 20, `beide uitkomsten komen voor (${shown}/${hidden})`);
});

test("bijna passend: bordhulp alleen waar de regels bordsnap kennen (Ontdekker, Avonturier), nooit bij Expert, Meester of regels v1", () => {
  for (const difficulty of DIFFICULTIES) {
    const snapshot = newPuzzleSnapshot(geometry, difficulty); const group = snapshot.groups[8]; const to = boardPosition(geometry, group);
    const glow = ask({ ...snapshot, groups: snapshot.groups.map((candidate) => candidate === group ? { ...candidate, rotation: 0 } : candidate) }, difficulty, group.id, { x: to.x + .1, y: to.y - .1 }).glow;
    const expected = difficulty === "DISCOVERER" || difficulty === "ADVENTURER";
    assert.equal(!!glow?.slot.active, expected, `${difficulty}: bordplaats ${expected ? "wel" : "niet"} tonen`); assert.equal(puzzlePolicy(difficulty).boardSnap, expected);
    assert.equal(glow?.edgeCount ?? 0, 0, "zonder buur geen verbindingsrand");
  }
  const snapshot = newPuzzleSnapshot(geometry, "ADVENTURER"); const group = snapshot.groups[8]; const to = boardPosition(geometry, group);
  assert.equal(ask(snapshot, "ADVENTURER", group.id, { x: to.x, y: to.y, rulesVersion: 1 }).glow, null, "regels v1: geen bordsnap");
});

test("bijna passend: Meester vereist een juiste rotatie; een gedraaid stuk geeft geen feedback en geen hulp bij de rotatie", () => {
  assert.ok(ask(pair("MASTER", .1, 0), "MASTER", "p1").glow);
  for (const rotation of [90] as const) assert.equal(ask(pair("MASTER", .1, rotation), "MASTER", "p1").glow, null);
  // Ook als het vaste stuk gedraaid is: de engine staat dat niet toe, dus geen feedback.
  const snapshot = pair("MASTER", .1); const turned = { ...snapshot, groups: snapshot.groups.map((group) => group.id === "p0" ? { ...group, rotation: 90 as const } : group) };
  assert.equal(ask(turned, "MASTER", "p1").glow, null);
});

test("bijna passend: geen feedback voor verankerde groepen, voltooide puzzels, niet-bestaande groepen en niet-buren", () => {
  const snapshot = pair("ADVENTURER", .1);
  assert.equal(ask({ ...snapshot, groups: snapshot.groups.map((group) => group.id === "p1" ? { ...group, anchored: true } : group) }, "ADVENTURER", "p1").glow, null);
  assert.equal(ask({ ...snapshot, completedAt: new Date().toISOString() }, "ADVENTURER", "p1").glow, null);
  assert.equal(ask(snapshot, "ADVENTURER", "p999").glow, null);
  const far = ask(moveGroup(snapshot, geometry, "p1", 12, 9), "ADVENTURER", "p1").glow; assert.equal(far, null);
});

test("bijna passend: korte overgang bij binnenkomst, verdwijnt direct, geen permanente animatielus", () => {
  const snapshot = pair("ADVENTURER", .1); const tracker = createNearSnapTracker();
  const first = ask(snapshot, "ADVENTURER", "p1", { tracker, now: 1000 }).glow!; assert.equal(first.strength, 0); assert.equal(tracker.animating, true, "korte overgang loopt");
  assert.equal(ask(snapshot, "ADVENTURER", "p1", { tracker, now: 1000 + NEAR_SNAP_FADE_MS / 2 }).glow!.strength, .5);
  assert.equal(ask(snapshot, "ADVENTURER", "p1", { tracker, now: 1000 + NEAR_SNAP_FADE_MS }).glow!.strength, 1); assert.equal(tracker.animating, false, "na de overgang geen vervolgframes");
  assert.equal(ask(snapshot, "ADVENTURER", "p1", { tracker, now: 9000 }).glow!.strength, 1, "blijft stil staan");
  assert.equal(ask(pair("ADVENTURER", .5), "ADVENTURER", "p1", { tracker, now: 9100 }).glow, null, "buiten de afstand: direct weg"); assert.equal(tracker.animating, false);
  assert.equal(ask(snapshot, "ADVENTURER", "p1", { tracker, now: 9200 }).glow!.strength, 0, "opnieuw binnenkomen start de overgang opnieuw");
  tracker.reset(); assert.equal(tracker.animating, false);
});

test("bijna passend: verminderde beweging toont direct de statische weergave zonder overgang", () => {
  const tracker = createNearSnapTracker(); const glow = ask(pair("ADVENTURER", .1), "ADVENTURER", "p1", { tracker, reducedMotion: true }).glow!;
  assert.equal(glow.strength, 1); assert.equal(tracker.animating, false);
});

test("bijna passend: de gedeelde stand wordt nooit gewijzigd en de tracker hergebruikt zijn objecten", () => {
  const snapshot = pair("ADVENTURER", .1); Object.freeze(snapshot.groups); for (const group of snapshot.groups) Object.freeze(group);
  const before = JSON.stringify(snapshot); const tracker = createNearSnapTracker();
  const one = ask(snapshot, "ADVENTURER", "p1", { tracker, x: 6.1, y: 5 }).glow; const two = ask(snapshot, "ADVENTURER", "p1", { tracker, x: 6.12, y: 5 }).glow;
  assert.equal(one, two, "zelfde presentatieobject"); assert.equal(JSON.stringify(snapshot), before);
  const moved = withGroupAt(snapshot, "p1", 9, 9); assert.notEqual(moved.groups, snapshot.groups); assert.equal(groupFor(snapshot, 1)!.x, 6.1);
  assert.equal(moved.groups.find((group) => group.id === "p1")!.x, 9); assert.equal(moved.groups.find((group) => group.id === "p0"), snapshot.groups.find((group) => group.id === "p0"));
});

test("bijna passend: de snapafstand en regels zijn niet verruimd en de feedback volgt exact de verbinding die loslaten zou maken", () => {
  const snapshot = pair("ADVENTURER", .3); const glow = ask(snapshot, "ADVENTURER", "p1").glow!; assert.ok(glow);
  const joined = connectGroups(snapshot, geometry, "ADVENTURER", glow.edges[0].piece, glow.edges[1].piece); assert.equal(joined.groups.length, snapshot.groups.length - 1, "de engine maakt precies deze verbinding");
  const outside = pair("ADVENTURER", .37); assert.equal(connectGroups(outside, geometry, "ADVENTURER", 0, 1).groups.length, outside.groups.length); assert.equal(ask(outside, "ADVENTURER", "p1").glow, null);
});

test("bijna passend: de module doet geen netwerk, kent geen React en voegt geen berichten of serveracties toe", () => {
  for (const file of ["../src/lib/puzzle/nearSnap.ts", "../src/lib/puzzle/render.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|socket|XMLHttpRequest|sendBeacon|prisma|from "react"|next\//i, file);
  }
  const components = ["../src/components/JigsawV2Client.tsx", "../src/components/PuzzleTable.tsx"].map((file) => readFileSync(new URL(file, import.meta.url), "utf8"));
  for (const source of components) assert.equal((source.match(/nearSnap\./g) ?? []).length > 0, true);
  // De sleep-emit van Samen blijft precies één plek en bevat de feedbackstatus niet.
  const coop = readFileSync(new URL("../src/components/puzzle/CoopClient.tsx", import.meta.url), "utf8"); assert.doesNotMatch(coop, /nearSnap|NearSnap/);
});
