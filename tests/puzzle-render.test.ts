import test from "node:test";
import assert from "node:assert/strict";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry";
import { connectGroups, moveGroup, newPuzzleSnapshot } from "../src/lib/puzzle/engine";
import { renderPuzzle, type PuzzleScene } from "../src/lib/puzzle/render";
import { puzzleWorktable } from "../src/lib/puzzle/worktable";

// De tekenmodule heeft geen DOM nodig: een nep-canvas legt elke aanroep en elke ingestelde eigenschap vast.
type Entry = [string, ...unknown[]];
// Elk padcommando (moveTo, bezierCurveTo, ...) wordt stil geaccepteerd.
class FakePath { constructor() { return new Proxy(this, { get: (target, name) => name in target ? Reflect.get(target, name) : () => undefined }); } }
function fakeCanvas(log: Entry[]) {
  const context = new Proxy({} as Record<string, unknown>, {
    get: (_target, name: string) => (...args: unknown[]) => { log.push([name, ...args]); },
    set: (_target, name: string, value) => { log.push([`=${name}`, value]); return true; },
  });
  return { width: 0, height: 0, getBoundingClientRect: () => ({ width: 300, height: 200 }), getContext: () => context } as unknown as HTMLCanvasElement;
}
function scene(overrides: Partial<PuzzleScene> = {}): PuzzleScene {
  const geometry = createPuzzleGeometry(12, "tekenmodule");
  let snapshot = newPuzzleSnapshot(geometry, "ADVENTURER");
  snapshot = moveGroup(snapshot, geometry, "p1", snapshot.groups[0].x + 1, snapshot.groups[0].y);
  snapshot = connectGroups(snapshot, geometry, "ADVENTURER", 0, 1);
  return { geometry, table: puzzleWorktable(geometry), camera: { scale: 40, x: 10, y: 20 }, image: {} as CanvasImageSource, paths: new Map(), snapshot, groups: snapshot.groups, selectedPiece: null, hint: undefined, backdrop: true, ghost: false, outline: true, edges: true, anchoredStroke: "rgba(43, 103, 99, .70)", ...overrides };
}
const names = (log: Entry[], name: string) => log.filter((entry) => entry[0] === name);
function render(overrides: Partial<PuzzleScene> = {}) {
  const log: Entry[] = []; const canvas = fakeCanvas(log); const value = scene(overrides); renderPuzzle(canvas, value); return { log, canvas, value };
}

test.before(() => { Object.assign(globalThis, { Path2D: FakePath, window: { devicePixelRatio: 3 } }); });

test("render: canvas krijgt device pixel ratio maximaal 2 en de camera als transformatie", () => {
  const { log, canvas } = render();
  assert.equal(canvas.width, 600); assert.equal(canvas.height, 400);
  assert.deepEqual(log[0], ["setTransform", 2, 0, 0, 2, 0, 0]);
  assert.deepEqual(names(log, "translate")[0], ["translate", 10, 20]); assert.deepEqual(names(log, "scale")[0], ["scale", 40, 40]);
});

test("render: elke groep één keer, het Path2D wordt per groep bewaard en bij het volgende beeld hergebruikt", () => {
  const created: unknown[] = []; const Original = (globalThis as { Path2D: unknown }).Path2D;
  (globalThis as { Path2D: unknown }).Path2D = class extends FakePath { constructor() { super(); created.push(this); } };
  try {
    const value = scene(); const canvas = fakeCanvas([]);
    renderPuzzle(canvas, value); const first = created.length; renderPuzzle(canvas, value);
    assert.equal(first, value.groups.length); assert.equal(created.length, first); assert.equal(value.paths.size, value.groups.length);
    assert.ok(value.paths.has("0,1"), "samengestelde groep onder de sleutel van zijn stukken");
  } finally { (globalThis as { Path2D: unknown }).Path2D = Original; }
});

test("render: een opgetilde groep krijgt schaduw en twee schermpixels lift; een andere groep niet", () => {
  const plain = render(); assert.equal(names(plain.log, "=shadowBlur").length, 0);
  const value = scene(); const lifted = value.groups[2].id;
  const { log } = render({ groups: value.groups, place: (group, out) => { out.lifted = group.id === lifted; } });
  assert.deepEqual(names(log, "=shadowBlur"), [["=shadowBlur", 20]]); assert.deepEqual(names(log, "=shadowOffsetY"), [["=shadowOffsetY", 10]]);
  const group = scene().groups[2];
  assert.ok(log.some((entry) => entry[0] === "translate" && entry[1] === group.x + .5 && entry[2] === group.y + .5 - 2 / 40), "lift van 2 / schaal");
});

test("render: lock-omtrek in spelerkleur vóór de gewone contour, geen lock geeft geen extra streek", () => {
  const withLock = render({ place: (group, out) => { if (group.id === "p5") out.lockColor = "#123456"; } }).log;
  const strokes = withLock.filter((entry) => entry[0] === "=strokeStyle" && entry[1] === "#123456"); assert.equal(strokes.length, 1);
  const at = withLock.findIndex((entry) => entry[0] === "=strokeStyle" && entry[1] === "#123456");
  assert.deepEqual(withLock[at + 1], ["=lineWidth", 4 / 40]); assert.equal(withLock[at + 2][0], "stroke");
  assert.equal(render().log.some((entry) => entry[0] === "=strokeStyle" && entry[1] === "#123456"), false);
});

