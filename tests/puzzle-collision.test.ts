import test from "node:test";
import assert from "node:assert/strict";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry";
import { anchorGroup, boardPosition, connectGroups, groupFor, moveGroup, newPuzzleSnapshot, rotateGroup, worldOf } from "../src/lib/puzzle/engine";
import { DEFAULT_SETTLE_LIMITS, overlappingGroups, pieceCoreRects, planSettle, settleGroups, settleWouldMove } from "../src/lib/puzzle/collision";
import { puzzleWorktable } from "../src/lib/puzzle/worktable";
import { visibleWorldRect } from "../src/lib/puzzle/viewport";
import type { PuzzleSnapshot } from "../src/lib/puzzle/types";

// De botsingsmodule: wanneer overlappen twee groepen ongewenst, en waar schuift de ene dan heen?
// Pure berekeningen op echte geometrie; de server en de client gebruiken exact dezelfde functie.

const geometry = createPuzzleGeometry(24, "botsing");
const base = () => newPuzzleSnapshot(geometry, "DISCOVERER");
const put = (snap: PuzzleSnapshot, id: number, x: number, y: number) => moveGroup(snap, geometry, `p${id}`, x, y);
const group = (snap: PuzzleSnapshot, id: string) => snap.groups.find((g) => g.id === id)!;
const options = (focusGroupId: string, extra: object = {}) => ({ focusGroupId, difficulty: "DISCOVERER" as const, ...extra });
/** Geen enkele beweeglijke groep overlapt de focusgroep nog. */
const clean = (snap: PuzzleSnapshot, id: string) => overlappingGroups(snap, geometry, id).length === 0;

test("twee losse stukken die overlappen: de laatst neergelegde blijft liggen, de ander wijkt een stukje uit", () => {
  let snap = put(base(), 0, 5, 5); snap = put(snap, 1, 5.3, 5.2); // p1 ligt boven op p0 (in het lege bordmidden)
  assert.deepEqual(overlappingGroups(snap, geometry, "p1"), ["p0"]);
  const plan = planSettle(snap, geometry, options("p1"));
  assert.equal(plan.reason, "moved");
  assert.deepEqual(plan.moves.map((m) => m.groupId), ["p0"], "alleen de ander beweegt");
  const after = settleGroups(snap, geometry, options("p1"));
  assert.equal(group(after, "p1").x, 5.3); assert.equal(group(after, "p1").y, 5.2);
  assert.ok(clean(after, "p1"));
  const m = plan.moves[0]; assert.ok(Math.hypot(m.x - m.fromX, m.y - m.fromY) < 2, "een korte stap, geen verre verbanning");
});

test("een tweede settle op de uitkomst doet niets (stabiel: geen heen-en-weer)", () => {
  let snap = put(base(), 0, 5, 5); snap = put(snap, 1, 5.3, 5.2);
  const once = settleGroups(snap, geometry, options("p1"));
  assert.equal(settleGroups(once, geometry, options("p1")), once, "dezelfde instantie: geen verandering");
  // en ook niet als de eerder verplaatste groep nu de focus is
  assert.equal(settleGroups(once, geometry, options("p0")), once);
});

test("de uitkomst is een pure functie: dezelfde invoer, dezelfde plek, ook met een andere groepsvolgorde", () => {
  let snap = put(base(), 0, 5, 5); snap = put(snap, 1, 5.3, 5.2); snap = put(snap, 2, 5.2, 5.5);
  const a = planSettle(snap, geometry, options("p1"));
  const b = planSettle(snap, geometry, options("p1"));
  assert.deepEqual(a, b);
  const shuffled = { ...snap, groups: [...snap.groups].reverse() };
  const c = planSettle(shuffled, geometry, options("p1"));
  assert.deepEqual([...c.moves].sort((x, y) => x.groupId.localeCompare(y.groupId)), [...a.moves].sort((x, y) => x.groupId.localeCompare(y.groupId)));
});

