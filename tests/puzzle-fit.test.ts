import test from "node:test";
import assert from "node:assert/strict";
import { createPuzzleGeometry, tracePuzzleGroup, tracePuzzlePiece } from "../src/lib/puzzle/geometry";
import { connectGroups, findSnapConnection, groupFor, moveGroup, newPuzzleSnapshot, worldOf } from "../src/lib/puzzle/engine";
import type { PuzzlePieceGeometry } from "../src/lib/puzzle/types";
import { initialPuzzleCamera, resizeCamera, screenToWorld, zoomCamera } from "../src/lib/puzzle/viewport";
import { puzzleWorktable } from "../src/lib/puzzle/worktable";

type Point = [number, number];
type Segment = { from: Point; to: Point; controls?: [Point, Point] };
function sides(piece: PuzzlePieceGeometry) {
  const paths: Segment[][] = [[], [], [], []]; let side = 0; let current: Point = [0, 0];
  const point = (x: number, y: number): Point => [piece.column + x, piece.row + y];
  const corners = [[1, 0], [1, 1], [0, 1], [0, 0]];
  tracePuzzlePiece({
    moveTo(x, y) { current = point(x, y); },
    lineTo(x, y) { paths[side].push({ from: current, to: point(x, y) }); current = point(x, y); if (x === corners[side][0] && y === corners[side][1]) side++; },
    bezierCurveTo(ax, ay, bx, by, x, y) { paths[side].push({ from: current, to: point(x, y), controls: [point(ax, ay), point(bx, by)] }); current = point(x, y); },
    closePath() {},
  }, piece);
  return paths;
}
function samePoint(a: Point, b: Point) { assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-12, `${a} wijkt af van ${b}`); }
function complementary(a: Segment[], b: Segment[]) {
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    const first = a[i]; const second = b[b.length - 1 - i];
    samePoint(first.from, second.to); samePoint(first.to, second.from);
    assert.equal(!!first.controls, !!second.controls);
    if (first.controls && second.controls) { samePoint(first.controls[0], second.controls[1]); samePoint(first.controls[1], second.controls[0]); }
  }
}

test("werkelijke Bézier-paden van iedere gedeelde rand zijn exact complementair", () => {
  for (const version of [1, 2]) for (const count of [6, 12, 24, 48, 96] as const) for (let seed = 0; seed < 12; seed++) {
    const geometry = createPuzzleGeometry(count, `rand-${seed}`, version);
    const paths = geometry.pieces.map(sides);
    for (const piece of geometry.pieces) {
      if (piece.right) complementary(paths[piece.id][1], paths[piece.id + 1][3]);
      if (piece.bottom) complementary(paths[piece.id][2], paths[piece.id + geometry.grid.columns][0]);
    }
  }
});

test("magnetische snap trekt losse stukken en groepen naar het stilstaande anker", () => {
  for (const kind of ["los-los", "los-groep", "groep-groep"]) {
    const geometry = createPuzzleGeometry(12, kind); let state = newPuzzleSnapshot(geometry, "ADVENTURER");
    const place = (id: number, x: number, y: number) => { state = moveGroup(state, geometry, `p${id}`, x, y); };
    place(0, 3, 3);
    let movedId = 1;
    if (kind !== "los-los") { place(1, 4, 3); state = connectGroups(state, geometry, "ADVENTURER", 0, 1); movedId = 2; }
    place(movedId, 3 + movedId + .25, 3.1);
    if (kind === "groep-groep") { place(3, 6.25, 3.1); state = connectGroups(state, geometry, "ADVENTURER", 2, 3); }
    const before = worldOf(geometry, groupFor(state, 0)!, 0);
    const candidate = findSnapConnection(state, geometry, "ADVENTURER", `p${movedId}`); assert.ok(candidate);
    state = connectGroups(state, geometry, "ADVENTURER", candidate.a, candidate.b);
    const joined = groupFor(state, movedId)!;
    assert.deepEqual(worldOf(geometry, joined, 0), before, `${kind}: stilstaande groep mag niet springen`);
    assert.deepEqual(worldOf(geometry, joined, movedId), { x: before.x + movedId, y: before.y });
    assert.equal(new Set(joined.pieceIds).size, joined.pieceIds.length);
  }
});

