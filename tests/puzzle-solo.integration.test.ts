import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { addDays } from "../src/lib/dates";
import { dayKeyInZone } from "../src/lib/timeZone";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url && (new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/versado_puzzle_test")) throw new Error("Deze V2-tests vereisen de lokale wegwerpdatabase van test:puzzle:integration");
if (url) process.env.DATABASE_URL = url;
const skip = !url && "Gebruik npm run test:puzzle:integration voor de geïsoleerde database";
const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  solo: await import("../src/lib/puzzle/solo"),
  bank: await import("../src/lib/jigsawQuestions"),
  catalog: (await import("../src/lib/jigsawGame")).jigsawCatalog,
  geometry: await import("../src/lib/puzzle/geometry"),
});
let L: Awaited<ReturnType<typeof load>>;
const ids: string[] = [];
before(async () => {
  if (skip) return;
  L = await load();
  // Een ontbrekende migratie is een fout, nooit een skip van de V2-integratie.
  await L.db.puzzleSession.count();
});
after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { id: { in: ids } } });
  await L.db.$disconnect();
});
async function account() {
  const u = await L.db.user.create({ data: {
    email: `v2-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `P${randomUUID().slice(0, 8)}`, discriminator: "00",
    timeZone: "Europe/Amsterdam", currentStreak: 4, longestStreak: 4,
    lastStudyDate: addDays(dayKeyInZone(new Date(), "Europe/Amsterdam"), -1), lastStudyTimeZone: "Europe/Amsterdam",
  } });
  ids.push(u.id); return u;
}
type State = Awaited<ReturnType<typeof L.solo.startSoloPuzzle>>;
async function act(userId: string, state: State, operation: Parameters<typeof L.solo.applySoloAction>[4], actionId = randomUUID()) {
  const next = await L.solo.applySoloAction(userId, state.id, state.version, actionId, operation, "nl");
  assert.ok(next); return next;
}
async function prepare(userId: string, index = 0) {
  let state = await L.solo.startSoloPuzzle(userId, index, 6, "ADVENTURER", "nl");
  const geometry = L.geometry.createPuzzleGeometry(6, state.seed, state.geometryVersion);
  // Alle opslag gaat via de echte service, geen voltooiing via DB-fixtures.
  for (const piece of geometry.pieces) state = await act(userId, state, { kind: "move", groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row });
  for (const [a, b] of [[0, 1], [1, 2], [0, 3], [3, 4]]) state = await act(userId, state, { kind: "connect", a, b });
  return state;
}
async function solve(userId: string, index = 0) {
  const state = await act(userId, await prepare(userId, index), { kind: "connect", a: 4, b: 5 });
  assert.equal(state.status, "COMPLETED"); assert.ok(state.question);
  return state;
}
function right(state: State) {
  const q = L.bank.jigsawQuestionsForStory(state.story).find((item) => item.text.nl === state.question!.text)!;
  return state.question!.options.indexOf(q.options.nl[0]);
}

test("V2 bewaart en hervat exacte voortgang en bewaakt eigenaar/variant", { skip }, async () => {
  const u = await account(); const other = await account();
  const state = await act(u.id, await L.solo.startSoloPuzzle(u.id, 28, 6, "ADVENTURER", "nl"), { kind: "move", groupId: "p0", x: 3, y: 3 });
  assert.deepEqual(await L.solo.resumeSoloPuzzle(u.id, state.id, "nl"), state);
  assert.deepEqual(await L.solo.startSoloPuzzle(u.id, 28, 6, "ADVENTURER", "nl"), state);
  assert.equal(await L.solo.resumeSoloPuzzle(other.id, state.id, "nl"), null);
  assert.equal(await L.solo.applySoloAction(other.id, state.id, state.version, randomUUID(), { kind: "move", groupId: "p0", x: 4, y: 4 }, "nl"), null);
  assert.equal(await L.solo.answerSoloPuzzle(u.id, state.id, 0), null);
  const different = await L.solo.startSoloPuzzle(u.id, 215, 6, "MASTER", "nl");
  assert.notEqual(different.id, state.id); assert.equal(different.image, L.catalog[215].url);
  assert.equal(different.difficulty, "MASTER"); assert.equal(different.snapshot.connections.length, 0);
  assert.deepEqual((await L.solo.resumeSoloPuzzle(u.id, state.id, "nl"))!.snapshot, state.snapshot);
});

test("V2 retries en concurrent autosave/completion verliezen geen geaccepteerde state", { skip }, async () => {
  const u = await account(); const almost = await prepare(u.id); const actionId = randomUUID();
  const outcomes = await Promise.all([
    L.solo.applySoloAction(u.id, almost.id, almost.version, actionId, { kind: "connect", a: 4, b: 5 }, "nl"),
    L.solo.applySoloAction(u.id, almost.id, almost.version, randomUUID(), { kind: "move", groupId: "p5", x: 5, y: 4 }, "nl"),
  ]);
  assert.equal(outcomes.filter(Boolean).length, 1, "slechts één actie kan dezelfde versie claimen");
  let current = (await L.solo.resumeSoloPuzzle(u.id, almost.id, "nl"))!;
  if (current.status === "ACTIVE") current = await act(u.id, current, { kind: "connect", a: 4, b: 5 }, actionId);
  assert.equal(current.status, "COMPLETED"); assert.equal(current.snapshot.groups.length, 1);
  assert.deepEqual(await L.solo.applySoloAction(u.id, almost.id, almost.version, actionId, { kind: "connect", a: 4, b: 5 }, "nl"), current, "verloren response herhalen werkt na voltooiing");
  assert.equal(await L.db.puzzleAction.count({ where: { sessionId: current.id, actionId } }), 1);
  assert.deepEqual(await L.solo.startSoloPuzzle(u.id, 0, 6, "ADVENTURER", "nl"), current, "open vraag wordt ook zonder lokale key hervat");
  assert.equal(await L.solo.applySoloAction(u.id, almost.id, almost.version, randomUUID(), { kind: "move", groupId: "p5", x: 2, y: 2 }, "nl"), null);
});

test("V2 antwoord is atomisch, duurzaam en idempotent, ook bij verschillende concurrente keuzes", { skip }, async () => {
  const u = await account(); const state = await solve(u.id); const choice = right(state);
  const first = await L.solo.answerSoloPuzzle(u.id, state.id, choice); assert.ok(first && "correct" in first);
  const repeated = await L.solo.answerSoloPuzzle(u.id, state.id, (choice + 1) % 3);
  assert.deepEqual(repeated, first, "dezelfde sessie geeft de oorspronkelijke uitslag");
  assert.equal(first.correct, true);
  assert.deepEqual((await L.solo.resumeSoloPuzzle(u.id, state.id, "nl"))!.answer, first);
  const row = await L.db.user.findUniqueOrThrow({ where: { id: u.id } });
  assert.equal(row.currentStreak, 5); assert.equal(row.xpTotal, 0);
  assert.equal(await L.db.streakActivity.count({ where: { userId: u.id, key: `jigsaw:v2:${state.id}` } }), 1);
  const next = await solve(u.id);
  const concurrent = await Promise.all([L.solo.answerSoloPuzzle(u.id, next.id, right(next)), L.solo.answerSoloPuzzle(u.id, next.id, (right(next) + 1) % 3)]);
  assert.deepEqual(concurrent[0], concurrent[1]);
  assert.equal(await L.db.streakActivity.count({ where: { userId: u.id, key: `jigsaw-answer:v2:${next.id}` } }), 1);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: u.id } })).currentStreak, 5);
});

test("V2 historisch dezelfde vraag opnieuw beantwoorden en onbeperkt spelen behoudt historie en dagregels", { skip }, async (t) => {
  const u = await account(); const first = await solve(u.id); await L.solo.answerSoloPuzzle(u.id, first.id, right(first));
  const before = await L.db.puzzleSession.findUniqueOrThrow({ where: { id: first.id } });
  const replay = await solve(u.id);
  // Exact dezelfde vraagcontent/volgorde als historische poging: geen nieuw contentrecht.
  await L.db.puzzleSession.update({ where: { id: replay.id }, data: { questionId: before.questionId, optionOrder: before.optionOrder } });
  const resumed = (await L.solo.resumeSoloPuzzle(u.id, replay.id, "nl"))!;
  const outcome = await L.solo.answerSoloPuzzle(u.id, replay.id, right(resumed)); assert.ok(outcome && "correct" in outcome);
  assert.equal(outcome.correct, true); assert.equal(outcome.streak?.dayEarned, false); assert.equal(outcome.streak?.alreadyStudiedToday, true);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: u.id } })).currentStreak, 5);
  assert.deepEqual(await L.db.puzzleSession.findUniqueOrThrow({ where: { id: first.id } }), before);
  const next = await L.solo.startSoloPuzzle(u.id, 0, 6, "ADVENTURER", "nl");
  assert.notEqual(next.id, replay.id); assert.equal(next.status, "ACTIVE"); assert.equal(next.snapshot.connections.length, 0);
  // Nieuwe geldige volgende-dag voltooiing loopt door dezelfde centrale regels.
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 24 * 60 * 60 * 1000 });
  const final = await solve(u.id); const finalAnswer = await L.solo.answerSoloPuzzle(u.id, final.id, right(final));
  assert.ok(finalAnswer && "correct" in finalAnswer); assert.equal(finalAnswer.streak?.dayEarned, true);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: u.id } })).currentStreak, 6);
  assert.equal(await L.db.streakDay.count({ where: { userId: u.id } }), 2);
});

test("V2 gelijktijdig starten maakt één poging; fout antwoord is definitief binnen die poging", { skip }, async () => {
  const u = await account(); const other = await account();
  const starts = await Promise.all([...Array.from({ length: 4 }, () => L.solo.startSoloPuzzle(u.id, L.catalog[100].url, 6, "ADVENTURER", "nl")), L.solo.startSoloPuzzle(other.id, L.catalog[100].url, 6, "ADVENTURER", "nl")]);
  assert.equal(new Set(starts.slice(0, 4).map((state) => state.id)).size, 1);
  assert.notEqual(starts[4].id, starts[0].id, "een andere eigenaar heeft eigen speelstatus");
  const state = await solve(u.id, 100);
  const wrong = await L.solo.answerSoloPuzzle(u.id, state.id, (right(state) + 1) % 3);
  assert.ok(wrong && "correct" in wrong); assert.equal(wrong.correct, false); assert.equal(wrong.counted, false);
  assert.deepEqual(await L.solo.answerSoloPuzzle(u.id, state.id, right(state)), wrong);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: u.id } })).currentStreak, 4);
  assert.notEqual((await L.solo.startSoloPuzzle(u.id, 100, 6, "ADVENTURER", "nl")).id, state.id);
});

test("V2 herstelt oude onvolledige status alleen met een geldige geometrische voltooiing", { skip }, async () => {
  const u = await account(); const solved = await solve(u.id, 101);
  await L.db.puzzleSession.update({ where: { id: solved.id }, data: { status: "ACTIVE", completedAt: null, questionId: null, optionOrder: null } });
  const restored = (await L.solo.resumeSoloPuzzle(u.id, solved.id, "nl"))!;
  assert.equal(restored.status, "COMPLETED"); assert.ok(restored.question);
  assert.deepEqual(restored.snapshot.groups, solved.snapshot.groups);
  assert.deepEqual(await L.solo.startSoloPuzzle(u.id, 101, 6, "ADVENTURER", "nl"), restored);
  assert.deepEqual(await L.solo.resumeSoloPuzzle(u.id, solved.id, "nl"), restored, "herstel is idempotent");
  const active = await L.solo.startSoloPuzzle(u.id, 102, 6, "ADVENTURER", "nl");
  const fake = { ...active.snapshot, completedAt: new Date().toISOString() };
  await L.db.puzzleSession.update({ where: { id: active.id }, data: { snapshot: JSON.stringify(fake) } });
  assert.equal((await L.solo.resumeSoloPuzzle(u.id, active.id, "nl"))!.status, "ACTIVE");
  assert.equal(await L.solo.answerSoloPuzzle(u.id, active.id, 0), null, "een timestamp schakelt geometrievalidatie niet uit");
});

test("V2 een opslagfout rolt antwoord, claim en reeks terug; retry kan daarna afronden", { skip }, async () => {
  const u = await account(); const state = await solve(u.id, 103);
  // Alleen deze testsessie wordt geraakt. De runner maakt een wegwerpdatabase.
  await L.db.$executeRawUnsafe(`CREATE FUNCTION puzzle_test_reject_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."sessionId" = '${state.id}' THEN RAISE EXCEPTION 'opzettelijke testfout'; END IF; RETURN NEW; END $$`);
  await L.db.$executeRawUnsafe('CREATE TRIGGER puzzle_test_record_failure BEFORE INSERT ON "PuzzlePersonalRecord" FOR EACH ROW EXECUTE FUNCTION puzzle_test_reject_record()');
  try {
    await assert.rejects(L.solo.answerSoloPuzzle(u.id, state.id, right(state)));
    assert.equal((await L.solo.resumeSoloPuzzle(u.id, state.id, "nl"))!.status, "COMPLETED");
    assert.equal(await L.db.streakActivity.count({ where: { userId: u.id } }), 0);
    assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: u.id } })).currentStreak, 4);
  } finally {
    await L.db.$executeRawUnsafe('DROP TRIGGER puzzle_test_record_failure ON "PuzzlePersonalRecord"');
    await L.db.$executeRawUnsafe('DROP FUNCTION puzzle_test_reject_record()');
  }
  const answer = await L.solo.answerSoloPuzzle(u.id, state.id, right(state));
  assert.ok(answer && "correct" in answer && answer.correct);
});

test("V2 oude claim van een onderbroken antwoord sluit veilig af zonder tweede beloning", { skip }, async () => {
  const u = await account(); const state = await solve(u.id, 104);
  const central = await import("../src/lib/streak");
  await central.completeJigsaw(u.id, `v2:${state.id}`, true);
  assert.deepEqual(await L.solo.answerSoloPuzzle(u.id, state.id, (right(state) + 1) % 3), { alreadyAnswered: true });
  assert.equal((await L.solo.resumeSoloPuzzle(u.id, state.id, "nl"))!.status, "ANSWERED");
  assert.equal(await L.db.streakActivity.count({ where: { userId: u.id, key: `jigsaw:v2:${state.id}` } }), 1);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: u.id } })).currentStreak, 5);
});

test("V2 een na 30 dagen hervatte puzzel kan ook het antwoord en tijdrecord afronden", { skip }, async () => {
  const u = await account(); const state = await solve(u.id, 105);
  await L.db.puzzleSession.update({ where: { id: state.id }, data: { startedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } });
  const answer = await L.solo.answerSoloPuzzle(u.id, state.id, right(state));
  assert.ok(answer && "correct" in answer && answer.correct);
  const record = await L.db.puzzlePersonalRecord.findUniqueOrThrow({ where: { sessionId: state.id } });
  assert.ok(record.elapsedMs > 2_147_483_647, "tijd wordt zonder Int-overflow of afkappen opgeslagen");
});

test("V2 start alle werkelijke 216 catalogusafbeeldingen met de juiste unieke identiteit", { skip }, async () => {
  const u = await account(); assert.equal(L.catalog.length, 216);
  for (const [index, image] of L.catalog.entries()) {
    const state = await L.solo.startSoloPuzzle(u.id, index, 6, "ADVENTURER", "nl");
    assert.equal(state.image, image.url); assert.equal(state.story, image.story);
  }
  assert.equal(await L.db.puzzleSession.count({ where: { ownerId: u.id } }), 216);
});