test("een losse groep boven op een verbonden groep: de verbonden groep blijft één geheel", () => {
  let snap = put(base(), 0, 5, 5); snap = put(snap, 1, 6, 5);
  // p1 staat nu op zijn juiste plek ten opzichte van p0: verbinden
  const joined = connectGroups(snap, geometry, "DISCOVERER", 0, 1);
  const pair = groupFor(joined, 0)!; assert.equal(pair.pieceIds.length, 2);
  const loose = put(joined, 8, pair.x + .3, pair.y + .2);
  const plan = planSettle(loose, geometry, options("p8"));
  assert.equal(plan.reason, "moved");
  assert.deepEqual(plan.moves.map((m) => m.groupId), [pair.id], "het paar beweegt als één groep");
  const after = settleGroups(loose, geometry, options("p8"));
  assert.deepEqual(groupFor(after, 0)!.pieceIds, pair.pieceIds, "leden en volgorde ongewijzigd");
  assert.equal(after.connections.length, loose.connections.length);
  assert.ok(clean(after, "p8"));
});

test("twee grote verbonden groepen die overlappen: de ene schuift als geheel uit", () => {
  let snap = base();
  // twee rijen van vier stukken, elk als één groep verbonden
  const row = (start: number, y: number, x0: number) => {
    snap = put(snap, start, x0, y);
    for (let i = 1; i < 4; i++) { const anchor = groupFor(snap, start)!; const w = worldOf(geometry, anchor, start + i - 1); snap = put(snap, start + i, w.x + 1, w.y); snap = connectGroups(snap, geometry, "DISCOVERER", start + i - 1, start + i); }
  };
  row(0, 4.6, 4.2); row(6, 5, 4.5);
  const a = groupFor(snap, 0)!; const b = groupFor(snap, 6)!; assert.equal(a.pieceIds.length, 4); assert.equal(b.pieceIds.length, 4);
  assert.ok(overlappingGroups(snap, geometry, b.id).includes(a.id));
  const after = settleGroups(snap, geometry, options(b.id));
  assert.ok(clean(after, b.id));
  assert.equal(group(after, b.id).x, b.x, "de focusgroep blijft liggen");
  assert.deepEqual(groupFor(after, 0)!.pieceIds, a.pieceIds);
});

test("een losse groep op een vastgezette groep: de vastgezette beweegt nooit, het losse stuk zoekt zelf een vrije plek", () => {
  let snap = base();
  const board = boardPosition(geometry, group(snap, "p0"));
  snap = put(snap, 0, board.x, board.y); snap = anchorGroup(snap, geometry, "DISCOVERER", "p0");
  assert.equal(group(snap, "p0").anchored, true);
  const anchored = { x: group(snap, "p0").x, y: group(snap, "p0").y };
  snap = put(snap, 9, anchored.x + .3, anchored.y + .1); // een los stuk valt boven op het vastgezette stuk
  assert.ok(overlappingGroups(snap, geometry, "p9").includes("p0"));
  const plan = planSettle(snap, geometry, options("p9"));
  assert.equal(plan.reason, "moved");
  assert.deepEqual(plan.moves.map((m) => m.groupId), ["p9"], "alleen het losse stuk beweegt");
  const after = settleGroups(snap, geometry, options("p9"));
  assert.deepEqual({ x: group(after, "p0").x, y: group(after, "p0").y, a: group(after, "p0").anchored }, { ...anchored, a: true });
  assert.ok(clean(after, "p9"));
});

test("correct aansluitende stukken zijn geen botsing en de snap gaat voor", () => {
  let snap = put(base(), 0, 6, 6);
  const w = worldOf(geometry, group(snap, "p0"), 0);
  snap = put(snap, 1, w.x + 1.02, w.y + .02); // bijna precies naast p0: een geldige snap
  assert.deepEqual(overlappingGroups(snap, geometry, "p1"), [], "kernen raken elkaar nauwelijks");
  const plan = planSettle(snap, geometry, options("p1"));
  assert.equal(plan.reason, "snap-possible");
  assert.equal(plan.moves.length, 0);
  // zelfs als een derde stuk op p1 zou liggen: zolang p1 kan verbinden, verplaatst niets
  snap = put(snap, 2, w.x + 1.3, w.y + .2);
  assert.equal(planSettle(snap, geometry, options("p1")).reason, "snap-possible");
});