test("groepscontour verwijdert interne randen en behoudt gaten en hoekraakpunten", () => {
  const geometry = createPuzzleGeometry(24, "contour");
  for (const ids of [[0, 1], [0, 1, 2, 6, 8, 12, 13, 14], [0, 1, 6, 8, 12, 13, 14]]) {
    let loops = 0; let closes = 0; let current: Point = [0, 0]; let start: Point = current;
    const polygons: Point[][] = []; let polygon: Point[] = [];
    tracePuzzleGroup({
      moveTo(x, y) { current = [x, y]; start = current; loops++; polygon = [current]; polygons.push(polygon); },
      lineTo(x, y) { current = [x, y]; polygon.push(current); },
      bezierCurveTo(a, b, c, d, x, y) { const from = current; for (let i = 1; i <= 24; i++) { const t = i / 24; const u = 1 - t; polygon.push([u ** 3 * from[0] + 3 * u ** 2 * t * a + 3 * u * t ** 2 * c + t ** 3 * x, u ** 3 * from[1] + 3 * u ** 2 * t * b + 3 * u * t ** 2 * d + t ** 3 * y]); } current = [x, y]; },
      closePath() { samePoint(current, start); closes++; },
    }, geometry, ids);
    assert.equal(loops, closes);
    if (ids.length === 8) assert.equal(loops, 2, "een binnencontour heeft tegengestelde winding");
    const winding = ([x, y]: Point) => polygons.reduce((total, points) => total + points.slice(1).reduce((sum, to, i) => {
      const from = points[i]; const cross = (to[0] - from[0]) * (y - from[1]) - (x - from[0]) * (to[1] - from[1]);
      return sum + (from[1] <= y && to[1] > y && cross > 0 ? 1 : from[1] > y && to[1] <= y && cross < 0 ? -1 : 0);
    }, 0), 0);
    assert.notEqual(winding([.5, .5]), 0);
    assert.equal(winding([1.5, 1.5]), 0, "ook een gat dat de buitencontour op één hoek raakt blijft leeg");
  }
  let curves = 0;
  tracePuzzleGroup({ moveTo() {}, lineTo() {}, bezierCurveTo() { curves++; }, closePath() {} }, geometry, geometry.pieces.map((piece) => piece.id));
  assert.equal(curves, 0, "een compleet raster heeft uitsluitend de echte vlakke buitenrand");
});

test("startcamera toont bruikbare stukken; resize behoudt zoom en world-midden", () => {
  for (const count of [6, 24, 96] as const) {
    const geometry = createPuzzleGeometry(count, "mobiel"); const snapshot = newPuzzleSnapshot(geometry, "ADVENTURER");
    const viewport = { width: 320, height: 515 }; const table = puzzleWorktable(geometry);
    const camera = initialPuzzleCamera(viewport, geometry, snapshot);
    assert.ok(camera.scale >= 40);
    assert.ok(snapshot.groups.some((group) => { const x = (group.x + .5) * camera.scale + camera.x; const y = (group.y + .5) * camera.scale + camera.y; return x > 0 && x < viewport.width && y > 0 && y < viewport.height; }), "bij openen staat minstens een los stuk in beeld");
    const zoomed = zoomCamera(camera, viewport, table.bounds, 1.5, { x: 160, y: 250 });
    const next = { width: 390, height: 660 }; const resized = resizeCamera(zoomed, viewport, next, table.bounds);
    assert.equal(resized.scale, zoomed.scale);
    const before = screenToWorld(zoomed, { x: viewport.width / 2, y: viewport.height / 2 });
    const after = screenToWorld(resized, { x: next.width / 2, y: next.height / 2 });
    samePoint([before.x, before.y], [after.x, after.y]);
  }
});
