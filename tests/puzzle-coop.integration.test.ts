import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { addDays } from "../src/lib/dates";
import { dayKeyInZone } from "../src/lib/timeZone";

// Alleen met een eigen testdatabase; nooit tegen productie.
const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  coop: await import("../src/lib/puzzle/coop"),
  engine: await import("../src/lib/puzzle/engine"),
  geometry: await import("../src/lib/puzzle/geometryCache"),
  errors: await import("../src/lib/puzzle/errors"),
});
let L: Awaited<ReturnType<typeof load>>;
const ids: string[] = [];
before(async () => { if (!skip) L = await load(); });
after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { id: { in: ids } } });
  await L.db.$disconnect();
});

async function person(extra: Record<string, unknown> = {}) {
  const user = await L.db.user.create({ data: {
    email: `coop-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Co${randomUUID().slice(0, 8)}`, discriminator: "00", timeZone: "Europe/Amsterdam",
    currentStreak: 3, longestStreak: 3, lastStudyDate: addDays(dayKeyInZone(new Date(), "Europe/Amsterdam"), -1), lastStudyTimeZone: "Europe/Amsterdam", ...extra,
  } });
  ids.push(user.id);
  return user;
}
async function befriend(a: string, b: string) { await L.db.friendship.create({ data: { senderId: a, receiverId: b, status: "ACCEPTED" } }); }
const get = (id: string) => L.db.user.findUniqueOrThrow({ where: { id } });
async function code(promise: Promise<unknown>) { try { await promise; return null; } catch (error) { return error instanceof L.errors.PuzzleServiceError ? error.code : String(error); } }

/** Een groep met de eigen stukken van de wereld, in de volgorde van het bord. */
async function world(sessionId: string) {
  const state = await L.coop.getCoopState((await L.db.puzzleSession.findUniqueOrThrow({ where: { id: sessionId } })).ownerId, sessionId);
  return { state, geometry: L.geometry.cachedPuzzleGeometry(state.pieceCount, state.seed, state.geometryVersion) };
}
async function hold(userId: string, sessionId: string, piece: number, now?: Date) {
  const { state } = await world(sessionId);
  const group = state.snapshot.groups.find((g) => g.pieceIds.includes(piece))!;
  const lock = await L.coop.acquireCoopLock(userId, sessionId, group.id, now);
  assert.ok(lock.ok, "lock verkregen");
  return { groupId: group.id, token: lock.ok ? lock.token : "" };
}
const op = (userId: string, sessionId: string, operation: import("../src/lib/puzzle/coop").CoopOperation, lockToken?: string, now?: Date) =>
  L.coop.commitCoopAction(userId, sessionId, { actionId: randomUUID(), lockToken, operation, now });

async function session(owner: string, friends: string[] = [], difficulty: "DISCOVERER" | "ADVENTURER" | "EXPERT" | "MASTER" = "DISCOVERER") {
  return L.coop.createCoopSession(owner, 0, 24, difficulty, friends);
}

test("uitnodigen: alleen geaccepteerde vrienden, geen dubbele uitnodigingen, maximaal vier", { skip }, async () => {
  const [a, b, c, d, e, stranger] = await Promise.all([person(), person(), person(), person(), person(), person()]);
  for (const friend of [b, c, d, e]) await befriend(a.id, friend.id);
  assert.equal(await code(session(a.id, [stranger.id])), "NOT_FRIENDS");
  const id = await session(a.id, [b.id]);
  await L.coop.inviteToCoop(a.id, id, [b.id, c.id]);
  assert.equal(await L.db.puzzleInvite.count({ where: { sessionId: id } }), 2, "b niet dubbel uitgenodigd");
  await L.coop.inviteToCoop(a.id, id, [d.id]);
  assert.equal(await code(L.coop.inviteToCoop(a.id, id, [e.id])), "CAPACITY", "organisator + 3 uitnodigingen = vier");
  assert.equal(await code(L.coop.inviteToCoop(b.id, id, [e.id])), "FORBIDDEN", "alleen de organisator nodigt uit");
});

