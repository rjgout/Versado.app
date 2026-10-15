import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { addDays } from "../src/lib/dates";
import { dayKeyInZone } from "../src/lib/timeZone";

// Ruimte maken (settle) op de server: Solo, Samen en Tegen elkaar. Alleen met de eigen puzzeltestdatabase (test:puzzle:integration).
const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url && (new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/versado_puzzle_test")) throw new Error("Deze tests vereisen de lokale wegwerpdatabase van test:puzzle:integration");
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
const skip = !url && "Gebruik npm run test:puzzle:integration voor de geïsoleerde database";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  solo: await import("../src/lib/puzzle/solo"),
  coop: await import("../src/lib/puzzle/coop"),
  match: await import("../src/lib/puzzle/match"),
  geometry: await import("../src/lib/puzzle/geometryCache"),
  collision: await import("../src/lib/puzzle/collision"),
  engine: await import("../src/lib/puzzle/engine"),
  delta: await import("../src/lib/puzzle/delta"),
  errors: await import("../src/lib/puzzle/errors"),
});
let L: Awaited<ReturnType<typeof load>>;
const ids: string[] = [];
before(async () => { if (skip) return; L = await load(); await L.db.puzzleSession.count(); });
after(async () => { if (skip) return; await L.db.user.deleteMany({ where: { id: { in: ids } } }); await L.db.$disconnect(); });

async function person() {
  const user = await L.db.user.create({ data: {
    email: `settle-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Se${randomUUID().slice(0, 8)}`, discriminator: "00", timeZone: "Europe/Amsterdam",
    currentStreak: 3, longestStreak: 3, lastStudyDate: addDays(dayKeyInZone(new Date(), "Europe/Amsterdam"), -1), lastStudyTimeZone: "Europe/Amsterdam",
  } });
  ids.push(user.id); return user;
}
async function befriend(a: string, b: string) { await L.db.friendship.create({ data: { senderId: a, receiverId: b, status: "ACCEPTED" } }); }
const get = (id: string) => L.db.user.findUniqueOrThrow({ where: { id } });

// ---------------- Solo ----------------
type Solo = NonNullable<Awaited<ReturnType<typeof L.solo.resumeSoloPuzzle>>>;
async function soloAct(userId: string, state: Solo, operation: Parameters<typeof L.solo.applySoloAction>[4], actionId = randomUUID()) {
  const next = await L.solo.applySoloAction(userId, state.id, state.version, actionId, operation, "nl");
  assert.ok(next); return next as Solo;
}
const groupOf = (state: { snapshot: { groups: Array<{ id: string; x: number; y: number; anchored?: boolean; pieceIds: number[] }> } }, id: string) => state.snapshot.groups.find((g) => g.id === id)!;

test("Solo: een overlappende groep schuift uit, de laatst neergelegde blijft, en niets anders verandert", { skip }, async () => {
  const u = await person();
  let state = await L.solo.startSoloPuzzle(u.id, 0, 6, "ADVENTURER", "nl") as Solo;
  const geometry = L.geometry.cachedPuzzleGeometry(6, state.seed, state.geometryVersion);
  state = await soloAct(u.id, state, { kind: "move", groupId: "p0", x: 5, y: 5 });
  state = await soloAct(u.id, state, { kind: "move", groupId: "p1", x: 5.3, y: 5.2 });
  const before = state;
  assert.deepEqual(L.collision.overlappingGroups(before.snapshot, geometry, "p1"), ["p0"]);
  const firstId = randomUUID(); const settled = await soloAct(u.id, before, { kind: "settle", groupId: "p1" }, firstId);
  assert.equal(settled.version, before.version + 1, "één versieovergang");
  assert.deepEqual(L.collision.overlappingGroups(settled.snapshot, geometry, "p1"), []);
  assert.equal(groupOf(settled, "p1").x, 5.3, "de laatst neergelegde groep bleef liggen");
  assert.notDeepEqual({ x: groupOf(settled, "p0").x, y: groupOf(settled, "p0").y }, { x: 5, y: 5 }, "de ander is uitgeweken");
  assert.deepEqual(settled.snapshot.connections, before.snapshot.connections); assert.deepEqual(settled.snapshot.hints, before.snapshot.hints);
  assert.equal(settled.status, "ACTIVE"); assert.equal(settled.snapshot.completedAt, null);
  // dezelfde actie nog eens (retry na een verloren response, met hetzelfde id): hetzelfde antwoord, geen dubbele verplaatsing
  const retry = await L.solo.applySoloAction(u.id, state.id, before.version, firstId, { kind: "settle", groupId: "p1" }, "nl") as Solo;
  assert.equal(retry.version, settled.version); assert.deepEqual(retry.snapshot, settled.snapshot);
  const noop = await L.solo.applySoloAction(u.id, state.id, settled.version, randomUUID(), { kind: "settle", groupId: "p1" }, "nl") as Solo;
  assert.equal(noop.version, settled.version, "niets meer te doen: geen versie, geen log");
  assert.equal(await L.db.puzzleAction.count({ where: { sessionId: state.id, type: "settle" } }), 1);
});

