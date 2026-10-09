// Integratietest voor het woord van de dag met tijdzones, tegen een echte
// Postgres-database. Draait alleen met LEARNING_TEST_DATABASE_URL; gebruikt
// woorddagen ver in de toekomst en ruimt eigen gebruikers en woorden op.
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npm run test:time
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  game: await import("../src/lib/wordGame"),
});
let L: Awaited<ReturnType<typeof load>>;
const users: Record<string, string> = {};
const DAY = "2031-03-04";
const NEXT = "2031-03-05";

before(async () => {
  if (skip) return;
  L = await load();
  for (const name of ["nl", "tokio", "ny"]) {
    const u = await L.db.user.create({
      data: { email: `woord-${name}-${Date.now()}@test.invalid`, passwordHash: "x", handle: `Woord${name}`, discriminator: String(1000 + Math.floor(Math.random() * 9000)) },
    });
    users[name] = u.id;
  }
  await L.db.dailyWord.deleteMany({ where: { dayKey: { in: [DAY, NEXT] } } });
});

after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { id: { in: Object.values(users) } } });
  await L.db.dailyWord.deleteMany({ where: { dayKey: { in: [DAY, NEXT] } } });
  await L.db.$disconnect();
});

test("17:59 / 18:00 / 18:01 lokaal en hetzelfde woord in elke tijdzone", { skip }, async () => {
  const before = await L.game.getOrCreateTodayGame(users.nl, "Europe/Amsterdam", new Date("2031-03-04T16:59:00Z")); // NL 17:59
  assert.equal(before.dayKey, "2031-03-03");
  assert.equal(before.nextReleaseDay, "today");
  const nl = await L.game.getOrCreateTodayGame(users.nl, "Europe/Amsterdam", new Date("2031-03-04T17:00:00Z")); // NL 18:00
  assert.equal(nl.dayKey, DAY);
  assert.equal(nl.nextReleaseAt, "2031-03-05T17:00:00.000Z");
  assert.equal(nl.nextReleaseDay, "tomorrow");
  assert.equal(nl.bonusSettlesAt, "2031-03-06T06:00:00.000Z");
  const tokyo = await L.game.getOrCreateTodayGame(users.tokio, "Asia/Tokyo", new Date("2031-03-04T09:01:00Z")); // Tokio 18:01
  assert.equal(tokyo.dayKey, DAY);
  const ny = await L.game.getOrCreateTodayGame(users.ny, "America/New_York", new Date("2031-03-04T23:30:00Z")); // NY 18:30
  assert.equal(ny.dayKey, DAY);
  const words = await L.db.wordGame.findMany({ where: { dayKey: DAY }, select: { word: true, releasedAt: true, userId: true } });
  assert.equal(new Set(words.map((w) => w.word)).size, 1, "iedereen hetzelfde woord");
  assert.equal(words.find((w) => w.userId === users.tokio)!.releasedAt!.toISOString(), "2031-03-04T09:00:00.000Z");
  assert.equal(words.find((w) => w.userId === users.nl)!.releasedAt!.toISOString(), "2031-03-04T17:00:00.000Z");
  await L.db.wordGame.deleteMany({ where: { userId: users.nl, dayKey: "2031-03-03" } });
  await L.db.dailyWord.deleteMany({ where: { dayKey: "2031-03-03" } });
});

test("refresh, opnieuw inloggen en meerdere apparaten: hetzelfde potje", { skip }, async () => {
  const a = await L.game.getOrCreateTodayGame(users.nl, "Europe/Amsterdam", new Date("2031-03-04T18:10:00Z"));
  const b = await L.game.getOrCreateTodayGame(users.nl, "Europe/Amsterdam", new Date("2031-03-04T20:45:00Z"));
  assert.equal(a.dayKey, b.dayKey);
  assert.equal(await L.db.wordGame.count({ where: { userId: users.nl, dayKey: DAY } }), 1);
});

