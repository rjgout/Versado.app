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

test("regels 2: server verankert, bewaart, hervat en voltooit losse bordplaatsingen", { skip }, async () => {
  const u = await account(); const other = await account();
  let state = await L.solo.startSoloPuzzle(u.id, 110, 12, "ADVENTURER", "nl");
  const engine = await import("../src/lib/puzzle/engine"); const geometry = L.geometry.createPuzzleGeometry(12, state.seed, state.geometryVersion);
  assert.equal(state.rulesVersion, 2);
  const noPlacement = await act(u.id, state, { kind: "anchor", groupId: "p0" }); assert.deepEqual(noPlacement, state);
  for (const [index, piece] of [0,2,8,10,5,7,1,3,4,6,9,11].entries()) {
    const group = engine.groupFor(state.snapshot, piece)!; const to = engine.boardPosition(geometry, group);
    state = await act(u.id, state, { kind: "move", groupId: group.id, x: to.x + .2, y: to.y });
    const id = randomUUID(); const before = state;
    state = await act(u.id, state, { kind: "anchor", groupId: group.id }, id);
    assert.ok(engine.groupFor(state.snapshot, piece)!.anchored);
    assert.deepEqual(await act(u.id, before, { kind: "anchor", groupId: group.id }, id), state);
    assert.deepEqual(await L.solo.resumeSoloPuzzle(u.id, state.id, "nl"), state);
    assert.equal(state.status, index === 11 ? "COMPLETED" : "ACTIVE");
    if (index === 0) {
      assert.equal(await L.solo.applySoloAction(other.id, state.id, state.version, randomUUID(), { kind: "anchor", groupId: group.id }, "nl"), null);
      assert.deepEqual(await act(u.id, state, { kind: "move", groupId: group.id, x: to.x + 1, y: to.y }), state);
      assert.equal(await L.solo.answerSoloPuzzle(u.id, state.id, 0), null);
    }
  }
  assert.ok(state.question); assert.equal(state.snapshot.connections.length, 11);
  assert.deepEqual(await L.solo.startSoloPuzzle(u.id, 110, 12, "ADVENTURER", "nl"), state);
  const answer = await L.solo.answerSoloPuzzle(u.id, state.id, right(state)); assert.ok(answer && "correct" in answer && answer.correct);
  assert.notEqual((await L.solo.startSoloPuzzle(u.id, 110, 12, "ADVENTURER", "nl")).id, state.id);
});

test("regels 2: concurrent bordplaatsing/autosave heeft één winnaar; omgekeerde verbinding verplaatst anker niet", { skip }, async () => {
  const u = await account(); const engine = await import("../src/lib/puzzle/engine");
  let state = await L.solo.startSoloPuzzle(u.id, 111, 12, "DISCOVERER", "nl");
  const geometry = L.geometry.createPuzzleGeometry(12, state.seed, state.geometryVersion);
  const to = engine.boardPosition(geometry, state.snapshot.groups[0]);
  state = await act(u.id, state, { kind: "move", groupId: "p0", x: to.x + .1, y: to.y });
  const results = await Promise.all([
    L.solo.applySoloAction(u.id, state.id, state.version, randomUUID(), { kind: "anchor", groupId: "p0" }, "nl"),
    L.solo.applySoloAction(u.id, state.id, state.version, randomUUID(), { kind: "move", groupId: "p0", x: to.x + .2, y: to.y }, "nl"),
  ]);
  assert.equal(results.filter(Boolean).length, 1); state = results.find(Boolean)!;
  if (!engine.groupFor(state.snapshot, 0)!.anchored) state = await act(u.id, state, { kind: "anchor", groupId: "p0" });
  const fixed = engine.groupFor(state.snapshot, 0)!;
  const p1 = engine.boardPosition(geometry, engine.groupFor(state.snapshot, 1)!);
  state = await act(u.id, state, { kind: "move", groupId: "p1", x: p1.x + .2, y: p1.y });
  state = await act(u.id, state, { kind: "connect", a: 1, b: 0 });
  const grown = engine.groupFor(state.snapshot, 1)!;
  assert.equal(grown.x, fixed.x); assert.equal(grown.y, fixed.y); assert.ok(grown.anchored);
  assert.deepEqual(await act(u.id, state, { kind: "move", groupId: grown.id, x: 0, y: 0 }), state);
});

