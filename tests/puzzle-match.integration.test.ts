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

/** Zet een wedstrijd terug naar de oude regels (versie 1), zoals bestaande wedstrijden die hebben. */
const legacy = (matchId: string) => L.db.puzzleMatch.update({ where: { id: matchId }, data: { resultRules: 1 } });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const participantRow = (matchId: string, userId: string) => L.db.puzzleMatchParticipant.findUniqueOrThrow({ where: { matchId_userId: { matchId, userId } } });
async function started(kind: "ASYNC" | "LIVE" = "ASYNC", extra = 0) {
  const made = await duo(kind, extra);
  for (const p of made.people.slice(1)) await L.match.respondToMatchInvite(p.id, made.matchId, true);
  if (kind === "ASYNC") for (const p of made.people) await L.match.beginMatchAttempt(p.id, made.matchId);
  return made;
}

test("oude regels (versie 1): een fout antwoord geeft geen geldige tijd, maar telt voor de reeks", { skip }, async () => {
  const { people: [a, b], matchId } = await started();
  await legacy(matchId);
  const streakA = (await get(a.id)).currentStreak;
  const stateA = await solve(a.id, matchId);
  assert.equal((await participantRow(matchId, a.id)).status, "PLAYING", "onder de oude regels telt de puzzel pas met het antwoord");
  const wrong = await L.match.answerMatch(a.id, matchId, wrongChoice(stateA));
  assert.equal(wrong.valid, false); assert.equal(wrong.correctChoice, null);
  assert.equal((await get(a.id)).currentStreak, streakA + 1);
  const stateB = await solve(b.id, matchId);
  await L.match.answerMatch(b.id, matchId, rightChoice(stateB));
  const final = await L.match.getMatch(b.id, matchId);
  assert.equal(final.resultRules, 1); assert.equal(final.status, "FINISHED"); assert.equal(final.winnerId, b.id);
  assert.equal(final.participants.find((p) => p.userId === a.id)!.result!.valid, false);
});

test("nieuwe regels: de tijd stopt bij het voltooien van de puzzel en de vraag verandert niets", { skip }, async () => {
  const { people: [a, b], matchId } = await started();
  const stateA = await solve(a.id, matchId);
  const done = await participantRow(matchId, a.id);
  const session = await L.db.puzzleSession.findUniqueOrThrow({ where: { id: done.sessionId! } });
  assert.equal(done.status, "FINISHED", "direct afgerond bij de laatste verbinding");
  assert.ok(session.completedAt, "voltooiingstijdstip van de commit");
  assert.equal(done.finishedAt!.getTime(), session.completedAt!.getTime(), "finish = canoniek voltooiingstijdstip");
  assert.equal(done.elapsedMs, session.completedAt!.getTime() - done.startedAt!.getTime(), "elapsed = completedAt - startedAt");
  assert.equal(done.answeredAt, null);
  const official = done.elapsedMs;
  await sleep(700);
  const streakBefore = (await get(a.id)).currentStreak;
  const wrong = await L.match.answerMatch(a.id, matchId, wrongChoice(stateA));
  assert.equal(wrong.valid, true, "een fout antwoord maakt het resultaat niet ongeldig");
  assert.equal(wrong.correctChoice, null, "juiste antwoord blijft verborgen zolang de wedstrijd loopt");
  const after = await participantRow(matchId, a.id);
  assert.equal(after.elapsedMs, official, "de vraagtijd telt niet mee");
  assert.equal(after.status, "FINISHED"); assert.equal(after.answeredCorrect, false); assert.ok(after.answeredAt);
  assert.equal((await get(a.id)).currentStreak, streakBefore + 1, "ook een fout antwoord telt voor de reeks");
  // Tweede antwoord (ook een goed): geen tweede kans, geen tweede beloning.
  const again = await L.match.answerMatch(a.id, matchId, rightChoice(stateA));
  assert.equal(again.correct, false); assert.equal((await get(a.id)).currentStreak, streakBefore + 1);
  const view = await L.match.getMatch(b.id, matchId);
  assert.equal(view.participants.find((p) => p.userId === a.id)!.result, null, "b ziet a's tijd pas na eigen finish");
  void b;
});

