import test from "node:test";
import assert from "node:assert/strict";
import { createPuzzleGeometry, pieceKind } from "../src/lib/puzzle/geometry";
import { connectGroups, moveGroup, newPuzzleSnapshot, rotateGroup } from "../src/lib/puzzle/engine";

test("geometrie is deterministisch en gedeelde randen zijn complementair", () => {
  const first = createPuzzleGeometry(24, "zelfde-seed"); const second = createPuzzleGeometry(24, "zelfde-seed");
  assert.deepEqual(first, second);
  for (const piece of first.pieces) {
    if (piece.right) assert.equal(piece.right, first.pieces[piece.id + 1].left);
    if (piece.bottom) assert.equal(piece.bottom, first.pieces[piece.id + first.grid.columns].top);
  }
});

test("alle groottes hebben herkenbare hoek-, rand- en middenstukken", () => {
  for (const count of [6, 12, 24, 48, 96] as const) {
    const geometry = createPuzzleGeometry(count, "vormen");
    assert.equal(geometry.pieces.filter((p) => pieceKind(p) === "CORNERS").length, 4);
    assert.ok(geometry.pieces.some((p) => pieceKind(p) === "EDGES"));
    if (count >= 12) assert.ok(geometry.pieces.some((p) => pieceKind(p) === "MIDDLES"));
  }
});

test("alleen naburige stukken op canonieke relatieve positie verbinden", () => {
  const geometry = createPuzzleGeometry(6, "snap"); let state = newPuzzleSnapshot(geometry, "ADVENTURER");
  state = moveGroup(state, "p0", 0, 0); state = moveGroup(state, "p1", 1.05, 0.02);
  const merged = connectGroups(state, geometry, "ADVENTURER", 0, 1);
  assert.equal(merged.groups.length, 5); assert.equal(merged.connections.length, 1);
  assert.equal(connectGroups(merged, geometry, "ADVENTURER", 0, 4), merged);
});

test("rotatie voorkomt een verbinding totdat de groep recht staat", () => {
  const geometry = createPuzzleGeometry(6, "rotatie"); let state = newPuzzleSnapshot(geometry, "MASTER");
  state = moveGroup(state, "p0", 0, 0); state = moveGroup(state, "p1", 1, 0);
  state = rotateGroup(state, "p0"); assert.equal(connectGroups(state, geometry, "MASTER", 0, 1), state);
  state = rotateGroup(state, "p0"); state = rotateGroup(state, "p0"); state = rotateGroup(state, "p0");
  state = rotateGroup(state, "p1"); state = rotateGroup(state, "p1"); state = rotateGroup(state, "p1");
  assert.equal(connectGroups(state, geometry, "MASTER", 0, 1).connections.length, 1);
});