test("Solo: een vastgezette groep beweegt nooit; het losse stuk zoekt zelf een plek", { skip }, async () => {
  const u = await person();
  let state = await L.solo.startSoloPuzzle(u.id, 1, 6, "ADVENTURER", "nl") as Solo;
  const geometry = L.geometry.cachedPuzzleGeometry(6, state.seed, state.geometryVersion);
  const board = L.engine.boardPosition(geometry, groupOf(state, "p0") as never);
  state = await soloAct(u.id, state, { kind: "move", groupId: "p0", x: board.x, y: board.y });
  state = await soloAct(u.id, state, { kind: "anchor", groupId: "p0" });
  assert.equal(groupOf(state, "p0").anchored, true); const fixed = { x: groupOf(state, "p0").x, y: groupOf(state, "p0").y };
  state = await soloAct(u.id, state, { kind: "move", groupId: "p3", x: fixed.x + .3, y: fixed.y + .2 });
  const settled = await soloAct(u.id, state, { kind: "settle", groupId: "p3" });
  assert.deepEqual({ x: groupOf(settled, "p0").x, y: groupOf(settled, "p0").y, a: groupOf(settled, "p0").anchored }, { ...fixed, a: true });
  assert.deepEqual(L.collision.overlappingGroups(settled.snapshot, geometry, "p3"), []);
});

test("Solo: een stuk dat nog kan verbinden wordt nooit weggeschoven en een voltooide puzzel blijft onaangeroerd", { skip }, async () => {
  const u = await person();
  let state = await L.solo.startSoloPuzzle(u.id, 2, 6, "ADVENTURER", "nl") as Solo;
  const geometry = L.geometry.cachedPuzzleGeometry(6, state.seed, state.geometryVersion);
  for (const piece of geometry.pieces) state = await soloAct(u.id, state, { kind: "move", groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row });
  for (const [a, b] of [[0, 1], [1, 2], [0, 3], [3, 4]]) state = await soloAct(u.id, state, { kind: "connect", a, b });
  // het laatste stuk ligt precies op zijn plek: settle doet niets, daarna verbinden voltooit de puzzel
  const noop = await L.solo.applySoloAction(u.id, state.id, state.version, randomUUID(), { kind: "settle", groupId: "p5" }, "nl") as Solo;
  assert.equal(noop.version, state.version); assert.equal(noop.status, "ACTIVE");
  const done = await soloAct(u.id, state, { kind: "connect", a: 4, b: 5 });
  assert.equal(done.status, "COMPLETED"); const completedAt = done.snapshot.completedAt;
  assert.equal(await L.solo.applySoloAction(u.id, state.id, done.version, randomUUID(), { kind: "settle", groupId: done.snapshot.groups[0].id }, "nl"), null, "na voltooiing is de sessie dicht");
  const row = await L.db.puzzleSession.findUniqueOrThrow({ where: { id: state.id } });
  assert.equal(JSON.parse(row.snapshot).completedAt, completedAt, "de officiële voltooiingstijd bleef staan");
});

