import test from "node:test";
import assert from "node:assert/strict";
import { createPuzzleGeometry, pieceKind, tracePuzzlePiece } from "../src/lib/puzzle/geometry";
import { connectGroups, connectedPieces, findSnapConnection, groupFor, moveGroup, newPuzzleSnapshot, rotateGroup, worldOf } from "../src/lib/puzzle/engine";
import { groupBounds, groupMemberAt, puzzleWorktable } from "../src/lib/puzzle/worktable";
import { constrainCamera, fitCamera, screenToWorld, zoomCamera } from "../src/lib/puzzle/viewport";
import { filterPuzzleCatalog, puzzleCatalogPage } from "../src/lib/puzzle/catalog";

function placed(geometry: ReturnType<typeof createPuzzleGeometry>, state: ReturnType<typeof newPuzzleSnapshot>, id: number, x: number, y: number) {
  return moveGroup(state, geometry, `p${id}`, x, y);
}

test("geometrie is deterministisch en gedeelde randen zijn complementair", () => {
  const first = createPuzzleGeometry(24, "zelfde-seed"); const second = createPuzzleGeometry(24, "zelfde-seed");
  assert.deepEqual(first, second);
  for (const piece of first.pieces) {
    if (piece.right) assert.equal(piece.right, first.pieces[piece.id + 1].left);
    if (piece.bottom) assert.equal(piece.bottom, first.pieces[piece.id + first.grid.columns].top);
  }
});

test("geometry v2 gebruikt klassieke tabben en houdt versie 1 leesbaar", () => {
  const current = createPuzzleGeometry(24, "klassiek");
  const legacy = createPuzzleGeometry(24, "klassiek", 1);
  const edge = current.pieces.find((piece) => piece.right)?.right;
  assert.ok(edge?.neck && edge.roundness, "v2 beschrijft hals en ronde kop");
  assert.equal(legacy.pieces.find((piece) => piece.right)?.right?.neck, undefined, "v1 krijgt geen nieuwe vorm");
  assert.notDeepEqual(current, legacy);

  const commands: string[] = [];
  const path = {
    moveTo: () => commands.push("M"), lineTo: () => commands.push("L"),
    bezierCurveTo: () => commands.push("C"), closePath: () => commands.push("Z"),
  };
  tracePuzzlePiece(path, current.pieces[0]);
  // Twee binnenranden bevatten elk vier afgeronde segmenten: geen hoekige of
  // generieke enkele golf, maar hals + kop + hals.
  assert.equal(commands.filter((command) => command === "C").length, 8);
});

test("alle groottes hebben herkenbare hoek-, rand- en middenstukken zonder beginoverlap", () => {
  for (const count of [6, 12, 24, 48, 96] as const) {
    const geometry = createPuzzleGeometry(count, "vormen"); const snapshot = newPuzzleSnapshot(geometry, "MASTER"); const table = puzzleWorktable(geometry);
    assert.equal(geometry.pieces.filter((p) => pieceKind(p) === "CORNERS").length, 4);
    assert.ok(geometry.pieces.some((p) => pieceKind(p) === "EDGES"));
    if (count >= 12) assert.ok(geometry.pieces.some((p) => pieceKind(p) === "MIDDLES"));
    for (const group of snapshot.groups) {
      const bounds = groupBounds(geometry, group);
      assert.ok(bounds.minX >= table.bounds.minX && bounds.maxX <= table.bounds.maxX);
      assert.ok(bounds.minY >= table.bounds.minY && bounds.maxY <= table.bounds.maxY);
    }
    for (let first = 0; first < snapshot.groups.length; first++) for (let second = first + 1; second < snapshot.groups.length; second++) {
      const a = groupBounds(geometry, snapshot.groups[first]); const b = groupBounds(geometry, snapshot.groups[second]);
      assert.ok(a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY, `stukken ${first} en ${second} overlappen`);
    }
  }
});

