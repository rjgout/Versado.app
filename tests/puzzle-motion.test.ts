import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry";
import { anchorGroup, boardPosition, connectGroups, moveGroup, newPuzzleSnapshot } from "../src/lib/puzzle/engine";
import { COMPLETION_HOLD_MS, COMPLETION_MAX_WAIT_MS, createCompletionGate, createPuzzleMotion, REMOTE_SETTLE_MS, SNAP_GLIDE_MS, type MotionUpdate, type RemoteEntry } from "../src/lib/puzzle/motion";
import type { PuzzleSnapshot } from "../src/lib/puzzle/types";

const geometry = createPuzzleGeometry(24, "beweging", 2);
const NONE = new Map<string, RemoteEntry>();
const base = (): PuzzleSnapshot => { let snapshot = newPuzzleSnapshot(geometry, "ADVENTURER"); snapshot = { ...snapshot, groups: snapshot.groups.map((group) => ({ ...group, rotation: 0 })) }; return snapshot; };
/** p0 vast op (5,5); stuk 1 ernaast, `error` units van zijn canonieke plek. */
const pair = (error = .2) => moveGroup(moveGroup(base(), geometry, "p0", 5, 5), geometry, "p1", 6 + error, 5);
const input = (snapshot: PuzzleSnapshot, now: number, extra: Partial<MotionUpdate> = {}): MotionUpdate => ({ snapshot, remote: NONE, now, wall: 1_000_000 + now, enabled: true, maxDistance: .46, ...extra });
const ids = (groups: readonly { pieceIds: number[] }[]) => groups.flatMap((group) => group.pieceIds).sort((a, b) => a - b);
const at = (groups: readonly { id: string; pieceIds: number[]; x: number; y: number }[], piece: number) => groups.find((group) => group.pieceIds.includes(piece))!;

test("beweging: een bevestigde verbinding glijdt in de ingestelde duur met ease-out naar de definitieve plek", () => {
  const before = pair(.2); const after = connectGroups(before, geometry, "ADVENTURER", 0, 1); assert.equal(after.groups.length, before.groups.length - 1);
  const motion = createPuzzleMotion(geometry); motion.update(input(before, 0)); motion.update(input(after, 100));
  assert.equal(motion.glideCount, 1); assert.equal(motion.active(100), true);
  const final = at(after.groups, 1); const mover = (time: number) => at(motion.groups(after.groups, time), 1);
  const start = mover(100); assert.ok(Math.abs(start.x - 6.2) < 1e-9, "begint op de weergegeven plek vóór de bevestiging");
  const half = mover(100 + SNAP_GLIDE_MS / 2); const covered = (half.x - 6.2) / (6 - 6.2); assert.ok(covered > .5 && covered < 1, `ease-out: de eerste helft legt meer dan de helft af (${covered.toFixed(2)})`);
  let previous = start.x; for (let step = 1; step <= 13; step++) { const x = mover(100 + step * 10).x; assert.ok(x <= previous + 1e-12 && x >= 6 - 1e-9, "monotoon en nooit voorbij het doel"); previous = x; }
  assert.equal(motion.groups(after.groups, 100 + SNAP_GLIDE_MS), after.groups, "na afloop dezelfde lijst: de bevestigde stand"); assert.equal(motion.active(100 + SNAP_GLIDE_MS), false);
  assert.ok(SNAP_GLIDE_MS >= 120 && SNAP_GLIDE_MS <= 180); assert.ok(final);
});

test("beweging: geen spookgroepen en geen dubbele stukken tijdens de glijbeweging", () => {
  const before = pair(.25); const after = connectGroups(before, geometry, "ADVENTURER", 0, 1); const motion = createPuzzleMotion(geometry); motion.update(input(before, 0)); motion.update(input(after, 50));
  for (const time of [50, 70, 100, 150, 189, 190, 400]) { const shown = motion.groups(after.groups, time); assert.deepEqual(ids(shown), ids(after.groups), `t=${time}`); assert.equal(new Set(shown.map((group) => group.id)).size, shown.length); }
});

test("beweging: een afgewezen of ongewijzigde actie geeft nooit een animatie", () => {
  const before = pair(.2); const motion = createPuzzleMotion(geometry); motion.update(input(before, 0));
  const rejected = connectGroups(pair(.5), geometry, "ADVENTURER", 0, 1); assert.equal(rejected.groups.length, before.groups.length, "de engine wijst de verbinding af");
  motion.update(input({ ...before, groups: before.groups.slice() }, 20)); motion.update(input(rejected, 40));
  assert.equal(motion.glideCount, 0); assert.equal(motion.active(40), false);
  const dropped = moveGroup(before, geometry, "p1", 9, 9); motion.update(input(dropped, 60)); assert.equal(motion.glideCount, 0, "een gewone verplaatsing glijdt niet");
});

