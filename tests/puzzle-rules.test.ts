import test from "node:test";
import assert from "node:assert/strict";
import { anchorGroup, boardPosition, boardSnapTarget, cloneSnapshot, connectGroups, groupFor, isPuzzleComplete, moveGroup, newPuzzleSnapshot, rotateGroup, validPuzzleStructure } from "../src/lib/puzzle/engine";
import { areNeighbours, createPuzzleGeometry, pieceKind } from "../src/lib/puzzle/geometry";
import { activePuzzleHint, puzzleHintBudget, puzzleHintTarget } from "../src/lib/puzzle/hints";
import { puzzlePolicy, SOLO_PIECE_COUNTS, type PuzzleDifficulty, type PuzzleSnapshot } from "../src/lib/puzzle/types";

const levels: PuzzleDifficulty[] = ["DISCOVERER", "ADVENTURER", "EXPERT", "MASTER"];
const geometry = createPuzzleGeometry(12, "regels2");
function atBoard(state: PuzzleSnapshot, piece: number, error = .2) {
  const group = groupFor(state, piece)!; const to = boardPosition(geometry, group);
  return moveGroup(state, geometry, group.id, to.x + error, to.y);
}

test("vier nieuwe policies scheiden ondersteuning, bordplaatsing en rotatie van stukaantal", () => {
  assert.deepEqual(levels.map((level) => { const p = puzzlePolicy(level); return [p.showGhost, p.showOutline, p.boardSnap, p.rotationRequired, p.includedHints]; }), [[true,true,true,false,null],[false,true,true,false,3],[false,false,false,false,2],[false,false,false,true,1]]);
  assert.equal(new Set(levels.map((level) => puzzlePolicy(level).snap)).size, 1);
  for (const count of SOLO_PIECE_COUNTS) for (const level of levels) {
    const g = createPuzzleGeometry(count, "alle-niveaus"); const state = newPuzzleSnapshot(g, level);
    assert.equal(state.groups.length, count);
    assert.equal(state.groups.some((group) => group.rotation !== 0), level === "MASTER");
    assert.ok(validPuzzleStructure(state, g, level));
  }
  assert.deepEqual(levels.map((level) => puzzlePolicy(level, 1).snap), [.42,.32,.24,.20]);
  assert.ok(puzzlePolicy("EXPERT", 1).showOutline);
  assert.ok(levels.every((level) => !puzzlePolicy(level, 1).boardSnap));
  assert.throws(() => puzzlePolicy("MASTER", 3));
});

test("alle niveaus verbinden comfortabel in wereldcoördinaten; verkeerde buren/rotaties nooit", () => {
  for (const level of levels) {
    let state = newPuzzleSnapshot(geometry, level);
    state.groups.forEach((group) => { group.rotation = 0; });
    state = moveGroup(state, geometry, "p0", 4, 4);
    state = moveGroup(state, geometry, "p1", 5.34, 4);
    assert.equal(connectGroups(state, geometry, level, 0, 1).groups.length, 11);
    assert.equal(connectGroups(state, geometry, level, 0, 2), state);
    state = moveGroup(state, geometry, "p1", 5.4, 4);
    assert.equal(connectGroups(state, geometry, level, 0, 1), state);
    state = moveGroup(state, geometry, "p1", 5, 4); state = rotateGroup(state, geometry, "p1");
    assert.equal(connectGroups(state, geometry, level, 0, 1), state);
  }
});