test("het allerlaatste stuk op zijn bordplek wordt nooit weggeschoven: de bordcontrole gaat voor", () => {
  let snap = base();
  for (const piece of geometry.pieces) { const to = boardPosition(geometry, group(snap, `p${piece.id}`)); snap = put(snap, piece.id, to.x, to.y); }
  for (const piece of geometry.pieces.filter((p) => p.id !== 23)) snap = anchorGroup(snap, geometry, "DISCOVERER", `p${piece.id}`);
  const last = group(snap, "p23"); assert.ok(!last.anchored);
  // het laatste stuk ligt precies op zijn plek (en dus op de verankerde buren): geen uitwijking
  const plan = planSettle(snap, geometry, options("p23"));
  assert.equal(plan.reason, "snap-possible"); assert.equal(plan.moves.length, 0);
  // iets ernaast maar binnen de bordafstand: ook dan niets verplaatsen
  const near = put(snap, 23, last.x + .2, last.y + .2);
  assert.equal(planSettle(near, geometry, options("p23")).reason, "snap-possible");
});

test("geen veilige plek: er wordt niets verplaatst en de focusgroep blijft bereikbaar", () => {
  let snap = put(base(), 0, 5, 5); snap = put(snap, 1, 5.3, 5.2);
  const plan = planSettle(snap, geometry, options("p1", { limits: { maxRadius: .25, chainRadius: .25 } }));
  assert.equal(plan.reason, "blocked");
  assert.deepEqual(plan.moves, []);
  assert.deepEqual(plan.unresolved, ["p0"]);
  assert.equal(settleGroups(snap, geometry, options("p1", { limits: { maxRadius: .25, chainRadius: .25 } })), snap, "snapshot ongewijzigd");
});

test("een groep die iemand vasthoudt of die vastzit wordt nooit verplaatst", () => {
  let snap = put(base(), 0, 5, 5); snap = put(snap, 1, 5.3, 5.2);
  const plan = planSettle(snap, geometry, options("p1", { immovable: new Set(["p0"]) }));
  assert.ok(!plan.moves.some((m) => m.groupId === "p0"), "p0 wordt vastgehouden");
  // p1 (de focus) zoekt dan zelf een vrije plek, p0 blijft staan
  assert.deepEqual(plan.moves.map((m) => m.groupId), ["p1"]);
});

test("een kettingreactie blijft begrensd: nooit meer dan het maximum, nooit een nieuwe botsing", () => {
  // Een dichte rij losse stukken die elkaar raken; het middelste valt op de rij
  let snap = base();
  for (let i = 0; i < 10; i++) snap = put(snap, i, 4.2 + (i % 5) * 1.1, i < 5 ? 4.6 : 5.8);
  snap = put(snap, 12, 4.2 + 2 * 1.1 + .2, 5.2);
  const plan = planSettle(snap, geometry, options("p12"));
  assert.ok(plan.moves.length <= DEFAULT_SETTLE_LIMITS.maxMoves, `te veel verplaatsingen: ${plan.moves.length}`);
  const after = settleGroups(snap, geometry, options("p12"));
  for (const m of plan.moves) assert.ok(overlappingGroups(after, geometry, m.groupId).length <= 1 || m.groupId === "p12");
  assert.ok(clean(after, "p12") || plan.unresolved.length > 0);
  // de uitkomst voldoet aan de verplaatsingslimiet
  for (const m of plan.moves) assert.ok(Math.hypot(m.x - m.fromX, m.y - m.fromY) <= DEFAULT_SETTLE_LIMITS.maxRadius + 1e-6);
});