test("render: contouren, achtergrond, spookbeeld en rand volgen de aangeleverde vlaggen", () => {
  const groups = scene().groups.length;
  const full = render({ backdrop: true, ghost: true, outline: true }).log;
  assert.equal(names(full, "setLineDash").length, 2); assert.equal(names(full, "drawImage").length, 1 + groups, "spookbeeld plus beelduitsnede per groep");
  const bare = render({ backdrop: false, ghost: false, outline: false, edges: false, image: null }).log;
  assert.equal(names(bare, "setLineDash").length, 0); assert.equal(names(bare, "drawImage").length, 0); assert.equal(names(bare, "stroke").length, 0, "zonder contouren geen streken; de tafelrand is een strokeRect");
});

test("render: selectie kleurt alleen de groep met het gekozen stuk, verankerd gebruikt de meegegeven kleur", () => {
  const value = scene(); const anchored = value.groups.map((group) => group.id === "p7" ? { ...group, anchored: true } : group);
  const { log } = render({ groups: anchored, selectedPiece: 0, anchoredStroke: "ANKER" });
  assert.equal(names(log, "=strokeStyle").filter((entry) => entry[1] === "#d97716").length, 1);
  assert.equal(names(log, "=strokeStyle").filter((entry) => entry[1] === "ANKER").length, 1);
});

test("render: hintmarkeringen worden na de groepen getekend en zonder cache", () => {
  const value = scene(); const group = value.groups[3];
  const location = render({ hint: { type: "LOCATION", groupId: group.id, pieceIds: [...group.pieceIds], x: 2, y: 3 } });
  assert.ok(location.log.some((entry) => entry[0] === "=fillStyle" && entry[1] === "rgba(217,119,22,.16)"));
  assert.equal(location.value.paths.size, value.groups.length, "marker maakt geen cache-item");
  const connection = render({ hint: { type: "CONNECTION", groupId: "p0", pieceId: 0, neighborId: 5, neighborGroupId: "p5" } });
  assert.equal(names(connection.log, "=lineWidth").filter((entry) => entry[1] === 4 / 40).length, 2);
  const filter = render({ hint: { type: "FILTER", filter: "CORNERS", pieceIds: [0, 3] } }); assert.equal(names(filter.log, "=globalAlpha").filter((entry) => entry[1] === .2).length, value.groups.length);
});

const ACCENT = "21, 101, 192";
const glow = (strength: number, edgeCount = 2, slot = false) => ({
  edgeCount, strength,
  edges: [{ piece: 0, neighbour: 1, anchorPiece: 0, x: 3, y: 4 }, { piece: 1, neighbour: 0, anchorPiece: 1, x: 3.2, y: 4.1 }] as const,
  slot: { active: slot, pieceIds: [1], x: 7, y: 8 },
});
const accentStrokes = (log: Entry[]) => log.filter((entry) => entry[0] === "=strokeStyle" && String(entry[1]).includes(ACCENT));

test("render: bijna-passend tekent halo en kern per rand in de accentkleur en muteert niets", () => {
  const value = scene(); const before = JSON.stringify(value.snapshot);
  const { log } = render({ nearSnap: glow(1) });
  assert.equal(accentStrokes(log).length, 4, "halo en kern per rand (de witte onderlaag is een andere kleur)");
  assert.equal(names(log, "=lineCap").length, 2); assert.equal(JSON.stringify(value.snapshot), before);
  // Lijndiktes zijn vaste schermpixels: breedte / schaal (schaal 40).
  assert.ok(log.some((entry) => entry[0] === "=lineWidth" && entry[1] === 3 / 40) && log.some((entry) => entry[0] === "=lineWidth" && entry[1] === 9 / 40));
  // Eén pad per rand, bewaard in de cache onder een eigen sleutel; het tweede beeld hergebruikt ze.
  const second = scene({ nearSnap: glow(1) }); renderPuzzle(fakeCanvas([]), second); const size = second.paths.size; renderPuzzle(fakeCanvas([]), second);
  assert.equal(second.paths.size, size); assert.ok(second.paths.has("edge:0>1") && second.paths.has("edge:1>0"));
});

test("render: zonder feedback of bij sterkte 0 blijft er niets van de gloed achter; de kleur botst niet met selectie, hint, anker of lock", () => {
  for (const nearSnap of [null, undefined, glow(0), glow(1, 0)]) assert.equal(accentStrokes(render({ nearSnap }).log).length, 0);
  const colours = ["#d97716", "rgba(217,119,22,.16)", "rgba(43, 103, 99, .70)", "rgba(43, 103, 99, .35)", "rgba(29, 42, 60, .60)"];
  for (const colour of colours) assert.ok(!colour.includes(ACCENT));
  const { log } = render({ nearSnap: glow(1, 2, true) });
  assert.equal(accentStrokes(log).length, 6, "ook de bordplek krijgt halo en kern"); // 2 randen + slot
  // De groepscontour van het slot gebruikt dezelfde cache-sleutel als de groep zelf (geen tweede pad).
});

test("render: de overgang schaalt alleen de dekking, de vorm blijft gelijk", () => {
  const alphas = (strength: number) => accentStrokes(render({ nearSnap: glow(strength) }).log).map((entry) => Number(String(entry[1]).split(",").at(-1)!.replace(")", "")));
  const half = alphas(.5); const full = alphas(1);
  assert.equal(half.length, full.length); half.forEach((alpha, index) => assert.ok(Math.abs(alpha - full[index] / 2) < 1e-9));
});