test("beweging: bordplaatsing glijdt naar de bordpositie en een verankerde groep komt er precies te staan", () => {
  const before = base(); const board = boardPosition(geometry, before.groups[7]); const near = moveGroup(before, geometry, "p7", board.x + .2, board.y - .15);
  const after = anchorGroup(near, geometry, "ADVENTURER", "p7"); assert.equal(after.groups.find((group) => group.id === "p7")!.anchored, true);
  const motion = createPuzzleMotion(geometry); motion.update(input(near, 0)); motion.update(input(after, 10)); assert.equal(motion.glideCount, 1);
  const during = motion.groups(after.groups, 10 + SNAP_GLIDE_MS / 2).find((group) => group.id === "p7")!; assert.ok(Math.abs(during.x - board.x) > 0 && Math.abs(during.x - (board.x + .2)) > 0);
  assert.equal(motion.groups(after.groups, 10 + SNAP_GLIDE_MS + 1).find((group) => group.id === "p7")!.x, board.x);
});

test("beweging: meerdere opeenvolgende verbindingen nemen elkaar over zonder sprong", () => {
  let before = base(); before = moveGroup(moveGroup(moveGroup(before, geometry, "p0", 5, 5), geometry, "p1", 6.2, 5.1), geometry, "p2", 7.15, 5);
  const first = connectGroups(before, geometry, "ADVENTURER", 0, 1); const second = connectGroups(first, geometry, "ADVENTURER", 1, 2);
  assert.equal(second.groups.length, before.groups.length - 2);
  const motion = createPuzzleMotion(geometry); motion.update(input(before, 0)); motion.update(input(first, 100)); const mid = at(motion.groups(first.groups, 150), 1);
  motion.update(input(second, 150)); const next = at(motion.groups(second.groups, 150), 1);
  assert.ok(Math.abs(next.x - mid.x) < 1e-9 && Math.abs(next.y - mid.y) < 1e-9, "de lopende glijbeweging gaat zonder sprong op in de nieuwe");
  assert.equal(motion.glideCount, 1, "één bewegingslaag per doelgroep, geen dubbele animatie");
  for (const time of [150, 200, 250, 300]) assert.deepEqual(ids(motion.groups(second.groups, time)), ids(second.groups));
  assert.equal(motion.groups(second.groups, 150 + SNAP_GLIDE_MS + 1), second.groups);
});

test("beweging: twee groepen die samenkomen: beide delen blijven netjes tot de bevestigde stand", () => {
  let before = base(); before = moveGroup(moveGroup(moveGroup(before, geometry, "p0", 5, 5), geometry, "p1", 6, 5), geometry, "p2", 7.2, 5.1);
  before = connectGroups(before, geometry, "ADVENTURER", 0, 1); const after = connectGroups(before, geometry, "ADVENTURER", 1, 2);
  const motion = createPuzzleMotion(geometry); motion.update(input(before, 0)); motion.update(input(after, 10)); const shown = motion.groups(after.groups, 60);
  assert.deepEqual(ids(shown), ids(after.groups)); assert.equal(shown.length, after.groups.length + 1, "de groep van twee en het losse stuk worden apart getekend tijdens de beweging");
});

test("beweging: servercorrectie of een nieuwe stand voor dezelfde groep heeft voorrang op een lopende animatie", () => {
  const before = pair(.2); const after = connectGroups(before, geometry, "ADVENTURER", 0, 1); const motion = createPuzzleMotion(geometry); motion.update(input(before, 0)); motion.update(input(after, 100)); assert.equal(motion.glideCount, 1);
  const corrected = { ...after, groups: after.groups.map((group) => group.pieceIds.includes(0) ? { ...group, x: group.x + 3, y: group.y + 2 } : group) };
  motion.update(input(corrected, 120)); assert.equal(motion.glideCount, 0, "de bevestigde stand wint direct"); assert.equal(motion.groups(corrected.groups, 120), corrected.groups);
});

test("beweging: een sprong groter dan een snap kan afleggen (herverbinding, resync) animeert niet", () => {
  const before = pair(.2); const after = connectGroups(before, geometry, "ADVENTURER", 0, 1);
  const far = moveGroup(before, geometry, "p1", 9, 9); const motion = createPuzzleMotion(geometry); motion.update(input(far, 0));
  motion.update(input(after, 50)); assert.equal(motion.glideCount, 0, "van veraf naar de verbinding: dat was geen snap");
  const small = createPuzzleMotion(geometry); small.update(input(before, 0)); small.update(input(after, 10, { maxDistance: .1 })); assert.equal(small.glideCount, 0);
});