test("een bestaande overlapping die niets met de focusgroep te maken heeft blijft ongemoeid (oude sessies)", () => {
  let snap = put(base(), 0, 5, 5); snap = put(snap, 1, 5.3, 5.2); // oude overlapping
  snap = put(snap, 2, 8.5, 6.8); // de focusgroep ligt vrij
  const plan = planSettle(snap, geometry, options("p2"));
  assert.equal(plan.reason, "none"); assert.equal(plan.moves.length, 0);
  assert.equal(settleGroups(snap, geometry, options("p2")), snap);
});

test("verplaatste groepen blijven binnen de tafel, ook dicht bij de rand", () => {
  const table = puzzleWorktable(geometry).bounds;
  let snap = put(base(), 0, table.minX + .4, table.minY + .4); snap = put(snap, 1, table.minX + .6, table.minY + .6);
  const after = settleGroups(snap, geometry, options("p1"));
  for (const g of after.groups) { const rel = pieceCoreRects(geometry, g); for (const r of rel) { assert.ok(g.x + r.minX >= table.minX - 1e-6 && g.y + r.minY >= table.minY - 1e-6 && g.x + r.maxX <= table.maxX + 1e-6 && g.y + r.maxY <= table.maxY + 1e-6, `${g.id} buiten de tafel`); } }
  assert.ok(clean(after, "p1"));
});

test("rotaties van 0, 90, 180 en 270 graden: kernen draaien mee en een juiste verbinding botst niet met zichzelf", () => {
  const master = createPuzzleGeometry(24, "botsing");
  const snap = newPuzzleSnapshot(master, "MASTER");
  // een groep van twee stukken die niet bij elkaar horen, geroteerd: de kernrechthoeken blijven eenheidsvierkanten
  for (const degrees of [0, 90, 180, 270]) {
    let s = moveGroup(snap, master, "p0", 5, 5);
    for (let i = 0; i < degrees / 90; i++) s = rotateGroup(s, master, "p0");
    const rects = pieceCoreRects(master, s.groups.find((g) => g.id === "p0")!);
    assert.equal(rects.length, 1); assert.ok(Math.abs(rects[0].maxX - rects[0].minX - 1) < 1e-9 && Math.abs(rects[0].maxY - rects[0].minY - 1) < 1e-9, `${degrees}°`);
  }
  // een geroteerd los stuk boven op een ander stuk: gewoon een botsing, en de focus blijft geroteerd liggen
  let s = moveGroup(snap, master, "p0", 5, 5); s = rotateGroup(s, master, "p0"); s = moveGroup(s, master, "p1", 5.3, 5.2); s = rotateGroup(s, master, "p1"); s = rotateGroup(s, master, "p1");
  const before = s.groups.find((g) => g.id === "p1")!.rotation;
  assert.ok(overlappingGroups(s, master, "p1").includes("p0"), "geroteerde stukken botsen gewoon");
  const after = settleGroups(s, master, { focusGroupId: "p1", difficulty: "MASTER" });
  assert.equal(after.groups.find((g) => g.id === "p1")!.rotation, before, "de focusgroep blijft geroteerd liggen");
  assert.ok(overlappingGroups(after, master, "p1").length === 0);
});

test("prestatie: 300 stukken, een botsing met veel losse stukken eromheen", () => {
  const big = createPuzzleGeometry(300, "botsing-300");
  let snap = newPuzzleSnapshot(big, "DISCOVERER");
  snap = moveGroup(snap, big, "p10", 20, 20); snap = moveGroup(snap, big, "p11", 20.3, 20.2);
  const started = performance.now(); let plan = planSettle(snap, big, { focusGroupId: "p11", difficulty: "DISCOVERER" });
  for (let i = 0; i < 9; i++) plan = planSettle(snap, big, { focusGroupId: "p11", difficulty: "DISCOVERER" });
  const each = (performance.now() - started) / 10;
  assert.equal(plan.reason, "moved");
  assert.ok(each < 60, `een settle duurt ${each.toFixed(1)} ms`);
  assert.ok(settleWouldMove(snap, big, { focusGroupId: "p11", difficulty: "DISCOVERER" }));
  assert.equal(settleWouldMove(snap, big, { focusGroupId: "p200", difficulty: "DISCOVERER" }), false);
});