test("nieuwe regels: rang op puzzeltijd, goed antwoord verandert de volgorde niet en verlengt de reeks wel", { skip }, async () => {
  const { people: [a, b], matchId } = await started();
  // a begon later dan b, maar legt sneller (kortere officiële tijd).
  await L.db.puzzleMatchParticipant.update({ where: { matchId_userId: { matchId, userId: a.id } }, data: { startedAt: new Date(Date.now() - 2000) } });
  await L.db.puzzleMatchParticipant.update({ where: { matchId_userId: { matchId, userId: b.id } }, data: { startedAt: new Date(Date.now() - 90_000) } });
  const stateA = await solve(a.id, matchId); const stateB = await solve(b.id, matchId);
  assert.equal((await L.match.getMatch(a.id, matchId)).status, "FINISHED", "alle puzzels klaar: de wedstrijd sluit zonder antwoorden");
  const streakB = (await get(b.id)).currentStreak;
  await L.match.answerMatch(a.id, matchId, wrongChoice(stateA));
  const goodB = await L.match.answerMatch(b.id, matchId, rightChoice(stateB));
  assert.equal(goodB.correct, true); assert.ok(goodB.correctChoice !== null);
  assert.equal((await get(b.id)).currentStreak, streakB + 1, "goed antwoord kan de reeks verlengen");
  const final = await L.match.getMatch(a.id, matchId);
  assert.equal(final.winnerId, a.id, "a wint op puzzeltijd, ondanks het foute antwoord");
  assert.deepEqual(final.participants.map((p) => [p.userId, p.result!.rank, p.result!.valid]).sort(), [[a.id, 1, true], [b.id, 2, true]].sort());
});

test("nieuwe regels: zonder antwoord blijft de uitslag staan; de vraag kan ook na afloop nog", { skip }, async () => {
  const { people: [a, b], matchId } = await started();
  const stateA = await solve(a.id, matchId);
  await L.db.puzzleMatch.update({ where: { id: matchId }, data: { playDeadline: new Date(Date.now() - 1000) } });
  await L.maintenance.runPuzzleMaintenance();
  const closed = await L.match.getMatch(a.id, matchId);
  assert.equal(closed.status, "FINISHED"); assert.equal(closed.winnerId, a.id, "puzzel vóór de deadline voltooid blijft geldig zonder antwoord");
  assert.equal(closed.participants.find((p) => p.userId === b.id)!.status, "DNF");
  assert.equal(closed.me.question.answered, false);
  const question = await L.match.matchQuestion(a.id, matchId, "nl");
  assert.ok(question && !("correctChoice" in question), "geen antwoord zonder zelf te antwoorden");
  const streak = (await get(a.id)).currentStreak;
  const late = await L.match.answerMatch(a.id, matchId, rightChoice(stateA));
  assert.equal(late.valid, true); assert.ok(late.correctChoice !== null, "na afloop mag het juiste antwoord getoond worden");
  assert.equal((await get(a.id)).currentStreak, streak + 1);
  assert.equal((await participantRow(matchId, a.id)).elapsedMs, closed.participants.find((p) => p.userId === a.id)!.result!.elapsedMs);
});

test("nieuwe regels: een puzzel die pas na de deadline af is, wordt DNF", { skip }, async () => {
  const { people: [a, b], matchId } = await started();
  let state = await L.match.resumeMatchPuzzle(a.id, matchId, "nl") as State;
  await L.db.puzzleMatch.update({ where: { id: matchId }, data: { playDeadline: new Date(Date.now() - 1000) } });
  assert.equal(await code(L.match.applyMatchAction(a.id, matchId, state.version, randomUUID(), { kind: "move", groupId: "p0", x: 3, y: 3 }, "nl")), "EXPIRED");
  await L.maintenance.runPuzzleMaintenance();
  const final = await L.match.getMatch(b.id, matchId);
  assert.equal(final.status, "FINISHED");
  assert.ok(final.participants.every((p) => p.status === "DNF"));
  assert.equal(final.winnerId, null);
  state = state;
});