test("Solo: een oude sessie met overlappingen blijft hervatbaar en wordt niet vanzelf herschikt", { skip }, async () => {
  const u = await person();
  let state = await L.solo.startSoloPuzzle(u.id, 3, 6, "ADVENTURER", "nl") as Solo;
  state = await soloAct(u.id, state, { kind: "move", groupId: "p0", x: 5, y: 5 });
  state = await soloAct(u.id, state, { kind: "move", groupId: "p1", x: 5.3, y: 5.2 }); // bestaande overlapping
  const resumed = await L.solo.resumeSoloPuzzle(u.id, state.id, "nl") as Solo;
  assert.deepEqual(resumed.snapshot, state.snapshot, "hervatten verandert niets");
  assert.deepEqual((await L.solo.startSoloPuzzle(u.id, 3, 6, "ADVENTURER", "nl")).snapshot, state.snapshot);
  // een settle voor een onbekende groep of een groep zonder overlap doet niets
  assert.equal((await L.solo.applySoloAction(u.id, state.id, state.version, randomUUID(), { kind: "settle", groupId: "bestaat-niet" }, "nl") as Solo).version, state.version);
  assert.equal((await L.solo.applySoloAction(u.id, state.id, state.version, randomUUID(), { kind: "settle", groupId: "p4" }, "nl") as Solo).version, state.version);
});

// ---------------- Samen ----------------
type CoopOp = import("../src/lib/puzzle/coop").CoopOperation;
async function coopWorld() {
  const [a, b] = await Promise.all([person(), person()]); await befriend(a.id, b.id);
  const sessionId = await L.coop.createCoopSession(a.id, 0, 24, "DISCOVERER", [b.id]);
  const invite = await L.db.puzzleInvite.findFirstOrThrow({ where: { sessionId, toUserId: b.id } });
  await L.coop.respondToCoopInvite(b.id, invite.id, true);
  const state = await L.coop.getCoopState(a.id, sessionId);
  return { a, b, sessionId, geometry: L.geometry.cachedPuzzleGeometry(state.pieceCount, state.seed, state.geometryVersion) };
}
async function lockOf(userId: string, sessionId: string, groupId: string, now?: Date) { const lock = await L.coop.acquireCoopLock(userId, sessionId, groupId, now); assert.ok(lock.ok); return lock.ok ? lock.token : ""; }
const commit = (userId: string, sessionId: string, operation: CoopOp, lockToken?: string, extra: { actionId?: string; now?: Date } = {}) =>
  L.coop.commitCoopAction(userId, sessionId, { actionId: extra.actionId ?? randomUUID(), lockToken, operation, now: extra.now });
async function drop(userId: string, sessionId: string, piece: number, x: number, y: number) {
  const token = await lockOf(userId, sessionId, `p${piece}`); const result = await commit(userId, sessionId, { kind: "move", groupId: `p${piece}`, x, y }, token);
  await L.coop.releaseCoopLocks(userId, sessionId, { token }); return result;
}
const snapshotOf = async (userId: string, sessionId: string) => (await L.coop.getCoopState(userId, sessionId));

test("Samen: de server maakt atomair ruimte, in één versie en één delta met meerdere groepen, zonder reeks of bijdrage", { skip }, async () => {
  const { a, b, sessionId, geometry } = await coopWorld();
  await drop(a.id, sessionId, 0, 8, 7); await drop(b.id, sessionId, 1, 8.3, 7.2);
  const before = await snapshotOf(a.id, sessionId); const streak = (await get(b.id)).currentStreak; const mine = await L.db.puzzleSessionParticipant.findFirstOrThrow({ where: { sessionId, userId: b.id } });
  const result = await commit(b.id, sessionId, { kind: "settle", groupId: "p1" });
  assert.ok(result.delta, "er is iets verschoven"); assert.equal(result.version, before.version + 1);
  assert.equal(result.contribution, null, "uitwijken telt nooit als verbinding");
  const after = await snapshotOf(a.id, sessionId);
  assert.deepEqual(L.collision.overlappingGroups(after.snapshot, geometry, "p1"), []);
  assert.equal((await get(b.id)).currentStreak, streak, "geen reeksverlenging");
  assert.equal((await L.db.puzzleSessionParticipant.findFirstOrThrow({ where: { sessionId, userId: b.id } })).connectionsMade, mine.connectionsMade);
  assert.deepEqual(after.snapshot.connections, before.snapshot.connections);
  // reconnect: een speler met de oude versie krijgt precies dezelfde eindposities via de patch
  const sync = await L.coop.syncCoopState(a.id, sessionId, before.version);
  assert.ok(sync.patch, "een patch sluit aan");
  assert.deepEqual(L.delta.applyDelta(before.snapshot, sync.patch!).groups.map((g) => ({ id: g.id, x: g.x, y: g.y })), after.snapshot.groups.map((g) => ({ id: g.id, x: g.x, y: g.y })));
});