test("regels 2: server weigert bordankers op Expert/Meester en onbewezen voltooiing", { skip }, async () => {
  const u = await account(); const engine = await import("../src/lib/puzzle/engine");
  for (const difficulty of ["EXPERT", "MASTER"] as const) {
    let state = await L.solo.startSoloPuzzle(u.id, 112, 12, difficulty, "nl");
    const geometry = L.geometry.createPuzzleGeometry(12, state.seed, state.geometryVersion); const to = engine.boardPosition(geometry, state.snapshot.groups[0]);
    state = await act(u.id, state, { kind: "move", groupId: "p0", ...to });
    assert.deepEqual(await act(u.id, state, { kind: "anchor", groupId: "p0" }), state);
    const q = L.bank.jigsawQuestionsForStory(state.story)[0];
    await L.db.puzzleSession.update({ where: { id: state.id }, data: { status: "COMPLETED", completedAt: new Date(), questionId: q.id, optionOrder: "[0,1,2]", snapshot: JSON.stringify({ ...state.snapshot, completedAt: new Date().toISOString() }) } });
    assert.equal(await L.solo.answerSoloPuzzle(u.id, state.id, 0), null, "status en timestamp zijn geen geometrisch bewijs");
  }
  assert.equal(await L.db.streakActivity.count({ where: { userId: u.id } }), 0);
});

test("regels 2: vier hints registreren budget/extra/tijd/target zonder plaatsing of reeks; retries kosten eenmaal", { skip }, async (t) => {
  const u = await account(); await L.db.user.update({ where: { id: u.id }, data: { hintBalance: 1 } }); const engine = await import("../src/lib/puzzle/engine");
  let state = await L.solo.startSoloPuzzle(u.id, 113, 12, "ADVENTURER", "nl"); const before = structuredClone(state.snapshot);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const operations = [{ kind: "hint", hint: "PREVIEW" }, { kind: "hint", hint: "LOCATION", pieceId: 0 }, { kind: "hint", hint: "CONNECTION", pieceId: 0 }, { kind: "hint", hint: "FILTER", filter: "MIDDLES", confirmPersonal: true }] as const;
  for (const [index, operation] of operations.entries()) {
    const id = randomUUID(); const previous = state;
    state = await act(u.id, state, operation, id);
    assert.equal(state.snapshot.hints.length, index + 1); const hint = state.snapshot.hints.at(-1)!;
    assert.equal(hint.type, operation.hint); assert.equal(hint.actionId, id); assert.equal(hint.extra, index === 3);
    assert.equal(Date.parse(hint.expiresAt!) - Date.parse(hint.at), 5000); assert.ok(hint.target);
    if (hint.target.type === "CONNECTION") assert.ok(L.geometry.areNeighbours(L.geometry.createPuzzleGeometry(12, state.seed, state.geometryVersion), hint.target.pieceId, hint.target.neighborId));
    assert.deepEqual(await act(u.id, previous, operation, id), state);
    assert.deepEqual(await act(u.id, state, operation), state, "snel herhaald indrukken schrijft niets extra af");
    assert.deepEqual(await L.solo.resumeSoloPuzzle(u.id, state.id, "nl"), state);
    assert.deepEqual(state.snapshot.groups, before.groups); assert.deepEqual(state.snapshot.connections, before.connections); assert.equal(state.snapshot.filter, null); assert.equal(state.status, "ACTIVE");
    t.mock.timers.tick(6000);
  }
  assert.equal(await L.db.puzzleAction.count({ where: { sessionId: state.id, type: "hint" } }), 4);
  assert.equal(await L.db.streakActivity.count({ where: { userId: u.id } }), 0); assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: u.id } })).xpTotal, 0);
  const invalid = await act(u.id, state, { kind: "hint", hint: "CONNECTION", pieceId: 95 }); assert.deepEqual(invalid, state);
  const geometry = L.geometry.createPuzzleGeometry(12, state.seed, state.geometryVersion);
  for (const piece of geometry.pieces) {
    const group = engine.groupFor(state.snapshot, piece.id)!; const to = engine.boardPosition(geometry, group);
    if (!group.anchored) { state = await act(u.id, state, { kind: "move", groupId: group.id, ...to }); state = await act(u.id, state, { kind: "anchor", groupId: group.id }); }
  }
  const answer = await L.solo.answerSoloPuzzle(u.id, state.id, right(state)); assert.ok(answer && "correct" in answer && answer.correct && answer.streak?.dayEarned);
  const record = await L.db.puzzlePersonalRecord.findUniqueOrThrow({ where: { sessionId: state.id } }); assert.equal(record.hintsUsed, 4); assert.equal(record.extraHintsUsed, 1);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: u.id } })).currentStreak, 5);
});