test("eigenschappen over 300 willekeurige tafels: vastgezette groepen staan stil, niets verlaat de tafel, verplaatste groepen botsen nergens meer", () => {
  const g = createPuzzleGeometry(48, "eigenschappen");
  const table = puzzleWorktable(g).bounds;
  let seed = 12345; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
  let moved = 0; let blocked = 0; let chained = 0;
  for (let round = 0; round < 300; round++) {
    let snap = newPuzzleSnapshot(g, "DISCOVERER");
    // een rommelige tafel: veel stukken dicht op elkaar in een kleine zone, een paar vastgezet op hun bordplek
    for (let i = 0; i < 30; i++) snap = moveGroup(snap, g, `p${i}`, 4 + random() * 7, 3.5 + random() * 6);
    const fixedIds = new Set<string>();
    for (let i = 30; i < 33; i++) { const to = boardPosition(g, snap.groups.find((x) => x.id === `p${i}`)!); snap = moveGroup(snap, g, `p${i}`, to.x, to.y); snap = anchorGroup(snap, g, "DISCOVERER", `p${i}`); }
    for (const x of snap.groups) if (x.anchored) fixedIds.add(x.id);
    const focus = `p${Math.floor(random() * 30)}`;
    const options = { focusGroupId: focus, difficulty: "DISCOVERER" as const };
    const plan = planSettle(snap, g, options);
    const again = planSettle(snap, g, options);
    assert.deepEqual(plan, again, "deterministisch");
    if (plan.reason === "snap-possible") continue;
    const after = settleGroups(snap, g, options);
    assert.ok(plan.moves.length <= DEFAULT_SETTLE_LIMITS.maxMoves + 1);
    for (const id of fixedIds) assert.deepEqual({ x: after.groups.find((x) => x.id === id)!.x, y: after.groups.find((x) => x.id === id)!.y }, { x: snap.groups.find((x) => x.id === id)!.x, y: snap.groups.find((x) => x.id === id)!.y }, "vastgezet gedeelte bewoog");
    for (const x of after.groups) for (const r of pieceCoreRects(g, x)) assert.ok(x.x + r.minX >= table.minX - 1e-6 && x.x + r.maxX <= table.maxX + 1e-6 && x.y + r.minY >= table.minY - 1e-6 && x.y + r.maxY <= table.maxY + 1e-6, "buiten de tafel");
    for (const m of plan.moves) assert.ok(Math.hypot(m.x - m.fromX, m.y - m.fromY) <= DEFAULT_SETTLE_LIMITS.maxRadius + 1e-6, "te ver verplaatst");
    // de verplaatste groepen botsen na afloop met niets meer (nooit een nieuwe, onopgeloste overlapping)
    for (const m of plan.moves) { const left = overlappingGroups(after, g, m.groupId).filter((other) => other !== focus && !plan.unresolved.includes(other)); assert.deepEqual(left, [], `${m.groupId} botst nog met ${left}`); }
    // alles wat niet nodig was, bleef staan
    const touchedIds = new Set(plan.moves.map((m) => m.groupId));
    for (const x of after.groups) if (!touchedIds.has(x.id)) assert.deepEqual({ x: x.x, y: x.y }, { x: snap.groups.find((y) => y.id === x.id)!.x, y: snap.groups.find((y) => y.id === x.id)!.y });
    // en een tweede ronde op het resultaat is rustig
    assert.equal(planSettle(after, g, options).moves.length, 0, "tweede ronde verplaatst nog iets");
    if (plan.moves.length) moved++; if (plan.reason === "blocked") blocked++; if (plan.moves.length > 1) chained++;
  }
  assert.ok(moved > 50, `te weinig scenario's met een verplaatsing: ${moved}`);
  assert.ok(chained >= 0 && blocked >= 0);
});