test("bordactie verankert uitsluitend easy, binnen tolerantie en met juiste oriëntatie", () => {
  for (const level of levels) {
    let state = newPuzzleSnapshot(geometry, level); state.groups[0].rotation = 0;
    state = atBoard(state, 0);
    const anchored = anchorGroup(state, geometry, level, "p0");
    assert.equal(anchored.groups[0].anchored === true, level === "DISCOVERER" || level === "ADVENTURER");
    assert.equal(anchorGroup(state, geometry, level, "p0", 1), state);
  }
  const state = newPuzzleSnapshot(geometry, "ADVENTURER");
  const far = atBoard(state, 0, .4); assert.equal(boardSnapTarget(far, geometry, "ADVENTURER", "p0"), null);
  const rotated = rotateGroup(atBoard(state, 0), geometry, "p0"); assert.equal(anchorGroup(rotated, geometry, "ADVENTURER", "p0"), rotated);
  const anchored = anchorGroup(atBoard(state, 0), geometry, "ADVENTURER", "p0");
  assert.deepEqual(anchored.groups[0], { ...state.groups[0], ...boardPosition(geometry, state.groups[0]), anchored: true });
  assert.equal(moveGroup(anchored, geometry, "p0", 9, 9), anchored);
  assert.equal(rotateGroup(anchored, geometry, "p0"), anchored);
  assert.equal(anchorGroup(anchored, geometry, "ADVENTURER", "p0"), anchored);
  assert.equal(anchored.completedAt, null);
});

test("vrij verbonden groep verankert als geheel en behoudt canonieke relatieve posities", () => {
  let state = atBoard(atBoard(newPuzzleSnapshot(geometry, "ADVENTURER"), 0), 1);
  state = connectGroups(state, geometry, "ADVENTURER", 0, 1);
  const edges = structuredClone(state.connections);
  state = anchorGroup(state, geometry, "ADVENTURER", groupFor(state, 0)!.id);
  assert.ok(groupFor(state, 0)!.anchored); assert.deepEqual(state.connections, edges);
  assert.deepEqual(groupFor(state, 0)!.pieceIds, [0, 1]);
  assert.ok(validPuzzleStructure(state, geometry, "ADVENTURER"));
});

test("verbinden behoudt bordanker ongeacht clientvolgorde en overbrugt twee verankerde groepen", () => {
  for (const reverse of [false, true]) {
    let state = newPuzzleSnapshot(geometry, "ADVENTURER");
    for (const piece of [0, 2]) state = anchorGroup(atBoard(state, piece), geometry, "ADVENTURER", `p${piece}`);
    assert.equal(state.groups.filter((g) => g.anchored).length, 2);
    const anchor = { ...groupFor(state, 0)! };
    state = atBoard(state, 1, -.1);
    state = connectGroups(state, geometry, "ADVENTURER", reverse ? 1 : 0, reverse ? 0 : 1);
    const grown = groupFor(state, 0)!;
    assert.equal(grown.x, anchor.x); assert.equal(grown.y, anchor.y);
    assert.ok(grown.anchored); assert.equal(grown.pieceIds.length, 3);
    assert.equal(state.groups.filter((g) => g.anchored).length, 1);
    assert.ok(validPuzzleStructure(state, geometry, "ADVENTURER"));
  }
});

test("losse bordplaatsingen voltooien in elke volgorde pas met volledige serverbewezen dekking", () => {
  for (const order of [[...Array(12).keys()], [...Array(12).keys()].reverse(), [0,2,8,10,5,7,1,3,4,6,9,11]]) {
    let state = newPuzzleSnapshot(geometry, "ADVENTURER");
    for (const [index, piece] of order.entries()) {
      state = atBoard(state, piece); state = anchorGroup(state, geometry, "ADVENTURER", groupFor(state, piece)!.id);
      assert.equal(isPuzzleComplete(state, geometry, "ADVENTURER"), index === 11);
      assert.equal(!!state.completedAt, index === 11);
      assert.ok(validPuzzleStructure(state, geometry, "ADVENTURER"));
    }
    assert.equal(state.connections.length, 11);
    assert.ok(isPuzzleComplete(JSON.parse(JSON.stringify(state)), geometry, "ADVENTURER"));
  }
});

test("dubbele leden, valse groepen, cycli en verschoven ankers bewijzen geen voltooiing", () => {
  const base = newPuzzleSnapshot(geometry, "ADVENTURER");
  const duplicate = cloneSnapshot(base); duplicate.groups[1].pieceIds = [0];
  const fake = cloneSnapshot(base); fake.groups[0].pieceIds.push(1); fake.groups.splice(1, 1);
  const shifted = anchorGroup(atBoard(base, 0), geometry, "ADVENTURER", "p0"); shifted.groups[0].x += .01;
  const cycle = cloneSnapshot(base);
  cycle.groups[0].pieceIds = [0,1,4,5,9]; cycle.groups = cycle.groups.filter((group) => !["p1","p4","p5","p9"].includes(group.id));
  cycle.connections = [{ a: 0, b: 1 }, { a: 1, b: 5 }, { a: 5, b: 4 }, { a: 4, b: 0 }];
  for (const bad of [duplicate, fake, shifted, cycle]) {
    bad.completedAt = new Date().toISOString();
    assert.equal(validPuzzleStructure(bad, geometry, "ADVENTURER"), false);
    assert.equal(isPuzzleComplete(bad, geometry, "ADVENTURER"), false);
  }
});

