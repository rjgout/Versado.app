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
  match: await import("../src/lib/puzzle/match"),
  coop: await import("../src/lib/puzzle/coop"),
  geometry: await import("../src/lib/puzzle/geometryCache"),
  errors: await import("../src/lib/puzzle/errors"),
  bank: await import("../src/lib/jigsawQuestions"),
  maintenance: await import("../src/lib/puzzle/maintenance"),
});
let L: Awaited<ReturnType<typeof load>>;
const ids: string[] = [];
before(async () => { if (!skip) L = await load(); });
after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { id: { in: ids } } });
  await L.db.$disconnect();
});

async function person() {
  const user = await L.db.user.create({ data: {
    email: `match-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Ma${randomUUID().slice(0, 8)}`, discriminator: "00", timeZone: "Europe/Amsterdam",
    currentStreak: 3, longestStreak: 3, lastStudyDate: addDays(dayKeyInZone(new Date(), "Europe/Amsterdam"), -1), lastStudyTimeZone: "Europe/Amsterdam",
  } });
  ids.push(user.id); return user;
}
async function befriend(a: string, b: string) { await L.db.friendship.create({ data: { senderId: a, receiverId: b, status: "ACCEPTED" } }); }
const get = (id: string) => L.db.user.findUniqueOrThrow({ where: { id } });
async function code(promise: Promise<unknown>) { try { await promise; return null; } catch (error) { return error instanceof L.errors.PuzzleServiceError ? error.code : String(error); } }

type State = NonNullable<Awaited<ReturnType<typeof L.match.resumeMatchPuzzle>>>;
async function act(userId: string, matchId: string, state: State, operation: Parameters<typeof L.match.applyMatchAction>[4]) {
  const next = await L.match.applyMatchAction(userId, matchId, state.version, randomUUID(), operation, "nl");
  assert.ok(next); return next as State;
}
/** Legt de puzzel van 6 stukken via de echte service; geeft de staat met de vraag terug. */
async function solve(userId: string, matchId: string) {
  let state = await L.match.resumeMatchPuzzle(userId, matchId, "nl") as State;
  const geometry = L.geometry.cachedPuzzleGeometry(state.pieceCount as 6, state.seed, state.geometryVersion);
  for (const piece of geometry.pieces) state = await act(userId, matchId, state, { kind: "move" as const, groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row });
  for (const [a, b] of [[0, 1], [1, 2], [0, 3], [3, 4]]) state = await act(userId, matchId, state, { kind: "connect" as const, a, b });
  state = await act(userId, matchId, state, { kind: "connect" as const, a: 4, b: 5 });
  assert.equal(state.status, "COMPLETED"); assert.ok(state.question);
  return state;
}
function rightChoice(state: State) {
  const q = L.bank.jigsawQuestionsForStory(state.story).find((item) => item.text.nl === state.question!.text)!;
  return state.question!.options.indexOf(q.options.nl[0]);
}
const wrongChoice = (state: State) => (rightChoice(state) + 1) % 3;
async function duo(kind: "ASYNC" | "LIVE" = "ASYNC", extra = 0) {
  const people = await Promise.all(Array.from({ length: 2 + extra }, () => person()));
  for (const friend of people.slice(1)) await befriend(people[0].id, friend.id);
  const matchId = await L.match.createMatch(people[0].id, 0, 6, "ADVENTURER", people.slice(1).map((p) => p.id), kind);
  return { people, matchId };
}

test("uitnodiging: alleen vrienden, antwoorden en intrekken", { skip }, async () => {
  const [a, b, stranger] = await Promise.all([person(), person(), person()]);
  await befriend(a.id, b.id);
  assert.equal(await code(L.match.createMatch(a.id, 0, 6, "ADVENTURER", [stranger.id], "ASYNC")), "NOT_FRIENDS");
  assert.equal(await code(L.match.createMatch(a.id, 0, 6, "ADVENTURER", [], "ASYNC")), "CAPACITY");
  const id = await L.match.createMatch(a.id, 0, 6, "ADVENTURER", [b.id], "ASYNC");
  assert.equal(await code(L.match.getMatch(stranger.id, id)), "FORBIDDEN", "niet-deelnemers zien niets");
  assert.equal(await code(L.match.beginMatchAttempt(b.id, id)), "EXPIRED", "begin kan pas na accepteren");
  await L.match.respondToMatchInvite(b.id, id, true);
  await L.match.respondToMatchInvite(b.id, id, true);
  assert.equal((await L.match.getMatch(b.id, id)).me.status, "ACCEPTED");
  assert.equal(await L.db.puzzleInvite.count({ where: { matchId: id, status: "PENDING" } }), 0);
});