test("beweging: alleen bevestigde snaps glijden; glide=false (gewone stand van Solo) en uitgeschakeld (reduced motion, voltooid) tonen direct", () => {
  const before = pair(.2); const after = connectGroups(before, geometry, "ADVENTURER", 0, 1);
  const quiet = createPuzzleMotion(geometry); quiet.update(input(before, 0)); quiet.update(input(after, 10, { glide: false })); assert.equal(quiet.glideCount, 0);
  const off = createPuzzleMotion(geometry); off.update(input(before, 0, { enabled: false })); off.update(input(after, 10, { enabled: false })); assert.equal(off.glideCount, 0); assert.equal(off.groups(after.groups, 20), after.groups); assert.equal(off.active(20), false);
  const remote = new Map([["p3", { x: 1, y: 1, until: 1_000_000 + 700 }]]); off.update(input(after, 30, { enabled: false, remote })); assert.equal(off.followCount, 0, "reduced motion: geen interpolatie");
});

test("beweging: unmount, nieuwe puzzel en herstart (clear) laten niets achter", () => {
  const before = pair(.2); const after = connectGroups(before, geometry, "ADVENTURER", 0, 1); const motion = createPuzzleMotion(geometry);
  motion.update(input(before, 0)); motion.update(input(after, 10, { remote: new Map([["p4", { x: 2, y: 2, until: 1_000_700 }]]) })); assert.ok(motion.glideCount + motion.followCount > 0);
  motion.clear(); assert.equal(motion.glideCount, 0); assert.equal(motion.followCount, 0); assert.equal(motion.active(20), false); assert.equal(motion.groups(after.groups, 20), after.groups);
});

test("remote beweging: volgt tussen ontvangen punten, nooit voorbij het laatste punt (geen extrapolatie of rubberband)", () => {
  const snapshot = base(); const start = at(snapshot.groups, 5); const motion = createPuzzleMotion(geometry); const spot = { x: 0, y: 0 };
  let wall = 1_000_000; const entries = (x: number, y: number) => new Map([["p5", { x, y, until: wall + 700 }]]);
  motion.update(input(snapshot, 0, { wall, remote: entries(start.x + 1, start.y) }));
  let previous = start.x; const trail: number[] = [];
  for (let time = 0; time <= 300; time += 10) {
    wall = 1_000_000 + time; const target = start.x + 1 + Math.floor(time / 80) * .5;
    motion.update(input(snapshot, time, { wall, remote: entries(target, start.y) })); const place = motion.remoteAt("p5", time, spot)!; assert.ok(place, "gevolgd");
    assert.ok(place.x <= target + 1e-9, `nooit voorbij het ontvangen punt (${place.x} > ${target})`); assert.ok(place.x >= start.x - 1e-9); assert.ok(place.x >= previous - 1e-9, "geen terugspringen bij nieuwe punten"); previous = place.x; trail.push(place.x);
  }
  const jumps = trail.slice(1).map((x, index) => x - trail[index]); assert.ok(Math.max(...jumps) < .35, `geen zichtbare sprongen (${Math.max(...jumps).toFixed(2)})`);
  assert.ok(trail.filter((x, index) => index && x !== trail[index - 1]).length > 20, "bijna elk frame beweegt: ook tussen de ontvangen punten");
});

test("remote beweging: uitblijvende updates keren veilig terug naar de bevestigde stand; daarna geen frames meer", () => {
  const snapshot = base(); const home = at(snapshot.groups, 5); const motion = createPuzzleMotion(geometry); const spot = { x: 0, y: 0 };
  const remote = new Map([["p5", { x: home.x + 2, y: home.y + 1, until: 1_000_000 + 700 }]]);
  motion.update(input(snapshot, 0, { wall: 1_000_000, remote })); motion.update(input(snapshot, 200, { wall: 1_000_200, remote })); assert.ok(Math.abs(motion.remoteAt("p5", 200, spot)!.x - (home.x + 2)) < 1e-9, "wacht op het laatste punt");
  assert.equal(motion.active(300), true, "tot het verlopen van de ontvangen informatie");
  motion.update(input(snapshot, 800, { wall: 1_000_800, remote })); assert.equal(motion.followCount, 1, "verlopen: kort terug");
  motion.update(input(snapshot, 800 + REMOTE_SETTLE_MS / 2, { wall: 1_000_860, remote })); const mid = motion.remoteAt("p5", 800 + REMOTE_SETTLE_MS / 2, spot)!; assert.ok(mid.x < home.x + 2 && mid.x > home.x);
  motion.update(input(snapshot, 800 + REMOTE_SETTLE_MS + 5, { wall: 1_000_925, remote })); assert.equal(motion.followCount, 0, "verlopen item maakt geen nieuwe beweging"); assert.equal(motion.active(1000), false);
  assert.equal(motion.remoteAt("p5", 1000, spot), null);
});