test("acceptatie, weigering, intrekking en verloop", { skip }, async () => {
  const [a, b, c, d] = await Promise.all([person(), person(), person(), person()]);
  for (const friend of [b, c, d]) await befriend(a.id, friend.id);
  const id = await session(a.id, [b.id, c.id, d.id]);
  const invites = await L.db.puzzleInvite.findMany({ where: { sessionId: id } });
  const of = (userId: string) => invites.find((i) => i.toUserId === userId)!.id;
  await L.coop.respondToCoopInvite(b.id, of(b.id), true);
  assert.equal(await L.db.puzzleSessionParticipant.count({ where: { sessionId: id } }), 2);
  await L.coop.respondToCoopInvite(c.id, of(c.id), false);
  assert.equal(await code(L.coop.respondToCoopInvite(c.id, of(c.id), true)), "EXPIRED", "geweigerd kan niet alsnog");
  await L.coop.revokeCoopInvite(a.id, of(d.id));
  assert.equal(await code(L.coop.respondToCoopInvite(d.id, of(d.id), true)), "CLOSED", "ingetrokken geeft geen toegang");
  assert.equal(await code(L.coop.getCoopState(d.id, id)), "FORBIDDEN");
  // Verlopen uitnodiging.
  await L.coop.inviteToCoop(a.id, id, [c.id]);
  const again = await L.db.puzzleInvite.findFirstOrThrow({ where: { sessionId: id, toUserId: c.id } });
  await L.db.puzzleInvite.update({ where: { id: again.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal(await code(L.coop.respondToCoopInvite(c.id, again.id, true)), "EXPIRED");
  assert.equal(await code(L.coop.respondToCoopInvite(b.id, of(c.id), true)), "NOT_FOUND", "andermans uitnodiging");
});

test("gelijktijdige acceptaties kunnen nooit een vijfde deelnemer maken", { skip }, async () => {
  const people = await Promise.all([person(), person(), person(), person(), person()]);
  const [a, ...rest] = people;
  for (const friend of rest) await befriend(a.id, friend.id);
  const id = await session(a.id, rest.slice(0, 3).map((p) => p.id));
  // Een vierde uitnodiging langs de servicecontrole om (bv. een oude rij) forceert de race.
  await L.db.puzzleInvite.create({ data: { kind: "COOP", sessionId: id, fromUserId: a.id, toUserId: rest[3].id, expiresAt: new Date(Date.now() + 1e6) } });
  const invites = await L.db.puzzleInvite.findMany({ where: { sessionId: id } });
  const results = await Promise.all(invites.map((invite) => code(L.coop.respondToCoopInvite(invite.toUserId, invite.id, true))));
  assert.equal(results.filter((r) => r === null).length, 3);
  assert.equal(results.filter((r) => r === "CAPACITY").length, 1);
  assert.equal(await L.db.puzzleSessionParticipant.count({ where: { sessionId: id } }), 4);
});

test("locks: één houder per groep, verloop geeft de groep vrij, rotatie/verplaatsing vraagt een lock", { skip }, async () => {
  const [a, b] = await Promise.all([person(), person()]);
  await befriend(a.id, b.id);
  const id = await session(a.id, [b.id]);
  const invite = await L.db.puzzleInvite.findFirstOrThrow({ where: { sessionId: id } });
  await L.coop.respondToCoopInvite(b.id, invite.id, true);
  const held = await hold(a.id, id, 0);
  const denied = await L.coop.acquireCoopLock(b.id, id, held.groupId);
  assert.equal(denied.ok, false);
  assert.equal(!denied.ok && denied.holder, a.id);
  assert.equal(await code(op(b.id, id, { kind: "move", groupId: held.groupId, x: 3, y: 3 }, "verzonnen")), "NO_LOCK");
  assert.equal(await code(op(b.id, id, { kind: "move", groupId: held.groupId, x: 3, y: 3 }, held.token)), "NO_LOCK", "token van een ander");
  await L.db.puzzleLock.updateMany({ where: { sessionId: id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const taken = await L.coop.acquireCoopLock(b.id, id, held.groupId);
  assert.ok(taken.ok, "verlopen lock blijft niet hangen");
  assert.equal(await code(op(a.id, id, { kind: "move", groupId: held.groupId, x: 3, y: 3 }, held.token)), "NO_LOCK", "oude lock is waardeloos");
  const renew = await L.coop.renewCoopLock(b.id, id, held.groupId, taken.ok ? taken.token : "");
  assert.ok(renew.ok);
  assert.equal((await L.coop.renewCoopLock(a.id, id, held.groupId, held.token)).ok, false);
  // Vrijgeven op loslaten.
  await L.coop.releaseCoopLocks(b.id, id);
  assert.equal(await L.db.puzzleLock.count({ where: { sessionId: id } }), 0);
});

test("samen verbinden: fusie, reeks alleen voor de maker, geen reeks voor verplaatsen of de ander", { skip }, async () => {
  const [a, b] = await Promise.all([person(), person()]);
  await befriend(a.id, b.id);
  const id = await session(a.id, [b.id]);
  await L.coop.respondToCoopInvite(b.id, (await L.db.puzzleInvite.findFirstOrThrow({ where: { sessionId: id } })).id, true);
  const streakA = (await get(a.id)).currentStreak; const streakB = (await get(b.id)).currentStreak;
  // A zet stuk 0 neer, B zet stuk 1 er precies naast (zelfde rij, één kolom verder).
  const lockA = await hold(a.id, id, 0);
  const moved = await op(a.id, id, { kind: "move", groupId: lockA.groupId, x: 4, y: 4 }, lockA.token);
  assert.ok(moved.delta && !moved.contribution, "alleen verplaatsen telt niet");
  assert.equal((await get(a.id)).currentStreak, streakA, "verplaatsen verlengt de reeks niet");
  await L.coop.releaseCoopLocks(a.id, id);
  const lockB = await hold(b.id, id, 1);
  await op(b.id, id, { kind: "move", groupId: lockB.groupId, x: 5, y: 4 }, lockB.token);
  // Een vreemde die niet deelneemt kan niets.
  const outsider = await person();
  assert.equal(await code(op(outsider.id, id, { kind: "connect", a: 0, b: 1 })), "FORBIDDEN");
  const version = (await world(id)).state.version;
  const joined = await op(b.id, id, { kind: "connect", a: 1, b: 0 }, lockB.token);
  assert.ok(joined.delta && joined.contribution?.counted, "geldige bijdrage telt");
  assert.equal(joined.version, version + 1);
  assert.equal((await get(b.id)).currentStreak, streakB + 1, "B verlengt zijn reeks");
  assert.equal((await get(a.id)).currentStreak, streakA, "A krijgt niets voor het werk van B");
  const after = await world(id);
  assert.equal(after.state.snapshot.connections.length, 1);
  assert.equal(after.state.snapshot.groups.length, 23);
  // Een tweede verbinding op dezelfde dag verlengt de reeks niet nogmaals, maar blijft geldig.
  const claims = await L.db.streakActivity.count({ where: { userId: b.id, key: { startsWith: `puzzle-coop:${id}:` } } });
  assert.equal(claims, 1);
  // Een verbinding die al bestaat, een mislukte verbinding en de hint doen niets.
  const lockMerged = await hold(b.id, id, 1);
  const noop = await op(b.id, id, { kind: "connect", a: 0, b: 2 }, lockMerged.token).catch((e) => e);
  assert.ok(!(noop as { contribution?: unknown }).contribution);
});

test("verloren response: dezelfde actionId voert niet twee keer uit en claimt de reeks niet dubbel", { skip }, async () => {
  const [a] = await Promise.all([person()]);
  const id = await session(a.id);
  const first = await hold(a.id, id, 0);
  const actionId = randomUUID();
  const body = { actionId, lockToken: first.token, operation: { kind: "move" as const, groupId: first.groupId, x: 6, y: 6 } };
  const one = await L.coop.commitCoopAction(a.id, id, body);
  const two = await L.coop.commitCoopAction(a.id, id, body);
  assert.equal(two.duplicate, true);
  assert.equal(two.version, one.version);
  assert.equal(await L.db.puzzleAction.count({ where: { sessionId: id } }), 1);
});

test("volgende kalenderdag: opnieuw een geldige bijdrage telt, dezelfde dag niet dubbel", { skip }, async () => {
  const [a] = await Promise.all([person()]);
  const id = await session(a.id);
  const base = new Date();
  const connectPair = async (x: number, y: number, one: number, two: number, now: Date) => {
    const l1 = await hold(a.id, id, one, now); await op(a.id, id, { kind: "move", groupId: l1.groupId, x, y }, l1.token, now); await L.coop.releaseCoopLocks(a.id, id);
    const l2 = await hold(a.id, id, two, now); await op(a.id, id, { kind: "move", groupId: l2.groupId, x: x + 1, y }, l2.token, now);
    await L.coop.releaseCoopLocks(a.id, id);
    const l3 = await hold(a.id, id, two, now);
    return op(a.id, id, { kind: "connect", a: two, b: one }, l3.token, now);
  };
  const day1 = await connectPair(3, 3, 0, 1, base);
  assert.ok(day1.contribution?.counted);
  const day1b = await connectPair(3, 6, 6, 7, base);
  assert.ok(day1b.contribution, "tweede verbinding op dezelfde dag is een geldige bijdrage");
  assert.equal(await L.db.streakActivity.count({ where: { userId: a.id, key: { startsWith: `puzzle-coop:${id}:` } } }), 1, "één claim per dag");
  const tomorrow = new Date(base.getTime() + 24 * 3_600_000);
  const day2 = await connectPair(3, 9, 12, 13, tomorrow);
  assert.ok(day2.contribution?.counted);
  assert.equal(await L.db.streakActivity.count({ where: { userId: a.id, key: { startsWith: `puzzle-coop:${id}:` } } }), 2, "nieuwe dag, nieuwe claim");
});

test("hints zijn persoonlijk: eigen budget per deelnemer, geen overdracht, geen wijziging van de puzzel", { skip }, async () => {
  const [a, b] = await Promise.all([person({ hintBalance: 1 }), person({ hintBalance: 0 })]);
  await befriend(a.id, b.id);
  const id = await session(a.id, [b.id], "EXPERT"); // 2 inbegrepen hints per speler
  await L.coop.respondToCoopInvite(b.id, (await L.db.puzzleInvite.findFirstOrThrow({ where: { sessionId: id } })).id, true);
  const before = (await world(id)).state;
  const hint = () => L.coop.spendCoopHint(a.id, id, randomUUID(), { hint: "PREVIEW" });
  const expire = () => L.db.puzzleSessionParticipant.updateMany({ where: { sessionId: id, userId: a.id }, data: { activeHint: null } });
  const first = await hint(); assert.ok(first.hint && !first.hint.extra); await expire();
  await hint(); await expire();
  assert.equal(await code(hint()), "HINT_CONFIRM", "inbegrepen op, nu persoonlijk saldo");
  const paid = await L.coop.spendCoopHint(a.id, id, randomUUID(), { hint: "PREVIEW", confirmPersonal: true });
  assert.equal(paid.hintBalance, 0); assert.ok(paid.hint?.extra);
  await expire();
  assert.equal(await code(L.coop.spendCoopHint(a.id, id, randomUUID(), { hint: "PREVIEW", confirmPersonal: true })), "HINT_EMPTY", "geen negatief saldo");
  assert.equal((await get(a.id)).hintBalance, 0);
  // B heeft zijn eigen inbegrepen budget en ziet de hint van A niet.
  const own = await L.coop.spendCoopHint(b.id, id, randomUUID(), { hint: "PREVIEW" });
  assert.ok(own.hint && !own.hint.extra && own.includedRemaining === 1);
  const seenByB = await L.coop.getCoopState(b.id, id);
  assert.equal(seenByB.me.hint?.actionId, own.hint?.actionId);
  const after = (await world(id)).state;
  assert.equal(after.version, before.version, "hints veranderen de gedeelde puzzel niet");
  assert.deepEqual(after.snapshot.hints, []);
});

test("voltooiing: geen vraag nodig, locks vrij, deelnemers krijgen geen reeks voor andermans laatste stuk", { skip }, async () => {
  const [a, b] = await Promise.all([person(), person()]);
  await befriend(a.id, b.id);
  const id = await session(a.id, [b.id], "ADVENTURER");
  await L.coop.respondToCoopInvite(b.id, (await L.db.puzzleInvite.findFirstOrThrow({ where: { sessionId: id } })).id, true);
  // Alles op het bord vastzetten behalve het laatste stuk (bewust rechtstreeks in de database).
  const { state, geometry } = await world(id);
  const row = await L.db.puzzleSession.findUniqueOrThrow({ where: { id } });
  const engine = L.engine; void engine;
  const snapshot = JSON.parse(row.snapshot);
  const board = (await import("../src/lib/puzzle/engine")).boardPosition;
  const free = geometry.pieces.length - 1;
  for (const group of snapshot.groups) {
    if (group.pieceIds[0] === free) { const to = board(geometry, group); group.x = to.x + 0.1; group.y = to.y; continue; }
    const to = board(geometry, group); group.x = to.x; group.y = to.y; group.anchored = true;
  }
  // Maak er één anker-boom van met bestaande verbindingen, zoals joinAnchoredGroups dat doet.
  const { cloneSnapshot } = await import("../src/lib/puzzle/engine");
  void cloneSnapshot;
  const anchored = snapshot.groups.filter((g: { anchored?: boolean }) => g.anchored);
  const merged = { id: "board", pieceIds: anchored.flatMap((g: { pieceIds: number[] }) => g.pieceIds), x: 0, y: 0, rotation: 0, anchored: true };
  const first = geometry.pieces[merged.pieceIds[0]]; const target = board(geometry, merged as never); merged.x = target.x; merged.y = target.y;
  void first;
  const connections: { a: number; b: number }[] = []; const seen = new Set<number>([merged.pieceIds[0]]); const queue = [merged.pieceIds[0]];
  const areNeighbours = (await import("../src/lib/puzzle/geometry")).areNeighbours;
  while (queue.length) { const piece = queue.shift()!; for (const other of merged.pieceIds) if (!seen.has(other) && areNeighbours(geometry, piece, other)) { seen.add(other); queue.push(other); connections.push({ a: Math.min(piece, other), b: Math.max(piece, other) }); } }
  const last = snapshot.groups.find((g: { pieceIds: number[] }) => g.pieceIds[0] === free);
  const next = { ...snapshot, groups: [merged, last], connections };
  await L.db.puzzleSession.update({ where: { id }, data: { snapshot: JSON.stringify(next) } });
  assert.ok(state.pieceCount === 24);
  const streakA = (await get(a.id)).currentStreak; const streakB = (await get(b.id)).currentStreak;
  const lock = await hold(b.id, id, free);
  // Laatste stuk precies op zijn plek en vastzetten.
  const to = board(geometry, last);
  await op(b.id, id, { kind: "move", groupId: last.id, x: to.x, y: to.y }, lock.token);
  const done = await op(b.id, id, { kind: "anchor", groupId: last.id }, lock.token);
  assert.ok(done.completed, "gezamenlijk voltooid");
  const finished = await world(id);
  assert.equal(finished.state.status, "COMPLETED");
  assert.ok(finished.state.completedAt);
  assert.equal(await L.db.puzzleLock.count({ where: { sessionId: id } }), 0);
  assert.equal(finished.state.snapshot.groups.length, 1);
  assert.equal((await get(a.id)).currentStreak, streakA, "A krijgt niets voor het laatste stuk van B");
  assert.equal((await get(b.id)).currentStreak, streakB + 1, "B maakte de verbinding via de bordverankering");
  assert.equal(await code(op(a.id, id, { kind: "move", groupId: "board", x: 1, y: 1 }, "x")), "CLOSED");
  // Een nieuwe sessie met dezelfde vrienden overschrijft de oude niet.
  const second = await session(a.id, [b.id]);
  assert.notEqual(second, id);
  assert.equal((await world(id)).state.status, "COMPLETED");
});

test("asynchroon: wie later binnenkomt ziet de bestaande voortgang; patch of snapshot na een gemiste update", { skip }, async () => {
  const [a, b] = await Promise.all([person(), person()]);
  await befriend(a.id, b.id);
  const id = await session(a.id, [b.id]);
  const l1 = await hold(a.id, id, 0);
  await op(a.id, id, { kind: "move", groupId: l1.groupId, x: 4, y: 4 }, l1.token);
  await L.coop.releaseCoopLocks(a.id, id);
  await L.coop.respondToCoopInvite(b.id, (await L.db.puzzleInvite.findFirstOrThrow({ where: { sessionId: id } })).id, true);
  const seen = await L.coop.getCoopState(b.id, id);
  const moved = seen.snapshot.groups.find((g) => g.pieceIds.includes(0))!;
  assert.equal(moved.x, 4);
  assert.equal(seen.participants.length, 2);
  const sync = await L.coop.syncCoopState(b.id, id, seen.version);
  assert.ok(sync.upToDate);
  const l2 = await hold(a.id, id, 5);
  await op(a.id, id, { kind: "move", groupId: l2.groupId, x: 7, y: 7 }, l2.token);
  const patch = await L.coop.syncCoopState(b.id, id, seen.version);
  assert.ok(patch.patch, "patch vanaf een bekende versie");
  const applied = L.coop.applyDelta(seen.snapshot, patch.patch!);
  const fresh = await L.coop.getCoopState(b.id, id);
  assert.deepEqual(applied.groups.map((g) => g.id).sort(), fresh.snapshot.groups.map((g) => g.id).sort());
  assert.deepEqual(applied.groups.find((g) => g.pieceIds.includes(5)), fresh.snapshot.groups.find((g) => g.pieceIds.includes(5)));
  const full = await L.coop.syncCoopState(b.id, id, 999);
  assert.ok(full.state, "onbekende versie: volledige snapshot");
});