// ---- Regressie (review PR #117): botsing die alleen een later stuk van een verbonden groep raakt ----
const coreOverlap = (a: { minX: number; minY: number; maxX: number; maxY: number }, b: { minX: number; minY: number; maxX: number; maxY: number }) => Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0.22 && Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) > 0.22;

function pairWithRotation(turns: number) {
  const master = createPuzzleGeometry(24, "botsing");
  let s = newPuzzleSnapshot(master, "DISCOVERER");
  s = moveGroup(s, master, "p0", 6, 6); s = moveGroup(s, master, "p1", 7, 6); s = connectGroups(s, master, "DISCOVERER", 0, 1);
  let pair = groupFor(s, 0)!; for (let i = 0; i < turns; i++) { s = rotateGroup(s, master, pair.id); pair = groupFor(s, 0)!; }
  return { master, s, pair };
}

for (const turns of [0, 1, 2, 3]) {
  test(`verbonden groep (${turns * 90}°): een losse groep die alleen het tweede stuk raakt wordt toch als botsing gevonden en weggezet`, () => {
    const { master, s, pair } = pairWithRotation(turns);
    const rect = (snap: PuzzleSnapshot, id: string, i: number) => { const g = snap.groups.find((x) => x.id === id)!; const r = pieceCoreRects(master, g)[i]; return { minX: r.minX + g.x, minY: r.minY + g.y, maxX: r.maxX + g.x, maxY: r.maxY + g.y }; };
    // p8 komt uitsluitend op de kern van het tweede stuk te liggen (index 1), niet op die van het eerste.
    const second = rect(s, pair.id, 1);
    const first = rect(s, pair.id, 0); const dx = Math.sign(Math.round((second.minX - first.minX) * 10)); const dy = Math.sign(Math.round((second.minY - first.minY) * 10));
    const withLoose = moveGroup(s, master, "p8", second.minX + dx * .7 + (dx ? 0 : .3), second.minY + dy * .7 + (dy ? 0 : .3));
    assert.ok(coreOverlap(rect(withLoose, pair.id, 1), rect(withLoose, "p8", 0)), "voorwaarde: tweede stuk wordt geraakt");
    assert.ok(!coreOverlap(rect(withLoose, pair.id, 0), rect(withLoose, "p8", 0)), "voorwaarde: eerste stuk wordt niet geraakt");
    assert.deepEqual(overlappingGroups(withLoose, master, pair.id), ["p8"]);
    // 1. de groep zelf als focus (zij bevat het botsende stuk als 2e stuk): p8 moet uitwijken
    const opts = { focusGroupId: pair.id, difficulty: "DISCOVERER" as const };
    const plan = planSettle(withLoose, master, opts);
    assert.equal(plan.reason, "moved"); assert.deepEqual(plan.moves.map((m) => m.groupId), ["p8"]);
    const after = settleGroups(withLoose, master, opts);
    assert.deepEqual(overlappingGroups(after, master, pair.id), [], "geen overlap achtergebleven");
    assert.deepEqual(groupFor(after, 0)!.pieceIds, pair.pieceIds, "groep intact"); assert.equal(after.connections.length, withLoose.connections.length);
    assert.equal(group(after, pair.id).x, pair.x); assert.equal(group(after, pair.id).y, pair.y);
    assert.deepEqual(planSettle(withLoose, master, opts), plan, "deterministisch");
    // 2. andersom: p8 is de focus en de verbonden groep moet als geheel uitwijken (haar 2e stuk raakt)
    const other = { focusGroupId: "p8", difficulty: "DISCOVERER" as const };
    const plan2 = planSettle(withLoose, master, other);
    assert.equal(plan2.reason, "moved"); assert.deepEqual(plan2.moves.map((m) => m.groupId), [pair.id]);
    const after2 = settleGroups(withLoose, master, other);
    assert.deepEqual(overlappingGroups(after2, master, "p8"), []); assert.deepEqual(groupFor(after2, 0)!.pieceIds, pair.pieceIds);
    assert.deepEqual(planSettle(withLoose, master, other), plan2);
  });
}