test("Samen: een retry met hetzelfde action-ID verplaatst niets dubbel en geeft hetzelfde antwoord", { skip }, async () => {
  const { a, b, sessionId } = await coopWorld();
  await drop(a.id, sessionId, 0, 8, 7); await drop(b.id, sessionId, 1, 8.3, 7.2);
  const actionId = randomUUID(); const first = await commit(b.id, sessionId, { kind: "settle", groupId: "p1" }, undefined, { actionId });
  const second = await commit(b.id, sessionId, { kind: "settle", groupId: "p1" }, undefined, { actionId });
  assert.equal(second.duplicate, true); assert.equal(second.version, first.version); assert.deepEqual(second.delta, first.delta);
  assert.equal(await L.db.puzzleAction.count({ where: { sessionId, type: "settle" } }), 1);
  // een nieuwe actie op een schone tafel doet niets
  const later = await commit(a.id, sessionId, { kind: "settle", groupId: "p1" });
  assert.equal(later.delta, null); assert.equal(later.version, first.version);
});

test("Samen: een groep die een andere speler vasthoudt beweegt nooit, ook niet bij een gelijktijdige settle", { skip }, async () => {
  const { a, b, sessionId } = await coopWorld();
  await drop(a.id, sessionId, 0, 8, 7);
  const held = await lockOf(a.id, sessionId, "p0"); // a houdt p0 vast (bijvoorbeeld een nieuwe sleepbeweging)
  await drop(b.id, sessionId, 1, 8.3, 7.2);
  const before = (await snapshotOf(b.id, sessionId)).snapshot; const p0 = before.groups.find((g) => g.id === "p0")!;
  const result = await commit(b.id, sessionId, { kind: "settle", groupId: "p1" });
  const after = (await snapshotOf(b.id, sessionId)).snapshot;
  assert.deepEqual({ x: after.groups.find((g) => g.id === "p0")!.x, y: after.groups.find((g) => g.id === "p0")!.y }, { x: p0.x, y: p0.y }, "de vastgehouden groep bleef staan");
  assert.ok(result.delta && result.delta.upserted.every((g) => g.id !== "p0"));
  // de focusgroep zelf wordt door een ander vastgehouden: dan gebeurt er helemaal niets
  const held1 = await lockOf(a.id, sessionId, "p1");
  const none = await commit(b.id, sessionId, { kind: "settle", groupId: "p1" });
  assert.equal(none.delta, null);
  await L.coop.releaseCoopLocks(a.id, sessionId, { tokens: [held, held1] });
});

test("Samen: een verlopen lock beschermt niet meer", { skip }, async () => {
  const { a, b, sessionId } = await coopWorld();
  await drop(a.id, sessionId, 0, 8, 7);
  const past = new Date(Date.now() - 600_000); await lockOf(a.id, sessionId, "p0", past); // lease al lang voorbij
  await drop(b.id, sessionId, 1, 8.3, 7.2);
  const result = await commit(b.id, sessionId, { kind: "settle", groupId: "p1" });
  assert.ok(result.delta && result.delta.upserted.some((g) => g.id === "p0"), "p0 mocht nu wel uitwijken");
});