test("regels 2: concurrent hintrequests schrijven één hint af, Ontdekker houdt onbeperkt inbegrepen hulp", { skip }, async (t) => {
  const u = await account(); let state = await L.solo.startSoloPuzzle(u.id, 114, 6, "DISCOVERER", "nl");
  const operation = { kind: "hint", hint: "PREVIEW" } as const; const id = randomUUID();
  const replies = await Promise.all(Array.from({ length: 4 }, () => L.solo.applySoloAction(u.id, state.id, state.version, id, operation, "nl")));
  assert.ok(replies.every(Boolean)); assert.ok(replies.every((value) => value!.snapshot.hints.length === 1)); state = replies[0]!;
  assert.equal(await L.db.puzzleAction.count({ where: { sessionId: state.id, actionId: id } }), 1);
  assert.equal(await L.solo.applySoloAction(u.id, state.id, 1, id, { kind: "hint", hint: "FILTER", filter: "CORNERS" }, "nl"), null);
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + 6000 });
  for (let i = 0; i < 5; i++) { state = await act(u.id, state, operation); t.mock.timers.tick(6000); }
  assert.equal(state.snapshot.hints.length, 6); assert.ok(state.snapshot.hints.every((hint) => !hint.extra));
});

test("versieovergang: geometry 1/2 en rules 1 hervatten exact; replay wordt rules 2 zonder historie te wijzigen", { skip }, async () => {
  for (const geometryVersion of [1, 2]) {
    const u = await account(); const index = 115 + geometryVersion;
    const current = await L.solo.startSoloPuzzle(u.id, index, 6, "ADVENTURER", "nl");
    const row = await L.db.puzzleSession.findUniqueOrThrow({ where: { id: current.id }, include: { variant: { include: { definition: true } } } });
    let definition = row.variant.definition;
    if (geometryVersion === 1) { definition = await L.db.puzzleDefinition.create({ data: { imageUrl: definition.imageUrl, storyNumber: definition.storyNumber, aspectRatio: definition.aspectRatio, seed: definition.seed, definitionHash: definition.definitionHash, contentKey: `test-geometry1-${randomUUID()}`, geometryVersion: 1 } }); }
    const variant = await L.db.puzzleVariant.create({ data: { definitionId: definition.id, pieceCount: 6, difficulty: "ADVENTURER", rulesVersion: 1 } });
    const engine = await import("../src/lib/puzzle/engine"); const geometry = L.geometry.createPuzzleGeometry(6, definition.seed, geometryVersion); const snapshot = engine.newPuzzleSnapshot(geometry, "ADVENTURER");
    snapshot.hints.push({ type: "LOCATION", at: new Date().toISOString(), extra: false }); snapshot.filter = "EDGES";
    await L.db.puzzleSession.update({ where: { id: current.id }, data: { variantId: variant.id, snapshot: JSON.stringify(snapshot) } });
    let old = await L.solo.startSoloPuzzle(u.id, index, 6, "ADVENTURER", "nl");
    assert.equal(old.id, current.id); assert.equal(old.rulesVersion, 1); assert.equal(old.geometryVersion, geometryVersion); assert.deepEqual(old.snapshot, snapshot);
    assert.deepEqual(await act(u.id, old, { kind: "anchor", groupId: "p0" }), old);
    for (const piece of geometry.pieces) old = await act(u.id, old, { kind: "move", groupId: `p${piece.id}`, x: 3 + piece.column, y: 3 + piece.row });
    for (const [a,b] of [[0,1],[1,2],[0,3],[3,4],[4,5]]) old = await act(u.id, old, { kind: "connect", a, b });
    assert.equal(old.status, "COMPLETED"); assert.equal((await L.solo.startSoloPuzzle(u.id, index, 6, "ADVENTURER", "nl")).id, old.id);
    await L.solo.answerSoloPuzzle(u.id, old.id, right(old)); const historical = await L.db.puzzleSession.findUniqueOrThrow({ where: { id: old.id } });
    const replay = await L.solo.startSoloPuzzle(u.id, index, 6, "ADVENTURER", "nl");
    assert.notEqual(replay.id, old.id); assert.equal(replay.rulesVersion, 2); assert.equal(replay.geometryVersion, 2); assert.equal(replay.snapshot.hints.length, 0);
    assert.deepEqual(await L.db.puzzleSession.findUniqueOrThrow({ where: { id: old.id } }), historical);
    assert.equal((await L.db.puzzlePersonalRecord.findUniqueOrThrow({ where: { sessionId: old.id }, include: { variant: true } })).variant.rulesVersion, 1);
  }
});

