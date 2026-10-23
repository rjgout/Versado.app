import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quickMissionaryFixture } from "./fixtures/quick-missionary";
import { addDays } from "../src/lib/dates";
import { dayKeyInZone } from "../src/lib/timeZone";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";
const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  search: await import("../src/lib/wordSearch/game"),
  runs: await import("../src/lib/snelleZendeling/runs"),
});
let L: Awaited<ReturnType<typeof load>>;
const users: string[] = [];
before(async () => {
  if (skip) return;
  L = await load();
  await L.db.$transaction((tx) => quickMissionaryFixture(tx));
});
after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { id: { in: users } } });
  await L.db.$disconnect();
});
async function account() {
  const user = await L.db.user.create({ data: {
    email: `activity-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `A${randomUUID().slice(0, 8)}`, discriminator: "00",
    timeZone: "Europe/Amsterdam", activeContentCollectionId: "content_bom", currentStreak: 4, longestStreak: 4,
    lastStudyDate: addDays(dayKeyInZone(new Date(), "Europe/Amsterdam"), -1), lastStudyTimeZone: "Europe/Amsterdam",
  } });
  users.push(user.id);
  return user;
}
const get = (id: string) => L.db.user.findUniqueOrThrow({ where: { id } });
async function search(userId: string) {
  return L.db.wordSearchGame.create({ data: {
    userId, contentCollectionId: "content_bom", difficulty: "EASY", size: 4, seed: 1,
    grid: JSON.stringify([["A", "L", "M", "A"], ["L", "E", "H", "I"], ["X", "X", "X", "X"], ["X", "X", "X", "X"]]),
    words: JSON.stringify([
      { display: "ALMA", normalized: "ALMA", start: { row: 0, col: 0 }, end: { row: 0, col: 3 } },
      { display: "LEHI", normalized: "LEHI", start: { row: 1, col: 0 }, end: { row: 1, col: 3 } },
    ]),
  } });
}

test("Woordzoeker: alleen voltooiing telt, ook zonder XP; gelijktijdige retries tellen eenmaal", { skip }, async () => {
  const u = await account();
  for (let i = 0; i < 3; i++) {
    const old = await search(u.id);
    await L.db.wordSearchGame.update({ where: { id: old.id }, data: { status: "COMPLETED", xpEarned: 1, finishedAt: new Date() } });
  }
  const game = await search(u.id);
  await L.search.findWordSearchWord(u.id, game.id, { row: 3, col: 0 }, { row: 3, col: 3 });
  await L.search.findWordSearchWord(u.id, game.id, { row: 0, col: 0 }, { row: 0, col: 3 });
  assert.equal((await get(u.id)).currentStreak, 4);
  const responses = await Promise.all(Array.from({ length: 3 }, () =>
    L.search.findWordSearchWord(u.id, game.id, { row: 1, col: 0 }, { row: 1, col: 3 })));
  assert.ok(responses.every((response) => response?.view.status === "COMPLETED"));
  assert.equal((await get(u.id)).currentStreak, 5);
  assert.equal((await get(u.id)).xpTotal, 0);
  assert.equal(await L.db.streakActivity.count({ where: { userId: u.id } }), 1);
  assert.equal(await L.db.streakDay.count({ where: { userId: u.id } }), 1);
});

test("Snelle Zendeling: starten/sluiten telt niet; een botsing met nul punten telt bij afronding eenmaal", { skip }, async () => {
  const u = await account();
  const empty = await L.runs.startQuickMissionaryRun(u.id);
  await L.runs.finishQuickMissionaryRun(empty.runId, u.id, 0);
  assert.equal((await get(u.id)).currentStreak, 4);
  const played = await L.runs.startQuickMissionaryRun(u.id);
  await L.runs.reportDeath(played.runId, u.id, 0);
  assert.equal((await get(u.id)).currentStreak, 4, "nog niet definitief afgerond");
  await Promise.all(Array.from({ length: 3 }, () => L.runs.finishQuickMissionaryRun(played.runId, u.id, 0)));
  assert.equal((await get(u.id)).currentStreak, 5);
  assert.equal((await get(u.id)).xpTotal, 0);
  assert.equal(await L.db.streakActivity.count({ where: { userId: u.id } }), 1);
});

test("Snelle Zendeling: ongeldige score geeft geen reeksactiviteit", { skip }, async () => {
  const u = await account();
  const run = await L.runs.startQuickMissionaryRun(u.id);
  await assert.rejects(L.runs.finishQuickMissionaryRun(run.runId, u.id, 10_000));
  assert.equal((await get(u.id)).currentStreak, 4);
  assert.equal(await L.db.streakActivity.count({ where: { userId: u.id } }), 0);
});