test("nieuwe regels: een herhaalde laatste commit maakt geen tweede finish of andere tijd", { skip }, async () => {
  const { people: [a, b], matchId } = await started();
  let state = await L.match.resumeMatchPuzzle(a.id, matchId, "nl") as State;
  const geometry = L.geometry.cachedPuzzleGeometry(state.pieceCount as 6, state.seed, state.geometryVersion);
  for (const piece of geometry.pieces) state = await act(a.id, matchId, state, { kind: "move" as const, groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row });
  for (const [x, y] of [[0, 1], [1, 2], [0, 3], [3, 4]]) state = await act(a.id, matchId, state, { kind: "connect" as const, a: x, b: y });
  const lastId = randomUUID(); const operation = { kind: "connect" as const, a: 4, b: 5 };
  const first = await L.match.applyMatchAction(a.id, matchId, state.version, lastId, operation, "nl");
  const before = await participantRow(matchId, a.id);
  await sleep(300);
  const retry = await L.match.applyMatchAction(a.id, matchId, state.version, lastId, operation, "nl");
  assert.ok(first && retry && retry.status === "COMPLETED");
  const after = await participantRow(matchId, a.id);
  assert.equal(after.elapsedMs, before.elapsedMs); assert.equal(after.finishedAt!.getTime(), before.finishedAt!.getTime());
  assert.equal(await L.db.puzzleAction.count({ where: { sessionId: after.sessionId!, actionId: lastId } }), 1);
  // Een nieuwe actie na de finish verplaatst niets meer.
  assert.equal(await L.match.applyMatchAction(a.id, matchId, retry.version, randomUUID(), { kind: "move", groupId: "p0", x: 5, y: 5 }, "nl"), null);
  void b;
});

test("nieuwe regels: gelijktijdig voltooien geeft twee geldige tijden en één afsluiting", { skip }, async () => {
  const { people: [a, b], matchId } = await started();
  await Promise.all([solve(a.id, matchId), solve(b.id, matchId)]);
  const final = await L.match.getMatch(a.id, matchId);
  assert.equal(final.status, "FINISHED");
  assert.deepEqual(final.participants.map((p) => p.result!.rank).sort(), [1, 2]);
  assert.ok(final.winnerId);
});