test("alleen naburige stukken op canonieke relatieve positie verbinden", () => {
  const geometry = createPuzzleGeometry(6, "snap"); let state = newPuzzleSnapshot(geometry, "ADVENTURER");
  state = placed(geometry, state, 0, 2, 2); state = placed(geometry, state, 1, 3.05, 2.02);
  const merged = connectGroups(state, geometry, "ADVENTURER", 0, 1);
  assert.equal(merged.groups.length, 5); assert.equal(merged.connections.length, 1);
  assert.equal(connectGroups(merged, geometry, "ADVENTURER", 0, 4), merged);
});

test("een gefuseerde groep behoudt één anker en beweegt via ieder lid als geheel", () => {
  const geometry = createPuzzleGeometry(6, "groep"); let state = newPuzzleSnapshot(geometry, "ADVENTURER");
  state = placed(geometry, state, 0, 2, 2); state = placed(geometry, state, 1, 3, 2);
  state = connectGroups(state, geometry, "ADVENTURER", 0, 1);
  const group = groupFor(state, 1)!; assert.deepEqual(group.pieceIds, [0, 1]);
  state = moveGroup(state, geometry, group.id, 5, 4);
  const moved = groupFor(state, 0)!;
  assert.deepEqual(worldOf(geometry, moved, 0), { x: 5, y: 4 }); assert.deepEqual(worldOf(geometry, moved, 1), { x: 6, y: 4 });
  assert.equal(groupMemberAt(geometry, moved, { x: 5.5, y: 4.5 }), 0);
  assert.equal(groupMemberAt(geometry, moved, { x: 6.5, y: 4.5 }), 1);
  assert.equal(connectedPieces(state), 2);
});

test("twee groepen smelten samen zonder groepsleden of relatieve posities te verliezen", () => {
  const geometry = createPuzzleGeometry(12, "samensmelten"); let state = newPuzzleSnapshot(geometry, "ADVENTURER");
  state = placed(geometry, state, 0, 3, 3); state = placed(geometry, state, 1, 4, 3); state = connectGroups(state, geometry, "ADVENTURER", 0, 1);
  state = placed(geometry, state, 2, 5, 3); state = placed(geometry, state, 3, 6, 3); state = connectGroups(state, geometry, "ADVENTURER", 2, 3);
  state = connectGroups(state, geometry, "ADVENTURER", 1, 2);
  const joined = groupFor(state, 3)!; assert.deepEqual(joined.pieceIds, [0, 1, 2, 3]); assert.equal(state.groups.filter((group) => group.pieceIds.some((id) => id < 4)).length, 1);
  state = moveGroup(state, geometry, joined.id, 5, 5); const moved = groupFor(state, 2)!;
  for (const id of [0, 1, 2, 3]) assert.deepEqual(worldOf(geometry, moved, id), { x: 5 + id, y: 5 });
  const restored = JSON.parse(JSON.stringify(state)); assert.deepEqual(groupFor(restored, 3), moved);
});

test("een groep behoudt zijn leden bij verplaatsen na pan en zoom", () => {
  const geometry = createPuzzleGeometry(6, "viewportgroep"); let state = newPuzzleSnapshot(geometry, "ADVENTURER");
  state = placed(geometry, state, 0, 2, 2); state = placed(geometry, state, 1, 3, 2); state = connectGroups(state, geometry, "ADVENTURER", 0, 1);
  const viewport = { width: 390, height: 640 }; const bounds = puzzleWorktable(geometry).bounds;
  let camera = fitCamera(viewport, bounds); camera = zoomCamera(camera, viewport, bounds, 1.8, { x: 220, y: 280 }); camera = constrainCamera({ ...camera, x: camera.x - 80, y: camera.y - 35 }, viewport, bounds);
  const targetWorld = { x: 4.5, y: 4.5 }; const targetScreen = { x: targetWorld.x * camera.scale + camera.x, y: targetWorld.y * camera.scale + camera.y };
  const recovered = screenToWorld(camera, targetScreen); const group = groupFor(state, 0)!;
  state = moveGroup(state, geometry, group.id, recovered.x - .5, recovered.y - .5);
  const moved = groupFor(state, 1)!; assert.deepEqual(moved.pieceIds, [0, 1]); assert.deepEqual(worldOf(geometry, moved, 0), { x: 4, y: 4 }); assert.deepEqual(worldOf(geometry, moved, 1), { x: 5, y: 4 });
});

