import test from "node:test";
import assert from "node:assert/strict";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry";
import { moveGroup, newPuzzleSnapshot } from "../src/lib/puzzle/engine";
import { groupMemberAt } from "../src/lib/puzzle/worktable";
import { createPuzzleMotion, SETTLE_GLIDE_MS } from "../src/lib/puzzle/motion";
import { PARKING_DELAY_MS, createParking, type ParkingEnv, type ParkingReadiness } from "../src/lib/puzzle/parking";
import { createStacking } from "../src/lib/puzzle/stacking";
import { settleGroups } from "../src/lib/puzzle/collision";
import type { PuzzleGroup, PuzzleSnapshot } from "../src/lib/puzzle/types";

// De stapelvolgorde (tekenen en aanwijzen), de parkeertimer van 1,5 s en de schuifanimatie. Geen browser, wel de echte modules.

const geometry = createPuzzleGeometry(24, "parkeren");
const base = () => newPuzzleSnapshot(geometry, "DISCOVERER");
const put = (snap: PuzzleSnapshot, id: number, x: number, y: number) => moveGroup(snap, geometry, `p${id}`, x, y);
const ids = (groups: readonly PuzzleGroup[]) => groups.map((group) => group.id);

test("stapelvolgorde: de laatst opgepakte groep ligt bovenop en blijft er liggen na het loslaten", () => {
  const snap = put(put(base(), 0, 5, 5), 1, 5.3, 5.2); const stacking = createStacking();
  assert.equal(stacking.order(snap.groups), snap.groups, "zonder interactie: de opgeslagen volgorde, dezelfde instantie");
  stacking.raise("p0");
  assert.equal(ids(stacking.order(snap.groups)).at(-1), "p0");
  assert.equal(ids(stacking.order(snap.groups, "p1")).at(-1), "p1", "de gesleepte groep ligt tijdelijk boven alles");
  assert.equal(ids(stacking.order(snap.groups, "p1")).at(-2), "p0");
  assert.equal(ids(stacking.order(snap.groups)).at(-1), "p0", "na het loslaten blijft de laatst opgepakte bovenop");
  stacking.raise("p3"); stacking.raise("p0");
  assert.deepEqual(stacking.raised, ["p3", "p0"]);
  assert.equal(ids(stacking.order(snap.groups)).length, snap.groups.length, "geen groep dubbel of kwijt");
  assert.equal(new Set(ids(stacking.order(snap.groups, "p3"))).size, snap.groups.length);
});

test("aanwijzen volgt exact de zichtbare volgorde, ook direct na het loslaten", () => {
  const snap = put(put(base(), 0, 5, 5), 1, 5.3, 5.2); const stacking = createStacking();
  const pick = (point: { x: number; y: number }, dragged: string | null = null) => { for (const group of stacking.hitOrder(snap.groups, dragged)) { const id = groupMemberAt(geometry, group, point); if (id !== null) return id; } return null; };
  const spot = { x: 5.7, y: 5.6 }; // beide groepen liggen hier
  stacking.raise("p0"); assert.equal(pick(spot), 0, "p0 ligt bovenop en wordt gepakt");
  stacking.raise("p1"); assert.equal(pick(spot), 1, "direct na het loslaten van p1: p1 ligt bovenop");
  assert.deepEqual([...stacking.hitOrder(snap.groups)].reverse().map((g) => g.id), ids(stacking.order(snap.groups)), "hit-volgorde is exact het omgekeerde van de tekenvolgorde");
  stacking.raise("p0"); assert.equal(pick(spot), 0, "dezelfde groep is onmiddellijk opnieuw op te pakken");
  assert.equal(pick({ x: 5.05, y: 5.05 }), 0);
  assert.equal(pick({ x: 99, y: 99 }), null);
});

test("stapelvolgorde: een samengevoegde of verdwenen groep wordt vergeten en de lijst blijft begrensd", () => {
  const snap = base(); const stacking = createStacking();
  stacking.raise("p0"); stacking.raise("p1"); stacking.prune(snap.groups.filter((g) => g.id !== "p0"));
  assert.deepEqual(stacking.raised, ["p1"]);
  for (let i = 0; i < 200; i++) stacking.raise(`x${i}`);
  assert.ok(stacking.raised.length <= 64);
});

// --- parkeertimer -------------------------------------------------------------------------------------------------------------------