test("grote verbonden groep (6 stukken): alleen het laatste stuk raakt een losse groep en dat wordt gevonden", () => {
  const big = createPuzzleGeometry(24, "botsing");
  let s = newPuzzleSnapshot(big, "DISCOVERER");
  s = moveGroup(s, big, "p0", 3, 4);
  for (let i = 1; i < 6; i++) { const a = groupFor(s, 0)!; const w = worldOf(big, a, i - 1); s = moveGroup(s, big, `p${i}`, w.x + 1, w.y); s = connectGroups(s, big, "DISCOVERER", i - 1, i); }
  const train = groupFor(s, 0)!; assert.equal(train.pieceIds.length, 6);
  const last = (() => { const r = pieceCoreRects(big, train)[5]; return { x: r.minX + train.x, y: r.minY + train.y }; })();
  const withLoose = moveGroup(s, big, "p20", last.x + .4, last.y + .3);
  assert.deepEqual(overlappingGroups(withLoose, big, train.id), ["p20"]);
  const after = settleGroups(withLoose, big, { focusGroupId: train.id, difficulty: "DISCOVERER" });
  assert.deepEqual(overlappingGroups(after, big, train.id), []); assert.deepEqual(groupFor(after, 0)!.pieceIds, train.pieceIds);
});

// ---- Zichtbaarheid (review PR #117): automatisch uitwijken brengt nooit een stuk buiten beeld ----
type R = { minX: number; minY: number; maxX: number; maxY: number };
const inside = (snap: PuzzleSnapshot, id: string, v: R) => { const g = group(snap, id); return pieceCoreRects(geometry, g).every((r) => r.minX + g.x >= v.minX - 1e-9 && r.maxX + g.x <= v.maxX + 1e-9 && r.minY + g.y >= v.minY - 1e-9 && r.maxY + g.y <= v.maxY + 1e-9); };
/** Een vastgezet stuk (bordpositie) met een los stuk erbovenop. */
function parkedOnAnchored() {
  let snap = base(); const board = boardPosition(geometry, group(snap, "p0"));
  snap = put(snap, 0, board.x, board.y); snap = anchorGroup(snap, geometry, "DISCOVERER", "p0");
  const a = group(snap, "p0"); snap = put(snap, 9, a.x + .3, a.y + .1);
  return { snap, a };
}
const around = (cx: number, cy: number, w: number, h: number): R => ({ minX: cx - w / 2, minY: cy - h / 2, maxX: cx + w / 2, maxY: cy + h / 2 });

test("visibleWorldRect: het beeld in wereldcoördinaten, met marge, ook sterk ingezoomd", () => {
  const v = visibleWorldRect({ scale: 65, x: -130, y: -65 }, { width: 390, height: 844 }, 0);
  assert.deepEqual([v.minX, v.minY, v.maxX, v.maxY].map((n) => Math.round(n * 100) / 100), [2, 1, 8, 13.98]);
  const zoomed = visibleWorldRect({ scale: 160, x: -800, y: -800 }, { width: 360, height: 740 });
  assert.ok(zoomed.maxX - zoomed.minX < 360 / 160 && zoomed.minX > 5);
});

for (const [name, w, h] of [["390 × 844", 390, 844], ["360 × 740", 360, 740], ["sterk ingezoomd (160 px per stuk)", 360, 740]] as const) {
  test(`uitwijken blijft in beeld (${name}): het geparkeerde stuk eindigt volledig zichtbaar`, () => {
    const { snap, a } = parkedOnAnchored();
    const scale = name.startsWith("sterk") ? 160 : 65;
    const view = visibleWorldRect({ scale, x: -(a.x - 1.2) * scale, y: -(a.y - 1.4) * scale }, { width: w, height: h });
    const opts = options("p9", { viewport: view });
    const plan = planSettle(snap, geometry, opts);
    if (plan.moves.length) {
      const after = settleGroups(snap, geometry, opts);
      assert.ok(inside(after, "p9", view), "het stuk is na het uitwijken volledig in beeld");
      assert.ok(clean(after, "p9")); assert.equal(group(after, "p0").x, a.x); assert.equal(group(after, "p0").y, a.y);
    } else assert.deepEqual(plan.moves, [], "geen veilige plek in beeld: blijft liggen");
    assert.deepEqual(planSettle(snap, geometry, opts), plan, "deterministisch");
  });
}