test("nieuwe regels: voortgang en vraagstatus in het overzicht (wachten, afgerond)", { skip }, async () => {
  const activity = await import("../src/lib/puzzle/activity");
  const t = (key: string) => key;
  const { people: [a, b], matchId } = await started();
  await solve(a.id, matchId);
  const forA = await activity.getPuzzleActivity(a.id, t as never, undefined);
  const mine = forA.activeGames.find((i) => i.id === matchId)!;
  assert.equal(mine.myTurn, false, "klaar: wachten op anderen, geen 'verder puzzelen'");
  const forB = await activity.getPuzzleActivity(b.id, t as never, undefined);
  assert.equal(forB.activeGames.find((i) => i.id === matchId)!.myTurn, null);
  await solve(b.id, matchId);
  assert.equal((await activity.getPuzzleActivity(a.id, t as never, undefined)).activeGames.some((i) => i.id === matchId), false, "afgeronde wedstrijd is geen actieve actie meer");
  const overview = await L.match.listMatchOverview(a.id);
  assert.ok(overview.some((row) => row.match.id === matchId && row.match.status === "FINISHED"), "uitslag blijft bereikbaar");
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
  // Elke dag een eigen buurpaar (horizontale buren in de eerste twee rijen), naast elkaar gelegd en verbonden.
  const pairs: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7]];
  const hold = async (piece: number, now: Date) => {
    const current = await L.coop.getCoopState(a.id, id);
    const group = current.snapshot.groups.find((g) => g.pieceIds.includes(piece))!;
    const lock = await L.coop.acquireCoopLock(a.id, id, group.id, now);
    assert.ok(lock.ok); return { groupId: group.id, token: lock.ok ? lock.token : "" };
  };
  const send = (operation: import("../src/lib/puzzle/coop").CoopOperation, token: string, now: Date) => L.coop.commitCoopAction(a.id, id, { actionId: randomUUID(), lockToken: token, operation, now });
  const result: number[] = [];
  const days = [0, 1, 2, 6];
  for (const [index, offset] of days.entries()) {
    const now = new Date(base.getTime() + offset * 86_400_000);
    const [one, two] = pairs[index]; const y = 3 + index;
    const l1 = await hold(one, now); await send({ kind: "move", groupId: l1.groupId, x: 3, y }, l1.token, now); await L.coop.releaseCoopLocks(a.id, id);
    const l2 = await hold(two, now); await send({ kind: "move", groupId: l2.groupId, x: 4, y }, l2.token, now); await L.coop.releaseCoopLocks(a.id, id);
    const l3 = await hold(two, now);
    const done = await send({ kind: "connect", a: two, b: one }, l3.token, now);
    assert.ok(done.delta, "verbinding gemaakt");
    await L.coop.releaseCoopLocks(a.id, id);
    result.push((await get(a.id)).currentStreak);
  }
  // Drie opeenvolgende dagen verlengen de reeks elk met één. Na een gat van meerdere dagen geldt
  // de bestaande terugkeerregel: de reeks wordt niet stilletjes opgehoogd, maar de eerste
  // activiteit telt mee voor de terugkeer.
  assert.deepEqual(result.slice(0, 3), [4, 5, 6]);
  const returned = await get(a.id);
  assert.equal(result[3], 6, "na een gat verlengt één verbinding de reeks niet zelf");
  assert.ok(returned.streakInterruptedDay, "de reeks staat in de terugkeerstand");
  assert.equal(returned.streakReturnCount, 1, "de verbinding telt als eerste terugkeeractiviteit");
  assert.equal(await L.db.streakActivity.count({ where: { userId: a.id, key: { startsWith: `puzzle-coop:${id}:` } } }), 4, "één claim per kalenderdag");
});

test("actieve spellen en open acties: uitnodigingen, begin jouw puzzel en wachten", { skip }, async () => {
  const activity = await import("../src/lib/puzzle/activity");
  const t = (key: string, values?: Record<string, string | number>) => `${key}:${values?.n ?? ""}`;
  const { people: [a, b], matchId } = await duo("ASYNC");
  let forB = await activity.getPuzzleActivity(b.id, t as never, undefined);
  assert.equal(forB.invitesReceived.filter((i) => i.kind === "puzzle-match" && i.id === matchId).length, 1);
  let forA = await activity.getPuzzleActivity(a.id, t as never, undefined);
  assert.equal(forA.invitesSent.filter((i) => i.id === matchId).length, 1);
  assert.equal(forA.activeGames.find((i) => i.id === matchId)!.myTurn, true, "asynchroon: begin jouw puzzel wacht op jou");
  await L.match.respondToMatchInvite(b.id, matchId, true);
  await L.match.beginMatchAttempt(a.id, matchId);
  forA = await activity.getPuzzleActivity(a.id, t as never, undefined);
  assert.equal(forA.activeGames.find((i) => i.id === matchId)!.myTurn, null, "bezig: verder spelen");
  const state = await solve(a.id, matchId);
  await L.match.answerMatch(a.id, matchId, rightChoice(state));
  forA = await activity.getPuzzleActivity(a.id, t as never, undefined);
  assert.equal(forA.activeGames.find((i) => i.id === matchId)!.myTurn, false, "klaar: wachten op anderen");
  forB = await activity.getPuzzleActivity(b.id, t as never, undefined);
  assert.equal(forB.invitesReceived.length, 0);
  assert.equal(forB.activeGames.find((i) => i.id === matchId)!.myTurn, true);
});