function fakeEnv() {
  let now = 0; let nextId = 1; const timers = new Map<number, { at: number; run: () => void }>(); let created = 0;
  const env: ParkingEnv = { setTimeout(run, ms) { const id = nextId++; created++; timers.set(id, { at: now + ms, run }); return id; }, clearTimeout(handle) { timers.delete(handle as number); } };
  const advance = (ms: number) => { const end = now + ms; for (;;) { const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; timers.delete(due[0]); due[1].run(); } now = end; };
  return { env, advance, get live() { return timers.size; }, get created() { return created; } };
}
function harness(initial: ParkingReadiness = "go") {
  const clock = fakeEnv(); const calls: string[][] = []; const stale: boolean[] = []; let state: ParkingReadiness = initial;
  const parking = createParking({ env: clock.env, ready: () => state, settle: (list, isStale) => { calls.push([...list]); stale.push(isStale()); } });
  return { clock, parking, calls, stale, set(next: ParkingReadiness) { state = next; } };
}

test("parkeren: 1500 ms na het loslaten mag er ruimte gemaakt worden, nieuwste groep eerst", () => {
  assert.equal(PARKING_DELAY_MS, 1500);
  const h = harness(); h.parking.park("p1"); h.clock.advance(1499); assert.deepEqual(h.calls, []);
  h.clock.advance(1); assert.deepEqual(h.calls, [["p1"]]); assert.equal(h.clock.live, 0);
  h.parking.park("p2"); h.clock.advance(600); h.parking.park("p3"); h.clock.advance(1500); assert.deepEqual(h.calls[1], ["p3", "p2"], "nieuwste eerst, één ronde");
});

test("parkeren: opnieuw oppakken binnen 1,5 s annuleert, en nooit meer dan één timer tegelijk", () => {
  const h = harness(); h.parking.park("p1"); h.clock.advance(1000); h.parking.unpark("p1"); assert.equal(h.clock.live, 0, "geen timer zonder geparkeerde groep"); h.clock.advance(5000); assert.deepEqual(h.calls, []);
  for (let i = 0; i < 50; i++) { h.parking.park(`p${i % 4}`); h.parking.interact(); assert.ok(h.clock.live <= 1, "timers hopen zich niet op"); }
  assert.equal(h.clock.live, 1);
});

test("parkeren: camerabeweging, zoom en een nieuwe sleep schuiven het opruimen een volle periode op", () => {
  const h = harness(); h.parking.park("p1");
  for (let i = 0; i < 6; i++) { h.clock.advance(1000); h.parking.interact(); } // een camerabeweging van 6 seconden (pan, pinch, zoom)
  assert.deepEqual(h.calls, [], "tijdens de camerabeweging nooit opruimen");
  h.clock.advance(1499); assert.deepEqual(h.calls, []); h.clock.advance(1); assert.deepEqual(h.calls, [["p1"]], "pas 1,5 s na de laatste interactie");
});

test("parkeren: het verlopen van de timer is geen toestemming: bezig = opnieuw kijken, voorbij = stoppen", () => {
  const h = harness("wait"); h.parking.park("p1"); h.clock.advance(1500); assert.deepEqual(h.calls, []); assert.equal(h.clock.live, 1, "opnieuw ingepland");
  h.clock.advance(1500); assert.deepEqual(h.calls, []);
  h.set("go"); h.clock.advance(1500); assert.deepEqual(h.calls, [["p1"]]);
  const done = harness("stop"); done.parking.park("p1"); done.clock.advance(1500); assert.deepEqual(done.calls, []); assert.equal(done.clock.live, 0, "sessie voorbij: geen timer meer"); assert.deepEqual(done.parking.parked, []);
});

test("parkeren: een lopende ronde ziet dat de speler weer iets doet (stale) en een dispose laat niets achter", () => {
  const clock = fakeEnv(); let stale: (() => boolean) | null = null;
  const parking = createParking({ env: clock.env, ready: () => "go", settle: (_ids, isStale) => { stale = isStale; } });
  parking.park("p1"); clock.advance(1500); assert.equal(stale!(), false);
  parking.interact(); assert.equal(stale!(), true, "nieuwe interactie: stop na de huidige stap");
  const other = harness(); other.parking.park("p1"); other.parking.dispose(); other.clock.advance(5000); assert.deepEqual(other.calls, []); assert.equal(other.clock.live, 0);
  other.parking.park("p2"); assert.equal(other.clock.live, 0, "na dispose nooit meer een timer (unmount)");
});

test("parkeren: een kapotte of afgewezen opruimronde laat niets hangen en gooit niet", () => {
  const clock = fakeEnv();
  const throwing = createParking({ env: clock.env, ready: () => "go", settle: () => { throw new Error("stuk"); } });
  throwing.park("p1"); assert.doesNotThrow(() => clock.advance(1500)); assert.equal(clock.live, 0);
  const rejecting = createParking({ env: clock.env, ready: () => "go", settle: () => Promise.reject(new Error("afgewezen")) });
  rejecting.park("p1"); assert.doesNotThrow(() => clock.advance(1500)); assert.equal(clock.live, 0);
});