test("de dichtstbijzijnde vrije plek ligt buiten beeld: het stuk blijft bovenop liggen en wordt niet verplaatst", () => {
  const { snap, a } = parkedOnAnchored();
  // Een beeld dat vrijwel alleen het vastgezette stuk toont (marge al verwerkt): elke vrije plek ligt erbuiten.
  const view = around(a.x + .5, a.y + .5, 1.8, 1.8);
  const withViewport = planSettle(snap, geometry, options("p9", { viewport: view }));
  assert.equal(withViewport.reason, "blocked"); assert.deepEqual(withViewport.moves, []); assert.deepEqual(withViewport.unresolved, ["p0"]);
  assert.equal(settleGroups(snap, geometry, options("p9", { viewport: view })), snap, "dezelfde instantie: geen nieuwe versie");
  assert.equal(settleWouldMove(snap, geometry, options("p9", { viewport: view })), false, "de client verstuurt dan niets");
  // zonder die beperking zou het stuk wel verschuiven
  assert.equal(planSettle(snap, geometry, options("p9")).reason, "moved");
});

test("groepen buiten beeld bewegen niet: een stuk dat de speler niet ziet wordt nooit ongevraagd verplaatst", () => {
  let snap = put(base(), 0, 5, 5); snap = put(snap, 1, 5.3, 5.2);
  const away = around(9, 9, 4, 4); // p0 en p1 liggen buiten beeld
  assert.deepEqual(planSettle(snap, geometry, options("p1", { viewport: away })).moves, []);
  // p1 half in beeld, p0 er helemaal buiten: p0 is niet beweeglijk, dus p1 zoekt zelf een plek (volledig in beeld)
  snap = put(base(), 0, 5, 5); snap = put(snap, 1, 5.7, 5.2);
  const edge: R = { minX: 6.2, minY: 3.5, maxX: 9.5, maxY: 8 };
  const after = settleGroups(snap, geometry, options("p1", { viewport: edge }));
  assert.notEqual(after, snap); assert.equal(group(after, "p0").x, 5); assert.equal(group(after, "p0").y, 5);
  assert.ok(inside(after, "p1", edge)); assert.ok(clean(after, "p1"));
});

test("een groep die groter is dan het beeld blijft met haar middelpunt in beeld", () => {
  const big = createPuzzleGeometry(24, "botsing");
  let s = newPuzzleSnapshot(big, "DISCOVERER"); s = moveGroup(s, big, "p0", 4, 5);
  for (let i = 1; i < 6; i++) { const a = groupFor(s, 0)!; const w = worldOf(big, a, i - 1); s = moveGroup(s, big, `p${i}`, w.x + 1, w.y); s = connectGroups(s, big, "DISCOVERER", i - 1, i); }
  const train = groupFor(s, 0)!; const r = pieceCoreRects(big, train)[2];
  s = moveGroup(s, big, "p20", r.minX + train.x + .3, r.minY + train.y + .2);
  const view = around(train.x + 3, train.y + .5, 3.2, 3); // smaller than the 6-wide train
  const after = settleGroups(s, big, { focusGroupId: "p20", difficulty: "DISCOVERER", viewport: view });
  const moved = groupFor(after, 0)!; const rects = pieceCoreRects(big, moved);
  const minX = Math.min(...rects.map((q) => q.minX)) + moved.x; const maxX = Math.max(...rects.map((q) => q.maxX)) + moved.x;
  assert.ok(minX <= (view.minX + view.maxX) / 2 && maxX >= (view.minX + view.maxX) / 2, "middelpunt van het beeld blijft bedekt");
});