test("voltooiingskaart: de server levert alleen-lezen tijd, hintcategorie en bestaand record; een antwoord verandert de tijd nooit", { skip }, async () => {
  const user = await account(); const state = await solve(user.id, 3);
  const row = await L.db.puzzleSession.findUniqueOrThrow({ where: { id: state.id } });
  const view = (await L.solo.resumeSoloPuzzle(user.id, state.id, "nl"))!.completion;
  assert.ok(view, "voltooide sessie heeft een voltooiingsweergave");
  assert.equal(view.elapsedMs, row.completedAt!.getTime() - row.startedAt.getTime(), "dezelfde tijd als waarmee het record straks wordt vastgelegd");
  assert.equal(view.hintCategory, "NO_HINTS"); assert.equal(view.best, null, "nog geen record vóór het antwoord (Solo-record ontstaat bij een goed antwoord)");
  const before = JSON.stringify(await L.db.puzzleBestRecord.findMany({ where: { userId: user.id } })); assert.equal(before, "[]", "de weergave schrijft niets");
  const answered = await L.solo.answerSoloPuzzle(user.id, state.id, right(state)); assert.ok(answered && "correct" in answered && answered.correct);
  const after = (await L.solo.resumeSoloPuzzle(user.id, state.id, "nl"))!.completion!;
  assert.equal(after.elapsedMs, view.elapsedMs, "het antwoord verandert de puzzeltijd niet"); assert.ok(after.best && after.best.thisAttempt && after.best.elapsedMs === view.elapsedMs, "het bevestigde record komt uit deze poging");
  const open = await L.solo.startSoloPuzzle(user.id, 4, 6, "ADVENTURER", "nl"); assert.equal((open as { completion?: unknown }).completion, undefined, "een lopende puzzel heeft geen voltooiingsweergave");
});