test("Samen: twee spelers die tegelijk ruimte maken eindigen in dezelfde, schone, deterministische stand", { skip }, async () => {
  const { a, b, sessionId, geometry } = await coopWorld();
  await drop(a.id, sessionId, 0, 8, 7); await drop(b.id, sessionId, 1, 8.3, 7.2);
  const before = await snapshotOf(a.id, sessionId);
  const [x, y] = await Promise.all([commit(a.id, sessionId, { kind: "settle", groupId: "p1" }), commit(b.id, sessionId, { kind: "settle", groupId: "p1" })]);
  const after = await snapshotOf(a.id, sessionId);
  assert.equal(after.version, before.version + 1, "precies één versieovergang, de tweede was een no-op");
  assert.ok([x.delta, y.delta].filter(Boolean).length === 1);
  assert.deepEqual(L.collision.overlappingGroups(after.snapshot, geometry, "p1"), []);
  // een stale client (oude baseVersion) mag nooit een verouderde stand overschrijven
  const stale = await commit(a.id, sessionId, { kind: "settle", groupId: "p1" });
  assert.equal(stale.delta, null);
});

test("Samen: een groep die intussen met een andere is samengevoegd, wordt niet meer als focus gebruikt", { skip }, async () => {
  const { a, sessionId, geometry } = await coopWorld();
  const board = (id: number) => L.engine.boardPosition(geometry, { id: `p${id}`, pieceIds: [id], x: 0, y: 0, rotation: 0 });
  const w = (id: number) => board(id);
  await drop(a.id, sessionId, 0, w(0).x + .6, w(0).y + .6); await drop(a.id, sessionId, 1, w(1).x + .6, w(1).y + .6);
  const token = await lockOf(a.id, sessionId, "p0");
  const joined = await commit(a.id, sessionId, { kind: "connect", a: 0, b: 1 }, token); assert.ok(joined.delta);
  const result = await commit(a.id, sessionId, { kind: "settle", groupId: "p1" }); // p1 bestaat niet meer
  assert.equal(result.delta, null); assert.equal(result.version, joined.version);
});

// ---------------- Tegen elkaar ----------------
type MatchState = NonNullable<Awaited<ReturnType<typeof L.match.resumeMatchPuzzle>>>;
test("Tegen elkaar: dezelfde regels, zonder invloed op klok, voortgang of de poging van de ander", { skip }, async () => {
  const [a, b] = await Promise.all([person(), person()]); await befriend(a.id, b.id);
  const matchId = await L.match.createMatch(a.id, 0, 6, "ADVENTURER", [b.id], "ASYNC");
  await L.match.respondToMatchInvite(b.id, matchId, true);
  const sa = await L.match.beginMatchAttempt(a.id, matchId); const sb = await L.match.beginMatchAttempt(b.id, matchId);
  let state = await L.match.resumeMatchPuzzle(a.id, matchId, "nl") as MatchState;
  const geometry = L.geometry.cachedPuzzleGeometry(state.pieceCount as 6, state.seed, state.geometryVersion);
  const act = async (operation: Parameters<typeof L.match.applyMatchAction>[4]) => { state = await L.match.applyMatchAction(a.id, matchId, state.version, randomUUID(), operation, "nl") as MatchState; return state; };
  await act({ kind: "move", groupId: "p0", x: 5, y: 5 }); await act({ kind: "move", groupId: "p1", x: 5.3, y: 5.2 });
  const rowB = await L.db.puzzleSession.findUniqueOrThrow({ where: { id: sb } }); const partBefore = await L.db.puzzleMatchParticipant.findFirstOrThrow({ where: { matchId, userId: a.id } });
  const before = state.version; assert.deepEqual(L.collision.overlappingGroups(state.snapshot, geometry, "p1"), ["p0"]);
  await act({ kind: "settle", groupId: "p1" });
  assert.equal(state.version, before + 1); assert.deepEqual(L.collision.overlappingGroups(state.snapshot, geometry, "p1"), []);
  const partAfter = await L.db.puzzleMatchParticipant.findFirstOrThrow({ where: { matchId, userId: a.id } });
  assert.equal(partAfter.progress, partBefore.progress, "uitwijken telt niet als voortgang"); assert.equal(partAfter.status, "PLAYING");
  assert.equal((await L.db.puzzleSession.findUniqueOrThrow({ where: { id: sb } })).snapshot, rowB.snapshot, "de poging van de ander is onaangeroerd");
  const noop = await L.match.applyMatchAction(a.id, matchId, state.version, randomUUID(), { kind: "settle", groupId: "p1" }, "nl") as MatchState;
  assert.equal(noop.version, state.version, "een tweede settle doet niets");
  assert.ok(sa && sb);
});