test("parkeren: een stuk dat binnen de periode opnieuw wordt neergelegd, begint de periode opnieuw", () => {
  const h = harness(); h.parking.park("p1"); h.clock.advance(1200); h.parking.park("p1"); h.clock.advance(1499); assert.deepEqual(h.calls, []); h.clock.advance(1); assert.deepEqual(h.calls, [["p1"]]);
  assert.equal(h.parking.parked.length, 0);
});

// --- animatie -------------------------------------------------------------------------------------------------------------------

test("schuifanimatie: 180 ms, zachte ease-out, nooit voorbij het doel en alleen op de bevestigde nieuwe plek", () => {
  let before = put(put(base(), 0, 5, 5), 1, 5.3, 5.2);
  const after = settleGroups(before, geometry, { focusGroupId: "p1", difficulty: "DISCOVERER" });
  const moved = after.groups.find((g) => g.id === "p0")!; const from = before.groups.find((g) => g.id === "p0")!; assert.ok(moved.x !== from.x || moved.y !== from.y);
  const motion = createPuzzleMotion(geometry);
  motion.update({ snapshot: before, remote: new Map(), now: 0, wall: 0, enabled: true, maxDistance: .5 });
  assert.equal(motion.beginShift(before, after, 100), 1);
  assert.ok(SETTLE_GLIDE_MS >= 150 && SETTLE_GLIDE_MS <= 200);
  const shown = (t: number) => motion.groups(after.groups, t).find((g) => g.id === "p0")!;
  assert.deepEqual({ x: shown(100).x, y: shown(100).y }, { x: from.x, y: from.y }, "begint op de oude plek");
  const half = shown(100 + SETTLE_GLIDE_MS / 2); const dist = Math.hypot(moved.x - from.x, moved.y - from.y);
  assert.ok(Math.hypot(half.x - from.x, half.y - from.y) / dist > 0.5, "ease-out: meer dan de helft in de eerste helft");
  let last = 0; for (let t = 0; t <= SETTLE_GLIDE_MS; t += 10) { const at = shown(100 + t); const covered = Math.hypot(at.x - from.x, at.y - from.y) / dist; assert.ok(covered >= last - 1e-9 && covered <= 1 + 1e-9, "monotoon, geen stuiter"); last = covered; }
  assert.equal(motion.groups(after.groups, 100 + SETTLE_GLIDE_MS), after.groups, "na afloop de bevestigde stand");
  assert.equal(motion.beginShift(after, after, 400), 0, "geen verandering, geen animatie");
  assert.ok(!motion.groups(after.groups, 120).some((g) => g.id === "p1" && (g.x !== after.groups.find((x) => x.id === "p1")!.x)), "de focusgroep beweegt niet mee");
  before = after;
});

test("schuifanimatie: bij verminderde beweging wordt alles direct getoond", () => {
  const before = put(put(base(), 0, 5, 5), 1, 5.3, 5.2); const after = settleGroups(before, geometry, { focusGroupId: "p1", difficulty: "DISCOVERER" });
  const motion = createPuzzleMotion(geometry); motion.update({ snapshot: before, remote: new Map(), now: 0, wall: 0, enabled: true, maxDistance: .5 }); motion.beginShift(before, after, 10);
  motion.update({ snapshot: after, remote: new Map(), now: 20, wall: 20, enabled: false, maxDistance: .5 });
  assert.equal(motion.groups(after.groups, 25), after.groups, "enabled=false wist de glijbewegingen");
});

test("schuifanimatie: een nieuwe bevestigde stand tijdens het schuiven wint (geen sprong terug)", () => {
  const before = put(put(base(), 0, 5, 5), 1, 5.3, 5.2); const after = settleGroups(before, geometry, { focusGroupId: "p1", difficulty: "DISCOVERER" });
  const motion = createPuzzleMotion(geometry); motion.update({ snapshot: before, remote: new Map(), now: 0, wall: 0, enabled: true, maxDistance: .5 }); motion.beginShift(before, after, 10);
  const correction = put(after, 0, 8, 7); motion.update({ snapshot: correction, remote: new Map(), now: 50, wall: 50, enabled: true, maxDistance: .5 });
  assert.equal(motion.groups(correction.groups, 60), correction.groups, "een afwijkende bevestigde positie vervangt de animatie");
});
