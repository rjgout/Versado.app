import test from "node:test";
import assert from "node:assert/strict";
import { createPuzzleGeometry, tracePuzzleGroup, tracePuzzlePiece } from "../src/lib/puzzle/geometry";
import { connectGroups, findSnapConnection, groupFor, moveGroup, newPuzzleSnapshot, worldOf } from "../src/lib/puzzle/engine";
import type { PuzzlePieceGeometry } from "../src/lib/puzzle/types";
import { constrainCamera, initialPuzzleCamera, resizeCamera, screenToWorld, zoomCamera } from "../src/lib/puzzle/viewport";
import { groupBounds, puzzleRenderOrder, puzzleWorktable } from "../src/lib/puzzle/worktable";

type Point = [number, number];
type Segment = { from: Point; to: Point; controls?: [Point, Point] };

test("sleepprioriteit geldt voor de hele groep en verandert de opgeslagen volgorde niet", () => {
  const geometry = createPuzzleGeometry(12, "sleepvolgorde");
  let snapshot = newPuzzleSnapshot(geometry, "ADVENTURER");
  for (const id of [0, 1]) snapshot = moveGroup(snapshot, geometry, `p${id}`, 4 + id, 4);
  snapshot = connectGroups(snapshot, geometry, "ADVENTURER", 0, 1);
  const before = structuredClone(snapshot);
  const groups = Object.freeze(snapshot.groups);
  for (const group of groups) {
    const order = puzzleRenderOrder(groups, group.id);
    assert.equal(order.at(-1), group);
    assert.deepEqual(order.slice(0, -1), groups.filter((candidate) => candidate.id !== group.id));
    assert.deepEqual(order.at(-1)!.pieceIds, group.pieceIds);
    assert.equal(new Set(order).size, groups.length);
  }
  assert.deepEqual(puzzleRenderOrder(groups, null), before.groups, "loslaten herstelt de volgorde");
  assert.deepEqual(puzzleRenderOrder(groups, "verdwenen-groep"), before.groups);
  assert.deepEqual(puzzleRenderOrder([], null), []);
  assert.deepEqual(snapshot, before, "renderprioriteit wijzigt geen spelstatus");
});
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

// --- Startcamera grote borden (fase 5B-1) ---------------------------------------------------------------
// Oorzaak van het lege startscherm: bij 150/300 stukken liggen de dichtstbijzijnde stukken verder weg dan een scherm op de
// oude startschaal toont. De matrix hieronder is dezelfde als de audit-probe (docs/puzzle-v2/audit-evidence).
const SCREENS: [string, number, number][] = [["320×568", 320, 568], ["360×740", 360, 740], ["390×844", 390, 844], ["740×360", 740, 360], ["768×1024", 768, 1024]];
// Conservatief (kop + terugbalk afgetrokken, zoals de probe) en zoals gemeten in de browser (balk ≈ 53 px).
const insets = [108, 53];

/** De oude startcamera, ter vergelijking: zodat kleinere puzzels aantoonbaar ongewijzigd blijven wanneer die al goed was. */
function legacyStartCamera(viewport: { width: number; height: number }, geometry: ReturnType<typeof createPuzzleGeometry>, snapshot: ReturnType<typeof newPuzzleSnapshot>) {
  const table = puzzleWorktable(geometry); const zone = { x: table.puzzle.x + table.puzzle.width / 2, y: table.puzzle.y + table.puzzle.height / 2 };
  const groups = snapshot.groups.map((group) => { const b = groupBounds(geometry, group); return { group, center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } }; });
  const d = (c: { x: number; y: number }) => Math.hypot(c.x - zone.x, c.y - zone.y);
  groups.sort((a, b) => b.group.pieceIds.length - a.group.pieceIds.length || d(a.center) - d(b.center) || a.group.id.localeCompare(b.group.id));
  const focus = groups[0]; const center = focus.group.pieceIds.length > 1 ? focus.center : { x: (focus.center.x + zone.x) / 2, y: (focus.center.y + zone.y) / 2 };
  const scale = Math.max(40, Math.min(160, Math.min(viewport.width, viewport.height) / 6));
  return constrainCamera({ scale, x: viewport.width / 2 - center.x * scale, y: viewport.height / 2 - center.y * scale }, viewport, table.bounds);
}
const onScreen = (camera: { scale: number; x: number; y: number }, viewport: { width: number; height: number }, point: { x: number; y: number }, margin: number) => { const x = camera.x + point.x * camera.scale, y = camera.y + point.y * camera.scale; return x >= margin && x <= viewport.width - margin && y >= margin && y <= viewport.height - margin; };