test("klassement en rangbonus: tijd na de eigen 18:00, pas uitbetaald na afloop", { skip }, async () => {
  const word = (await L.db.dailyWord.findUniqueOrThrow({ where: { dayKey: DAY } })).word;
  // Tokio raadt om 19:30 lokaal (10:30Z, absoluut veel eerder) = 90 min na zijn 18:00.
  const tokyo = await L.game.submitGuess(users.tokio, word, "Asia/Tokyo", new Date("2031-03-04T10:30:00Z"));
  assert.ok(!("error" in tokyo));
  // Nederland raadt om 18:05 lokaal (17:05Z) = 5 min na zijn 18:00.
  const nl = await L.game.submitGuess(users.nl, word, "Europe/Amsterdam", new Date("2031-03-04T17:05:00Z"));
  assert.ok(!("error" in nl));
  if ("error" in nl || "error" in tokyo) return;
  // Bij het raden: alleen de gewone XP, geen rang of bonus; wel de voorlopige plek.
  assert.equal(tokyo.provisionalRank, 1); // toen de enige
  assert.equal(nl.provisionalRank, 1);
  assert.equal(nl.settled, false);
  assert.equal(nl.leaderboardRank, null);
  assert.equal(nl.xpEarned, L.game.xpForWin(1));
  assert.deepEqual(nl.leaderboard.map((e) => [e.userId, e.minutesAfterRelease]), [[users.nl, 5], [users.tokio, 90]]);
  // De tijd staat als klokslag op de eigen klok van de speler (18:00 + minuten), los van de tijdzone.
  assert.deepEqual(nl.leaderboard.map((e) => e.solvedClock), ["18:05", "19:30"]);

  // Vóór het sluiten van de woorddag (D+2 06:00 UTC): nog niets uitbetaald.
  assert.equal(L.game.wordDayClosesAt(DAY).toISOString(), "2031-03-06T06:00:00.000Z");
  const early = await L.game.settleWordGameBonuses(new Date("2031-03-06T05:59:00Z"));
  assert.equal(early.filter((b) => b.dayKey === DAY).length, 0);

  // Daarna: precies één #1, en de bonus-XP in de XP-geschiedenis.
  const paid = (await L.game.settleWordGameBonuses(new Date("2031-03-06T06:00:00Z"))).filter((b) => b.dayKey === DAY);
  assert.deepEqual(paid.map((b) => [b.userId, b.rank, b.xp]), [[users.nl, 1, 50], [users.tokio, 2, 40]]);
  const games = await L.db.wordGame.findMany({ where: { dayKey: DAY, status: "WON" }, select: { userId: true, leaderboardRank: true, leaderboardXpBonus: true, xpEarned: true } });
  assert.deepEqual(games.find((g) => g.userId === users.nl), { userId: users.nl, leaderboardRank: 1, leaderboardXpBonus: 50, xpEarned: L.game.xpForWin(1) + 50 });
  const bonusTx = await L.db.xPTransaction.findMany({ where: { userId: { in: [users.nl, users.tokio] }, reason: "WORD_GAME_WON" }, select: { amount: true } });
  assert.deepEqual(bonusTx.map((x) => x.amount).sort((a, b) => a - b), [40, 50, L.game.xpForWin(1), L.game.xpForWin(1)].sort((a, b) => a - b));

  // Nog een keer afhandelen doet niets.
  const again = (await L.game.settleWordGameBonuses(new Date("2031-03-06T07:00:00Z"))).filter((b) => b.dayKey === DAY);
  assert.equal(again.length, 0);
  assert.equal(await L.db.xPTransaction.count({ where: { userId: users.nl, reason: "WORD_GAME_WON" } }), 2);

  // De volgende woorddag toont de uitslag van deze.
  const next = await L.game.getOrCreateTodayGame(users.nl, "Europe/Amsterdam", new Date("2031-03-06T08:00:00Z")); // NL 09:00 = woorddag 5 maart
  assert.equal(next.dayKey, NEXT);
  assert.deepEqual(next.previousResult, { dayKey: DAY, rank: 1, xp: 50 });
});

test("toestelklok doet niets: de server bepaalt de woorddag", { skip }, async () => {
  // De API geeft getOrCreateTodayGame geen tijd van de client mee; met de
  // echte servertijd blijft de woorddag die van nu, hoe de toestelklok ook staat.
  const view = await L.game.getOrCreateTodayGame(users.ny, "America/New_York");
  assert.equal(view.dayKey, L.game.wordGameDayKey(new Date(), "America/New_York"));
  assert.ok(Math.abs(view.serverNow - Date.now()) < 5_000);
  await L.db.wordGame.deleteMany({ where: { userId: users.ny, dayKey: view.dayKey } });
});