test("hints zijn tijdelijk, hebben echte externe targets en veranderen geen spelstatus", () => {
  let state = newPuzzleSnapshot(geometry, "EXPERT");
  state = moveGroup(state, geometry, "p0", 4, 4); state = moveGroup(state, geometry, "p1", 5, 4);
  state = connectGroups(state, geometry, "EXPERT", 0, 1);
  const before = structuredClone(state);
  assert.deepEqual(puzzleHintTarget(state, geometry, "PREVIEW"), { type: "PREVIEW" });
  const location = puzzleHintTarget(state, geometry, "LOCATION", 1);
  assert.ok(location?.type === "LOCATION"); assert.deepEqual(location.pieceIds, [0,1]);
  assert.deepEqual({ x: location.x, y: location.y }, boardPosition(geometry, groupFor(state, 0)!));
  const connection = puzzleHintTarget(state, geometry, "CONNECTION", 1);
  assert.ok(connection?.type === "CONNECTION"); assert.ok(areNeighbours(geometry, connection.pieceId, connection.neighborId));
  assert.ok(!groupFor(state, 0)!.pieceIds.includes(connection.neighborId));
  assert.equal(puzzleHintTarget(state, geometry, "CONNECTION", 99), null);
  assert.equal(puzzleHintTarget(state, geometry, "FILTER"), null);
  for (const filter of ["CORNERS", "EDGES", "MIDDLES"] as const) {
    const target = puzzleHintTarget(state, geometry, "FILTER", undefined, filter);
    assert.ok(target?.type === "FILTER"); assert.ok(target.pieceIds.length);
    assert.ok(target.pieceIds.every((id) => pieceKind(geometry.pieces[id]) === filter));
  }
  assert.deepEqual(state, before);
  const now = Date.now(); state.hints.push({ type: "PREVIEW", at: new Date(now).toISOString(), expiresAt: new Date(now + 5000).toISOString(), extra: false, target: { type: "PREVIEW" } });
  assert.ok(activePuzzleHint(state, now + 4999)); assert.equal(activePuzzleHint(state, now + 5000), null);
  assert.deepEqual(levels.map((level) => puzzleHintBudget(state, level).remaining), [null,2,1,0]);
});


test("bordplaatsing voltooit alle ondersteunde aantallen, ook door groepen naar een bordanker te trekken", () => {
  for (const count of SOLO_PIECE_COUNTS) for (const difficulty of ["DISCOVERER","ADVENTURER"] as const) {
    const g = createPuzzleGeometry(count, "alle-bordformaten"); let state = newPuzzleSnapshot(g,difficulty);
    const original = boardPosition(g,groupFor(state,0)!);
    state = moveGroup(state,g,"p0",original.x+.1,original.y); state = anchorGroup(state,g,difficulty,"p0");
    for (let id=1;id<count;id++) {
      const to=boardPosition(g,groupFor(state,id)!); state=moveGroup(state,g,`p${id}`,to.x+.15,to.y);
      // Iedere rij bouwt via de linkerbuur; het eerste stuk via de bovenbuur.
      const neighbor=id%g.grid.columns===0?id-g.grid.columns:id-1;
      state=connectGroups(state,g,difficulty,id,neighbor);
      assert.ok(groupFor(state,id)!.anchored);
      assert.equal(isPuzzleComplete(state,g,difficulty),id===count-1);
      assert.equal(groupFor(state,0)!.x,original.x); assert.equal(groupFor(state,0)!.y,original.y);
    }
    assert.equal(state.connections.length,count-1); assert.equal(state.groups.length,1);
  }
});