test("remote beweging: een bevestigde plaatsing of samenvoeging volgt op de sleepbeweging zonder sprong", () => {
  const before = pair(.2); const motion = createPuzzleMotion(geometry); const spot = { x: 0, y: 0 };
  const remote = new Map([["p1", { x: 6.28, y: 5.04, until: 1_000_700 }]]);
  motion.update(input(before, 0, { wall: 1_000_000, remote })); motion.update(input(before, 80, { wall: 1_000_080, remote })); const shown = { ...motion.remoteAt("p1", 80, spot)! };
  const after = connectGroups(before, geometry, "ADVENTURER", 0, 1);
  // Het delta-bericht verwijdert het sleepitem en voegt de groepen samen: de glijbeweging begint op de weergegeven remote plek.
  motion.update(input(after, 90, { wall: 1_000_090, remote: NONE })); const mover = at(motion.groups(after.groups, 90), 1);
  assert.ok(Math.abs(mover.x - shown.x) < .05 && Math.abs(mover.y - shown.y) < .05, `start bij de weergegeven plek (${mover.x} ≈ ${shown.x})`);
  assert.equal(motion.followCount, 0, "de gevolgde groep bestaat niet meer: geen spookvolger");
  assert.deepEqual(ids(motion.groups(after.groups, 100)), ids(after.groups));
});

test("remote beweging: een gewone bevestigde plaatsing laat de weergave zacht naar de bevestigde positie lopen", () => {
  const before = base(); const motion = createPuzzleMotion(geometry); const spot = { x: 0, y: 0 }; const group = at(before.groups, 5);
  const remote = new Map([["p5", { x: group.x + 1, y: group.y, until: 1_000_700 }]]); motion.update(input(before, 0, { wall: 1_000_000, remote })); motion.update(input(before, 120, { wall: 1_000_120, remote }));
  const confirmed = moveGroup(before, geometry, "p5", group.x + 1.02, group.y); motion.update(input(confirmed, 130, { wall: 1_000_130, remote: NONE }));
  const early = motion.remoteAt("p5", 140, spot)!; assert.ok(Math.abs(early.x - (group.x + 1)) < .05, "geen sprong bij de overgang");
  motion.update(input(confirmed, 140 + REMOTE_SETTLE_MS + 10, { wall: 1_000_270, remote: NONE })); assert.equal(motion.followCount, 0); assert.equal(motion.active(400), false);
});

test("beweging: er is geen permanente lus; zonder lopende beweging is er geen frame nodig", () => {
  const motion = createPuzzleMotion(geometry); motion.update(input(base(), 0)); assert.equal(motion.active(0), false);
  const before = pair(.2); const after = connectGroups(before, geometry, "ADVENTURER", 0, 1); motion.update(input(before, 10)); motion.update(input(after, 20));
  assert.equal(motion.active(20), true); assert.equal(motion.active(20 + SNAP_GLIDE_MS), false);
});

