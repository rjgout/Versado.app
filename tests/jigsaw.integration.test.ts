import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { addDays } from "../src/lib/dates";
import { dayKeyInZone } from "../src/lib/timeZone";

// Draait alleen met een eigen testdatabase; nooit tegen productie.
const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret";
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  game: await import("../src/lib/jigsawGame"),
  bank: await import("../src/lib/jigsawQuestions"),
  grid: await import("../src/lib/jigsaw"),
});
let L: Awaited<ReturnType<typeof load>>;
const ids: string[] = [];
before(async () => { if (!skip) L = await load(); });
after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { id: { in: ids } } });
  await L.db.$disconnect();
});

async function account() {
  const user = await L.db.user.create({ data: {
    email: `puzzel-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Puz${randomUUID().slice(0, 8)}`, discriminator: "00",
    currentStreak: 4, longestStreak: 4, timeZone: "Europe/Amsterdam", lastStudyDate: addDays(dayKeyInZone(new Date(), "Europe/Amsterdam"), -1), lastStudyTimeZone: "Europe/Amsterdam",
  } });
  ids.push(user.id);
  return user;
}
const get = (id: string) => L.db.user.findUniqueOrThrow({ where: { id } });

async function solved(userId: string, imageIndex: number, pieces: 6 | 12 | 24 | 48) {
  const start = await L.game.startJigsaw(userId, imageIndex, pieces);
  const { columns, rows } = L.grid.jigsawGrid(pieces);
  let current = start;
  for (const piece of start.order) {
    current = (await L.game.placeJigsawPiece(userId, current.token, piece, ((piece % columns) + 0.5) / columns, (Math.floor(piece / columns) + 0.5) / rows, "nl"))!;
  }
  assert.ok(current.complete && current.question);
  // Het juiste antwoord staat in het bronbestand altijd eerst; zoek zijn getoonde plek.
  const bank = L.bank.jigsawQuestionsForStory(L.game.jigsawCatalog[imageIndex].story).find((q) => q.text.nl === current.question!.text)!;
  const right = current.question!.options.indexOf(bank.options.nl[0]);
  assert.ok(right >= 0);
  return { state: current, right, wrong: [0, 1, 2].find((i) => i !== right)! };
}

test("een goed antwoord telt eenmalig als reeksactiviteit en geeft geen XP", { skip }, async () => {
  const u = await account();
  const before = await get(u.id);
  const { state, right } = await solved(u.id, 0, 6);
  const outcome = await L.game.answerJigsaw(u.id, state.token, right);
  assert.equal(outcome.status, "ok");
  if (outcome.status !== "ok") return;
  assert.equal(outcome.result.correct, true);
  assert.equal(outcome.result.counted, true);
  assert.equal(outcome.result.streak?.dayEarned, true);
  const after = await get(u.id);
  assert.equal(after.currentStreak, 5);
  assert.equal(after.xpTotal, before.xpTotal, "de puzzel geeft geen XP");
  assert.equal(await L.db.streakActivity.count({ where: { userId: u.id, key: { startsWith: "jigsaw:" } } }), 1);
  // Hetzelfde antwoord opnieuw sturen telt niet nog een keer.
  assert.equal((await L.game.answerJigsaw(u.id, state.token, right)).status, "already-answered");
  assert.equal((await get(u.id)).currentStreak, 5);
});

test("een fout antwoord is definitief: geen reeks, juist antwoord getoond, geen tweede kans", { skip }, async () => {
  const u = await account();
  const { state, right, wrong } = await solved(u.id, 4, 12);
  const outcome = await L.game.answerJigsaw(u.id, state.token, wrong);
  assert.equal(outcome.status, "ok");
  if (outcome.status !== "ok") return;
  assert.equal(outcome.result.correct, false);
  assert.equal(outcome.result.counted, false);
  assert.equal(outcome.result.streak, null);
  assert.equal(outcome.result.correctChoice, right);
  assert.equal((await get(u.id)).currentStreak, 4);
  // Met hetzelfde token alsnog het goede antwoord proberen werkt niet.
  assert.equal((await L.game.answerJigsaw(u.id, state.token, right)).status, "already-answered");
  assert.equal((await get(u.id)).currentStreak, 4);
});

test("een onvolledige of vervalste puzzel kan geen antwoord geven", { skip }, async () => {
  const u = await account();
  const start = await L.game.startJigsaw(u.id, 2, 6);
  assert.equal((await L.game.answerJigsaw(u.id, start.token, 0)).status, "incomplete");
  assert.equal((await L.game.answerJigsaw(u.id, start.token + "x", 0)).status, "invalid");
  const other = await account();
  const { state, right } = await solved(u.id, 2, 6);
  assert.equal((await L.game.answerJigsaw(other.id, state.token, right)).status, "invalid", "token van een ander");
  assert.equal((await get(u.id)).currentStreak, 4);
});

test("dezelfde dag: de tweede puzzel telt als activiteit maar verlengt de reeks niet", { skip }, async () => {
  const u = await account();
  const first = await solved(u.id, 0, 6);
  await L.game.answerJigsaw(u.id, first.state.token, first.right);
  const second = await solved(u.id, 9, 6);
  const outcome = await L.game.answerJigsaw(u.id, second.state.token, second.right);
  assert.equal(outcome.status, "ok");
  if (outcome.status === "ok") {
    assert.equal(outcome.result.streak?.dayEarned, false);
    assert.equal(outcome.result.streak?.alreadyStudiedToday, true);
  }
  assert.equal((await get(u.id)).currentStreak, 5);
});

test("6 en 48 stukjes leveren dezelfde reeksactiviteit op", { skip }, async () => {
  for (const pieces of [6, 48] as const) {
    const u = await account();
    const game = await solved(u.id, 1, pieces);
    const outcome = await L.game.answerJigsaw(u.id, game.state.token, game.right);
    assert.equal(outcome.status === "ok" && outcome.result.counted, true, `${pieces} stukjes`);
    assert.equal((await get(u.id)).currentStreak, 5);
  }
});