test("asynchroon: van uitnodiging tot uitslag, één officiële poging, identieke start", { skip }, async () => {
  const { people: [a, b], matchId } = await duo("ASYNC");
  await L.match.respondToMatchInvite(b.id, matchId, true);
  const sa = await L.match.beginMatchAttempt(a.id, matchId);
  assert.equal(await L.match.beginMatchAttempt(a.id, matchId), sa, "opnieuw beginnen geeft dezelfde sessie en klok");
  const sb = await L.match.beginMatchAttempt(b.id, matchId);
  const rows = await L.db.puzzleSession.findMany({ where: { id: { in: [sa, sb] } }, include: { variant: true } });
  assert.equal(rows[0].variantId, rows[1].variantId, "dezelfde variant");
  assert.equal(rows[0].snapshot, rows[1].snapshot, "dezelfde beginverdeling");
  assert.equal(rows[0].questionId, rows[1].questionId, "dezelfde vraag");
  assert.equal(rows[0].optionOrder, rows[1].optionOrder);
  const before = (await get(a.id)).currentStreak;
  const stateA = await solve(a.id, matchId);
  // Tijdens de wedstrijd is er geen uitslag zichtbaar en het juiste antwoord blijft verborgen.
  const hidden = await L.match.getMatch(b.id, matchId);
  assert.equal(hidden.me.visibleResults, false);
  assert.ok(hidden.participants.every((p) => p.result === null));
  const answerA = await L.match.answerMatch(a.id, matchId, rightChoice(stateA));
  assert.equal(answerA.valid, true); assert.equal(answerA.correctChoice !== null, true);
  assert.equal((await get(a.id)).currentStreak, before + 1, "goed antwoord verlengt de reeks");
  assert.equal((await L.match.answerMatch(a.id, matchId, wrongChoice(stateA))).status, "FINISHED", "tweede antwoord verandert niets");
  assert.equal((await get(a.id)).currentStreak, before + 1, "reeks maar één keer");
  assert.equal((await L.match.getMatch(a.id, matchId)).status, "RUNNING", "b is nog bezig");
  const mid = await L.match.getMatch(a.id, matchId);
  assert.equal(mid.me.visibleResults, true);
  const stateB = await solve(b.id, matchId);
  const answerB = await L.match.answerMatch(b.id, matchId, rightChoice(stateB));
  assert.equal(answerB.valid, true);
  const final = await L.match.getMatch(b.id, matchId);
  assert.equal(final.status, "FINISHED");
  const ranks = final.participants.map((p) => p.result!.rank).sort();
  assert.deepEqual(ranks, [1, 2]);
  assert.ok(final.winnerId && [a.id, b.id].includes(final.winnerId));
  const winner = final.participants.find((p) => p.result!.rank === 1)!;
  const loser = final.participants.find((p) => p.result!.rank === 2)!;
  assert.ok(winner.result!.elapsedMs! <= loser.result!.elapsedMs!);
  assert.equal(await L.db.puzzleMatchParticipant.count({ where: { matchId, status: "FINISHED" } }), 2);
});

test("een fout antwoord geeft geen geldige tijd en geen reeks", { skip }, async () => {
  const { people: [a, b], matchId } = await duo("ASYNC");
  await L.match.respondToMatchInvite(b.id, matchId, true);
  await L.match.beginMatchAttempt(a.id, matchId); await L.match.beginMatchAttempt(b.id, matchId);
  const streakA = (await get(a.id)).currentStreak;
  const stateA = await solve(a.id, matchId);
  const wrong = await L.match.answerMatch(a.id, matchId, wrongChoice(stateA));
  assert.equal(wrong.valid, false); assert.equal(wrong.correctChoice, null, "juiste antwoord blijft verborgen tijdens de wedstrijd");
  assert.equal((await get(a.id)).currentStreak, streakA);
  const stateB = await solve(b.id, matchId);
  await L.match.answerMatch(b.id, matchId, rightChoice(stateB));
  const final = await L.match.getMatch(b.id, matchId);
  assert.equal(final.status, "FINISHED"); assert.equal(final.winnerId, b.id);
  assert.equal(final.participants.find((p) => p.userId === a.id)!.result!.rank, null);
  assert.equal(final.participants.find((p) => p.userId === a.id)!.result!.valid, false);
});

test("live: lobby, startmoment van de server en geen acties vóór de start", { skip }, async () => {
  const { people: [a, b, c], matchId } = await duo("LIVE", 1);
  assert.equal(await code(L.match.startLiveMatch(a.id, matchId)), "CAPACITY", "minstens twee geaccepteerde spelers");
  await L.match.respondToMatchInvite(b.id, matchId, true);
  assert.equal(await code(L.match.startLiveMatch(b.id, matchId)), "NOT_FOUND", "alleen de organisator start");
  await L.match.startLiveMatch(a.id, matchId);
  const view = await L.match.getMatch(a.id, matchId);
  assert.equal(view.status, "RUNNING");
  assert.ok(view.startsAt && Date.parse(view.startsAt) > Date.now(), "aftelling loopt");
  assert.equal((await L.match.getMatch(c.id, matchId)).me.status, "DECLINED", "wie niet accepteerde voor de start, speelt niet mee");
  assert.equal(await L.db.puzzleInvite.count({ where: { matchId, status: "PENDING" } }), 0);
  const sessions = await L.db.puzzleSession.findMany({ where: { matchId } });
  assert.equal(sessions.length, 2); assert.equal(sessions[0].snapshot, sessions[1].snapshot);
  const state = await L.match.resumeMatchPuzzle(a.id, matchId, "nl") as State;
  assert.equal(await code(L.match.applyMatchAction(a.id, matchId, state.version, randomUUID(), { kind: "move", groupId: "p0", x: 3, y: 3 }, "nl")), "NOT_STARTED");
  await L.db.puzzleSession.updateMany({ where: { matchId }, data: { startedAt: new Date(Date.now() - 1000) } });
  await L.db.puzzleMatch.update({ where: { id: matchId }, data: { startsAt: new Date(Date.now() - 1000) } });
  await L.db.puzzleMatchParticipant.updateMany({ where: { matchId, status: "PLAYING" }, data: { startedAt: new Date(Date.now() - 1000) } });
  const moved = await act(a.id, matchId, state, { kind: "move", groupId: "p0", x: 3, y: 3 });
  assert.ok(moved.version > state.version);
  assert.equal(await code(L.match.cancelMatch(a.id, matchId)), "CLOSED", "lopende wedstrijd annuleer je niet meer");
});