test("startcamera: bij elk getest scherm en elk aantal stukken zijn het puzzelmidden en minstens vier losse stukken zichtbaar", () => {
  let changed = 0; let unchanged = 0;
  for (const seed of ["audit-seed", "mobiel", "samen-1", "samen-2"]) for (const count of [24, 48, 96, 150, 300] as const) {
    const geometry = createPuzzleGeometry(count, seed, 2); const snapshot = newPuzzleSnapshot(geometry, "ADVENTURER"); const table = puzzleWorktable(geometry);
    const zone = { x: table.puzzle.x + table.puzzle.width / 2, y: table.puzzle.y + table.puzzle.height / 2 };
    for (const [label, width, height] of SCREENS) for (const inset of insets) {
      const viewport = { width, height: Math.max(200, height - inset) };
      const camera = initialPuzzleCamera(viewport, geometry, snapshot);
      const visible = snapshot.groups.filter((group) => { const b = groupBounds(geometry, group); return onScreen(camera, viewport, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, .35 * camera.scale); }).length;
      const where = `${label}/${viewport.height} ${count} stukken (${seed})`;
      assert.ok(visible >= 4, `${where}: ${visible} stukken zichtbaar`);
      assert.ok(onScreen(camera, viewport, zone, .5 * camera.scale), `${where}: puzzelmidden niet in beeld`);
      assert.ok(camera.scale >= 30, `${where}: schaal ${camera.scale.toFixed(1)} te klein (niet volledig uitgezoomd)`);
      assert.ok(camera.scale <= 160);
      // Reeds goede startbeelden van kleinere puzzels blijven exact zoals ze waren.
      const old = legacyStartCamera(viewport, geometry, snapshot);
      const oldVisible = snapshot.groups.filter((group) => { const b = groupBounds(geometry, group); return onScreen(old, viewport, { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }, .35 * old.scale); }).length;
      if (oldVisible >= 4 && onScreen(old, viewport, zone, .5 * old.scale)) { assert.deepEqual(camera, old, `${where}: een goed bestaand beeld blijft ongewijzigd`); unchanged++; } else changed++;
    }
  }
  assert.ok(unchanged > 0 && changed > 0, `gemengd resultaat verwacht (ongewijzigd ${unchanged}, verbeterd ${changed})`);
});

test("startcamera: een bord met voortgang opent op de samengestelde groep, ongewijzigd; pannen en zoomen blijven mogelijk", () => {
  const geometry = createPuzzleGeometry(300, "voortgang", 2); let snapshot = newPuzzleSnapshot(geometry, "ADVENTURER");
  for (const id of [0, 1]) snapshot = moveGroup(snapshot, geometry, `p${id}`, 4 + id, 4);
  snapshot = connectGroups(snapshot, geometry, "ADVENTURER", 0, 1);
  const viewport = { width: 768, height: 971 };
  assert.deepEqual(initialPuzzleCamera(viewport, geometry, snapshot), legacyStartCamera(viewport, geometry, snapshot));
  const table = puzzleWorktable(geometry); const camera = initialPuzzleCamera(viewport, geometry, newPuzzleSnapshot(geometry, "ADVENTURER"));
  const zoomedIn = zoomCamera(camera, viewport, table.bounds, 2, { x: 384, y: 485 }); const zoomedOut = zoomCamera(camera, viewport, table.bounds, .1, { x: 384, y: 485 });
  assert.ok(zoomedIn.scale > camera.scale && zoomedOut.scale >= 8, "zoom werkt vanaf de startstand");
  const resized = resizeCamera(camera, viewport, { width: 971, height: 768 }, table.bounds);
  assert.equal(resized.scale, camera.scale, "resize behoudt de zoom");
});

test("startcamera: deterministisch en zonder losse stukken geen crash", () => {
  const geometry = createPuzzleGeometry(24, "leeg", 2); const snapshot = newPuzzleSnapshot(geometry, "ADVENTURER");
  const viewport = { width: 390, height: 700 };
  assert.deepEqual(initialPuzzleCamera(viewport, geometry, snapshot), initialPuzzleCamera(viewport, geometry, structuredClone(snapshot)));
  const anchored = { ...snapshot, groups: snapshot.groups.map((group) => ({ ...group, anchored: true })) };
  assert.ok(Number.isFinite(initialPuzzleCamera(viewport, geometry, anchored).scale));
});