test("beweging: de bevestigde stand wordt nooit gewijzigd en de module doet geen netwerk of React", () => {
  const before = pair(.2); const after = connectGroups(before, geometry, "ADVENTURER", 0, 1); Object.freeze(after.groups); for (const group of after.groups) Object.freeze(group); const frozen = JSON.stringify(after);
  const motion = createPuzzleMotion(geometry); motion.update(input(before, 0)); motion.update(input(after, 10)); motion.groups(after.groups, 40); assert.equal(JSON.stringify(after), frozen);
  const source = readFileSync(new URL("../src/lib/puzzle/motion.ts", import.meta.url), "utf8"); assert.doesNotMatch(source, /\bfetch\s*\(|socket|XMLHttpRequest|sendBeacon|prisma|from "react"|next\/|requestAnimationFrame|setTimeout|setInterval/i, "geen netwerk, geen eigen lus of timers");
});

// --- Voltooiingsvolgorde: de laatste snap eerst, daarna de kaart ---------------------------------------------------------
test("voltooien: de kaart wacht op de laatste snap plus korte rust, en komt dan precies één keer", () => {
  const gate = createCompletionGate(); let shown = 0; gate.request(() => { shown++; }, 0);
  gate.tick({ now: 10, complete: true, animating: true, reduced: false }); assert.equal(shown, 0, "tijdens de glijbeweging nog geen kaart"); assert.equal(gate.waiting, true);
  gate.tick({ now: 10 + SNAP_GLIDE_MS - 1, complete: true, animating: true, reduced: false }); assert.equal(shown, 0);
  gate.tick({ now: 10 + SNAP_GLIDE_MS, complete: true, animating: false, reduced: false }); assert.equal(shown, 0, "de rustpauze begint na de glijbeweging");
  gate.tick({ now: 10 + SNAP_GLIDE_MS + COMPLETION_HOLD_MS - 1, complete: true, animating: false, reduced: false }); assert.equal(shown, 0);
  gate.tick({ now: 10 + SNAP_GLIDE_MS + COMPLETION_HOLD_MS, complete: true, animating: false, reduced: false }); assert.equal(shown, 1, "daarna de kaart");
  for (let now = 400; now < 900; now += 50) gate.tick({ now, complete: true, animating: false, reduced: false }); assert.equal(shown, 1, "nooit een tweede kaart"); assert.equal(gate.waiting, false);
  assert.ok(SNAP_GLIDE_MS + COMPLETION_HOLD_MS <= 300, "totale vertraging beperkt (glijbeweging + rust)");
});

test("voltooien: reduced motion en een stand zonder snapbeweging (herverbinden) tonen de kaart direct", () => {
  const reduced = createCompletionGate(); let a = 0; reduced.request(() => { a++; }, 0); reduced.tick({ now: 1, complete: false, animating: false, reduced: true }); assert.equal(a, 1, "geen verplichte wachttijd, ook niet voor de eindstand");
  const reconnect = createCompletionGate(); let b = 0; reconnect.request(() => { b++; }, 0); reconnect.tick({ now: 1, complete: true, animating: false, reduced: false }); assert.equal(b, 1, "geen glijbeweging (resync): direct");
});

test("voltooien: wacht op de bevestigde eindstand, maar nooit langer dan de bovengrens", () => {
  const gate = createCompletionGate(); let shown = 0; gate.request(() => { shown++; }, 0);
  gate.tick({ now: 100, complete: false, animating: false, reduced: false }); assert.equal(shown, 0, "de eindstand is nog niet binnen");
  gate.tick({ now: 300, complete: false, animating: false, reduced: false }); assert.equal(shown, 0);
  gate.tick({ now: COMPLETION_MAX_WAIT_MS, complete: false, animating: false, reduced: false }); assert.equal(shown, 1, "de bovengrens voorkomt een kaart die nooit komt");
  const stuck = createCompletionGate(); let late = 0; stuck.request(() => { late++; }, 0); stuck.tick({ now: 10, complete: true, animating: true, reduced: false }); stuck.tick({ now: COMPLETION_MAX_WAIT_MS + 1, complete: true, animating: true, reduced: false }); assert.equal(late, 1, "ook een hangende animatie houdt de kaart niet tegen");
});

test("voltooien: dubbele aanvragen, herhaalde serverupdates en annuleren (unmount, navigatie) geven nooit een tweede of verlate kaart", () => {
  const gate = createCompletionGate(); let shown = 0; const card = () => { shown++; };
  gate.request(card, 0); gate.request(card, 5); gate.request(card, 9); gate.tick({ now: 20, complete: true, animating: false, reduced: false }); assert.equal(shown, 1, "meerdere aanvragen: één kaart");
  const cancelled = createCompletionGate(); let late = 0; cancelled.request(() => { late++; }, 0); cancelled.tick({ now: 10, complete: true, animating: true, reduced: false }); cancelled.cancel();
  for (let now = 20; now < 1500; now += 20) cancelled.tick({ now, complete: true, animating: false, reduced: false }); assert.equal(late, 0, "na annuleren komt er geen kaart meer"); assert.equal(cancelled.waiting, false);
  gate.tick({ now: 2000, complete: true, animating: false, reduced: false }); assert.equal(shown, 1, "zonder aanvraag doet tikken niets");
});

test("voltooien: de bewegingslaag laat de laatste snap als glijbeweging zien, ook als de nieuwe stand voltooid is", () => {
  const before = pair(.2); const done = { ...connectGroups(before, geometry, "ADVENTURER", 0, 1), completedAt: new Date().toISOString() };
  const motion = createPuzzleMotion(geometry); motion.update(input(before, 0)); motion.update(input(done, 20)); assert.equal(motion.gliding(20), true); assert.equal(motion.gliding(20 + SNAP_GLIDE_MS), false);
  assert.deepEqual(ids(motion.groups(done.groups, 60)), ids(done.groups));
});