test("deadline: niet-afgeronde pogingen worden DNF en de wedstrijd sluit", { skip }, async () => {
  const { people: [a, b], matchId } = await duo("ASYNC");
  await L.match.respondToMatchInvite(b.id, matchId, true);
  await L.match.beginMatchAttempt(a.id, matchId);
  const stateA = await solve(a.id, matchId);
  await L.match.answerMatch(a.id, matchId, rightChoice(stateA));
  await L.db.puzzleMatch.update({ where: { id: matchId }, data: { playDeadline: new Date(Date.now() - 1000) } });
  assert.equal(await code(L.match.beginMatchAttempt(b.id, matchId)), "EXPIRED", "te laat beginnen kan niet");
  await L.maintenance.runPuzzleMaintenance();
  const final = await L.match.getMatch(b.id, matchId);
  assert.equal(final.status, "FINISHED");
  assert.equal(final.participants.find((p) => p.userId === b.id)!.status, "DNF");
  assert.equal(final.winnerId, a.id, "wie wél klaar was, wint");
  assert.equal((await L.match.getMatch(a.id, matchId)).status, "FINISHED");
});

test("onbeantwoorde uitnodiging verloopt en annuleert een wedstrijd zonder tegenstander", { skip }, async () => {
  const { people: [a, b], matchId } = await duo("LIVE");
  await L.db.puzzleMatch.update({ where: { id: matchId }, data: { joinDeadline: new Date(Date.now() - 1000) } });
  await L.maintenance.runPuzzleMaintenance();
  assert.equal((await L.match.getMatch(a.id, matchId)).status, "CANCELLED");
  assert.equal(await code(L.match.respondToMatchInvite(b.id, matchId, true)), "EXPIRED");
});

test("reeks over meerdere kalenderdagen in een gezamenlijke puzzel", { skip }, async () => {
  const [a, b] = await Promise.all([person(), person()]);
  await befriend(a.id, b.id);
  const id = await L.coop.createCoopSession(a.id, 0, 24, "ADVENTURER", [b.id]);
  const invite = await L.db.puzzleInvite.findFirstOrThrow({ where: { sessionId: id, toUserId: b.id } });
  await L.coop.respondToCoopInvite(b.id, invite.id, true);
  const base = new Date();
  const state = await L.coop.getCoopState(a.id, id);
  const geometry = L.geometry.cachedPuzzleGeometry(state.pieceCount as 24, state.seed, state.geometryVersion);
  // Verbind steeds een nieuw buurpaar; elke verbinding op een andere dag.
  const pairs: [number, number][] = [];
  for (let piece = 0; piece + 1 < geometry.grid.columns && pairs.length < 4; piece++) pairs.push([piece, piece + 1]);
  const streakOf = async () => (await get(a.id)).currentStreak;
  const days = [0, 1, 2, 6];
  const result: number[] = [];
  for (const [index, offset] of days.entries()) {
    const now = new Date(base.getTime() + offset * 86_400_000);
    const current = await L.coop.getCoopState(a.id, id);
    const [x, y] = pairs[index];
    const g = (piece: number) => current.snapshot.groups.find((group) => group.pieceIds.includes(piece))!;
    const lock = await L.coop.acquireCoopLock(a.id, id, g(x).id, now);
    assert.ok(lock.ok);
    const done = await L.coop.commitCoopAction(a.id, id, { actionId: randomUUID(), lockToken: lock.ok ? lock.token : undefined, operation: { kind: "connect", a: x, b: y }, now });
    assert.ok(done.delta, "verbinding gemaakt");
    result.push(await streakOf());
    // Tweede verbinding op dezelfde dag telt niet nog een keer: wordt hieronder niet gemaakt, maar de claim is uniek per dag.
  }
  assert.deepEqual(result, [4, 5, 6, 1], "drie opeenvolgende dagen +1, na een gat van meerdere dagen opnieuw 1");
  assert.equal(await L.db.puzzleSessionParticipant.count({ where: { sessionId: id } }), 2);
});