test("voltooiingskaart: met een hint is de categorie Met hints en het bestaande record van die categorie wordt getoond", { skip }, async () => {
  const user = await account(); let state = await prepare(user.id, 5);
  state = await act(user.id, state, { kind: "hint", hint: "PREVIEW" }); state = await act(user.id, state, { kind: "connect", a: 4, b: 5 }); assert.equal(state.status, "COMPLETED");
  const variantId = (await L.db.puzzleSession.findUniqueOrThrow({ where: { id: state.id } })).variantId;
  const earlier = await L.db.puzzleSession.create({ data: { ownerId: user.id, variantId, status: "ANSWERED", snapshot: "{}", completedAt: new Date(Date.now() - 1000) } });
  await L.db.puzzleBestRecord.create({ data: { userId: user.id, variantId, mode: "SOLO", hintCategory: "WITH_HINTS", elapsedMs: 54_321, hintsUsed: 1, extraHintsUsed: 0, completedAt: new Date(), sessionId: earlier.id } });
  const view = (await L.solo.resumeSoloPuzzle(user.id, state.id, "nl"))!.completion!;
  assert.equal(view.hintCategory, "WITH_HINTS"); assert.deepEqual(view.best, { elapsedMs: 54_321, thisAttempt: false });
});

// Vaste momenten, geen sleeps of afhankelijkheid van de klok/tijdzone van de CI-runner.
// Reproduceert de oude browserfixture: Amsterdam als laatste dag, daarna UTC door TimeZoneSync.
test("browserfixture met Amsterdam/UTC-mismatch reproduceert reeks 4 bij de CI-daggrens", { skip }, async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-17T23:35:19Z").getTime() });
  const u = await account();
  assert.equal(u.lastStudyDate, "2026-10-17"); // In Amsterdam is het al 18 oktober.
  await L.db.user.update({ where: { id: u.id }, data: { timeZone: "UTC" } });
  const puzzle = await solve(u.id);
  const result = await L.solo.answerSoloPuzzle(u.id, puzzle.id, right(puzzle));
  assert.ok(result && "correct" in result && result.correct);
  assert.equal(result.streak?.dayEarned, false, "de reisregel geeft terecht geen gratis kalenderdag");
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: u.id } })).currentStreak, 4);
});

for (const [iso, day] of [
  ["2026-10-17T21:59:59.999Z", "2026-10-17"], // Amsterdam vóór middernacht
  ["2026-10-17T22:00:00.000Z", "2026-10-18"], // Amsterdam na middernacht
  ["2026-10-17T23:35:19.000Z", "2026-10-18"], // Exacte foutperiode uit CI
  ["2026-10-17T23:59:59.999Z", "2026-10-18"], // UTC vóór middernacht
  ["2026-10-18T00:00:00.000Z", "2026-10-18"], // UTC na middernacht
  ["2026-03-29T00:59:59.999Z", "2026-03-29"], // Amsterdam 01:59, vóór zomertijd
  ["2026-03-29T01:00:00.000Z", "2026-03-29"], // Amsterdam 03:00, na zomertijd
  ["2026-10-25T00:59:59.999Z", "2026-10-25"], // Amsterdam 02:59, vóór wintertijd
  ["2026-10-25T01:00:00.000Z", "2026-10-25"], // Amsterdam opnieuw 02:00
  ["2026-12-10T22:59:59.999Z", "2026-12-10"], // Winter: vóór lokale middernacht
  ["2026-12-10T23:00:00.000Z", "2026-12-11"], // Winter: na lokale middernacht
]) {
  test(`Amsterdam-fixture verlengt reeks 4 naar 5 op ${iso}`, { skip }, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: new Date(iso).getTime() });
    const u = await account();
    assert.equal(dayKeyInZone(new Date(), u.timeZone!), day);
    assert.equal(u.lastStudyDate, addDays(day, -1));
    const puzzle = await solve(u.id);
    const result = await L.solo.answerSoloPuzzle(u.id, puzzle.id, right(puzzle));
    assert.ok(result && "correct" in result && result.correct);
    assert.equal(result.streak?.dayEarned, true);
    const saved = await L.db.user.findUniqueOrThrow({ where: { id: u.id } });
    assert.equal(saved.currentStreak, 5);
    assert.equal(saved.lastStudyDate, day);
    assert.equal(saved.lastStudyTimeZone, "Europe/Amsterdam");
  });
}