test("fit houdt de volledige begrensde werktafel bereikbaar op een klein scherm", () => {
  const geometry = createPuzzleGeometry(96, "fit"); const bounds = puzzleWorktable(geometry).bounds; const viewport = { width: 320, height: 480 }; const camera = fitCamera(viewport, bounds);
  assert.ok(bounds.minX * camera.scale + camera.x >= 0); assert.ok(bounds.maxX * camera.scale + camera.x <= viewport.width);
  assert.ok(bounds.minY * camera.scale + camera.y >= 0); assert.ok(bounds.maxY * camera.scale + camera.y <= viewport.height);
});

test("snap kiest alleen de beste geldige buur, onafhankelijk van camera-zoom", () => {
  const geometry = createPuzzleGeometry(6, "snapgroep"); let state = newPuzzleSnapshot(geometry, "EXPERT");
  state = placed(geometry, state, 0, 3, 3); state = placed(geometry, state, 1, 4.06, 3.02);
  const candidate = findSnapConnection(state, geometry, "EXPERT", "p1"); assert.equal(candidate?.a, 1); assert.equal(candidate?.b, 0); assert.ok(candidate && candidate.error < .07);
  state = placed(geometry, state, 1, 4.3, 3); assert.equal(findSnapConnection(state, geometry, "EXPERT", "p1"), null);
});

test("een comfortabele snap richt groepen exact uit en blijft ongeldig buiten de tolerantie", () => {
  const geometry = createPuzzleGeometry(12, "magnetisch"); let state = newPuzzleSnapshot(geometry, "ADVENTURER");
  state = placed(geometry, state, 0, 3, 3); state = placed(geometry, state, 1, 4.28, 3.12);
  const candidate = findSnapConnection(state, geometry, "ADVENTURER", "p1");
  assert.ok(candidate, "een aanraakvriendelijke marge accepteert de canonieke buur");
  state = connectGroups(state, geometry, "ADVENTURER", candidate!.a, candidate!.b);
  const joined = groupFor(state, 0)!;
  assert.deepEqual(worldOf(geometry, joined, 1), { x: joined.x, y: joined.y });
  assert.deepEqual(worldOf(geometry, joined, 0), { x: joined.x - 1, y: joined.y });
  state = placed(geometry, state, 2, 8, 8);
  assert.equal(findSnapConnection(state, geometry, "ADVENTURER", "p2"), null);
});

test("rotatie voorkomt een verbinding totdat de groep recht staat", () => {
  const geometry = createPuzzleGeometry(6, "rotatie"); let state = newPuzzleSnapshot(geometry, "MASTER");
  state = placed(geometry, state, 0, 2, 2); state = placed(geometry, state, 1, 3, 2);
  state = rotateGroup(state, geometry, "p0"); assert.equal(connectGroups(state, geometry, "MASTER", 0, 1), state);
  state = rotateGroup(state, geometry, "p0"); state = rotateGroup(state, geometry, "p0"); state = rotateGroup(state, geometry, "p0");
  state = rotateGroup(state, geometry, "p1"); state = rotateGroup(state, geometry, "p1"); state = rotateGroup(state, geometry, "p1");
  assert.equal(connectGroups(state, geometry, "MASTER", 0, 1).connections.length, 1);
});

test("de puzzelkeuze pagineert de hele catalogus en zoekt zonder dubbelen", () => {
  const catalog = Array.from({ length: 216 }, (_, index) => ({ id: index, title: `Afbeelding ${index + 1}` }));
  const last = puzzleCatalogPage(catalog, 99);
  assert.equal(last.pages, 9); assert.equal(last.currentPage, 8); assert.equal(last.items.length, 24); assert.equal(last.items[0].id, 192);
  const found = filterPuzzleCatalog(catalog, "216", (item) => item.title);
  assert.deepEqual(found.map((item) => item.id), [215]);
  assert.equal(new Set(catalog.map((item) => item.id)).size, catalog.length);
});
