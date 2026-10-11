import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url && (new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/versado_word_hint_test")) throw new Error("Gebruik uitsluitend de Woord-van-de-Dag-wegwerpdatabase");
if (url) process.env.DATABASE_URL = url;
const skip = !url && "Gebruik test:word-game-hints:integration";
const load = async () => ({ db: (await import("../src/lib/db")).prisma, game: await import("../src/lib/wordGame"), hints: await import("../src/lib/wordGameHints"), shop: await import("../src/lib/shop"), realtime: await import("../src/lib/realtime") });
let L: Awaited<ReturnType<typeof load>>;
const users: string[] = [];
const days = new Set<string>();
const now = new Date("2099-03-04T19:00:00Z");
before(async () => { if (!skip) L = await load(); });
after(async () => { if (!skip) { await L.db.user.deleteMany({ where: { id: { in: users } } }); await L.db.dailyWord.deleteMany({ where: { dayKey: { in: [...days] } } }); await L.db.$disconnect(); } });
async function account(balance = 8) {
  const user = await L.db.user.create({ data: { email: `word-hint-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `W${randomUUID().slice(0, 8)}`, discriminator: "00", hintBalance: balance, timeZone: "UTC", xpTotal: 100 } });
  users.push(user.id); return user;
}
async function start(userId: string, at = now) {
  const view = await L.game.getOrCreateTodayGame(userId, "UTC", at); days.add(view.dayKey); return view;
}
async function buy(userId: string, gameId: string, level: number, at = now, actionId = randomUUID()) {
  return L.hints.buyWordGameHint(userId, { gameId, expectedLevel: level, actionId }, at);
}
function rejected(code: string) { return (error: unknown) => error instanceof L.hints.WordGameHintError && error.code === code; }

test("alle vijf niveaus kosten precies één hint, blijven stabiel en wijzigen geen gameplay of beloning", { skip }, async () => {
  const user = await account(); let game = await start(user.id);
  assert.equal(game.hints.level, 0); assert.deepEqual(game.hints.candidates, []); assert.equal(game.word, null);
  const target = (await L.db.wordGame.findUniqueOrThrow({ where: { id: game.id } })).word;
  const expected = [716, 180, 50, 15, 5]; let previous: string[] = [];
  for (let level = 0; level < 5; level++) {
    const at = new Date(now.getTime() + level * 3_600_000);
    const paid = await buy(user.id, game.id, level, at); game = paid.game;
    assert.equal(paid.hintBalance, 7 - level); assert.equal(game.hints.level, level + 1); assert.equal(game.hints.candidates.length, expected[level]);
    assert.ok(game.hints.candidates.includes(target)); assert.deepEqual(game.hints.candidates, [...game.hints.candidates].sort());
    if (level) assert.ok(game.hints.candidates.every((word) => previous.includes(word)));
    previous = game.hints.candidates;
    assert.deepEqual((await start(user.id, at)).hints, game.hints);
    assert.equal(game.maxGuesses, 6); assert.equal(game.wordLength, 5); assert.equal(game.word, null); assert.deepEqual(game.guesses, []);
    assert.equal("hintPools" in game, false); assert.equal("hintPurchases" in game, false);
    assert.deepEqual(Object.keys(game.hints).sort(), ["candidates", "level", "nextCount", "nextHintAt"]);
  }
  await assert.rejects(buy(user.id, game.id, 5, new Date(now.getTime() + 5 * 3_600_000)), rejected("MAX_LEVEL"));
  const current = await L.db.user.findUniqueOrThrow({ where: { id: user.id } }); assert.equal(current.xpTotal, 100); assert.equal(current.currentStreak, 0);
  assert.equal(await L.db.streakActivity.count({ where: { userId: user.id } }), 0);
  assert.equal(await L.db.xPTransaction.count({ where: { userId: user.id } }), 0);
  const record = await L.db.wordGame.findUniqueOrThrow({ where: { id: game.id } });
  assert.equal(JSON.parse(record.hintPurchases).length, 5); assert.equal(record.leaderboardXpBonus, 0);
});

test("60 minuten is een exacte voortschrijdende grens; raden blijft mogelijk", { skip }, async () => {
  const user = await account(); const game = await start(user.id); const first = await buy(user.id, game.id, 0);
  assert.equal(first.game.hints.nextHintAt, "2099-03-04T20:00:00.000Z");
  await assert.rejects(buy(user.id, game.id, 1, new Date(now.getTime() + 3_599_999)), rejected("COOLDOWN"));
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: user.id } })).hintBalance, 7);
  const target = (await L.db.wordGame.findUniqueOrThrow({ where: { id: game.id } })).word;
  const wrong = L.game.WORD_GAME_WORDS.find((word) => word !== target)!;
  const guessed = await L.game.submitGuess(user.id, wrong, "UTC", new Date(now.getTime() + 10_000));
  assert.ok(!("error" in guessed)); assert.equal(guessed.guesses.length, 1); assert.equal(guessed.hints.level, 1);
  const second = await buy(user.id, game.id, 1, new Date(now.getTime() + 3_600_000));
  assert.equal(second.hintBalance, 6); assert.equal(second.game.guesses.length, 1);
});

test("leeg saldo, verkeerde eigenaar, payload en versie schrijven niets af", { skip }, async () => {
  const user = await account(0); const other = await account(); const game = await start(user.id);
  await assert.rejects(buy(user.id, game.id, 0), rejected("EMPTY"));
  await assert.rejects(buy(other.id, game.id, 0), rejected("NOT_FOUND"));
  await assert.rejects(buy(user.id, game.id, 1), rejected("CONFLICT"));
  assert.equal(L.hints.wordGameHintRequestSchema.safeParse({ gameId: game.id, actionId: randomUUID(), expectedLevel: 0, now: now.toISOString(), candidates: ["nephi"] }).success, false);
  assert.equal((await start(user.id)).hints.level, 0); assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: other.id } })).hintBalance, 8);
  await L.db.user.update({ where: { id: user.id }, data: { hintBalance: 1 } });
  assert.equal((await buy(user.id, game.id, 0)).hintBalance, 0);
  await assert.rejects(buy(user.id, game.id, 1, new Date(now.getTime() + 3_600_000)), rejected("EMPTY"));
});

test("dezelfde actionId, verloren response en parallelle tabbladen worden slechts eenmaal betaald", { skip }, async () => {
  const user = await account(); const game = await start(user.id); const actionId = randomUUID();
  const replies = await Promise.all(Array.from({ length: 5 }, () => buy(user.id, game.id, 0, now, actionId)));
  assert.equal(replies.filter((reply) => !reply.replayed).length, 1); assert.ok(replies.every((reply) => reply.game.hints.level === 1 && reply.hintBalance === 7));
  const retry = await buy(user.id, game.id, 0, now, actionId); assert.equal(retry.replayed, true); assert.equal(retry.hintBalance, 7);
  await assert.rejects(buy(user.id, game.id, 1, now, actionId), rejected("CONFLICT"));
  const at = new Date(now.getTime() + 3_600_000);
  const parallel = await Promise.allSettled(Array.from({ length: 5 }, () => buy(user.id, game.id, 1, at)));
  assert.equal(parallel.filter((reply) => reply.status === "fulfilled").length, 1);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: user.id } })).hintBalance, 6);
  assert.equal(JSON.parse((await L.db.wordGame.findUniqueOrThrow({ where: { id: game.id } })).hintPurchases).length, 2);
});

test("een nieuwe woorddag reset de progressie en nooit de accountbrede cooldown", { skip }, async () => {
  const user = await account(); const at = new Date("2099-03-04T17:47:30Z"); const old = await start(user.id, at);
  const actionId = randomUUID(); await buy(user.id, old.id, 0, at, actionId);
  const nextAt = new Date("2099-03-04T18:00:00Z"); const next = await start(user.id, nextAt);
  assert.notEqual(old.id, next.id); assert.equal(next.hints.level, 0); assert.deepEqual(next.hints.candidates, []);
  assert.equal(next.hints.nextHintAt, "2099-03-04T18:47:30.000Z");
  await assert.rejects(buy(user.id, next.id, 0, nextAt), rejected("COOLDOWN"));
  await assert.rejects(buy(user.id, old.id, 1, nextAt), rejected("DAY_CHANGED"));
  const retry = await buy(user.id, old.id, 0, nextAt, actionId); assert.equal(retry.replayed, true); assert.equal(retry.game.id, next.id); assert.equal(retry.hintBalance, 7);
  const paid = await buy(user.id, next.id, 0, new Date("2099-03-04T18:47:30Z")); assert.equal(paid.hintBalance, 6); assert.equal(paid.game.hints.candidates.length, 716);
  assert.equal((await L.db.wordGame.findUniqueOrThrow({ where: { id: old.id } })).hintLevel, 1);
});

test("een databasefout rolt voorraad, kandidaten en cooldown gezamenlijk terug", { skip }, async () => {
  const user = await account(); const game = await start(user.id); const actionId = randomUUID();
  await L.db.$executeRawUnsafe(`CREATE FUNCTION word_hint_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."id" = '${game.id}' AND NEW."hintLevel" > OLD."hintLevel" THEN RAISE EXCEPTION 'woordhint-testfout'; END IF; RETURN NEW; END $$`);
  await L.db.$executeRawUnsafe('CREATE TRIGGER word_hint_test_failure BEFORE UPDATE ON "WordGame" FOR EACH ROW EXECUTE FUNCTION word_hint_test_failure()');
  try { await assert.rejects(buy(user.id, game.id, 0, now, actionId), /woordhint-testfout/); }
  finally { await L.db.$executeRawUnsafe('DROP TRIGGER word_hint_test_failure ON "WordGame"'); await L.db.$executeRawUnsafe('DROP FUNCTION word_hint_test_failure()'); }
  const current = await L.db.user.findUniqueOrThrow({ where: { id: user.id } }); assert.equal(current.hintBalance, 8); assert.equal(current.wordGameLastHintAt, null);
  const record = await L.db.wordGame.findUniqueOrThrow({ where: { id: game.id } }); assert.equal(record.hintLevel, 0); assert.equal(record.hintPools, null); assert.equal(record.hintPurchases, "[]");
  assert.equal((await buy(user.id, game.id, 0, now, actionId)).hintBalance, 7);
});

test("gewonnen/verloren potjes blokkeren hints en behouden betaalde lijsten en normale XP", { skip }, async () => {
  for (const won of [true, false]) {
    const user = await account(); let game = await start(user.id); game = (await buy(user.id, game.id, 0)).game;
    const target = (await L.db.wordGame.findUniqueOrThrow({ where: { id: game.id } })).word;
    const wrong = L.game.WORD_GAME_WORDS.find((word) => word !== target)!;
    for (let i = 0; i < (won ? 1 : 6); i++) {
      const result = await L.game.submitGuess(user.id, won ? target : wrong, "UTC", now); assert.ok(!("error" in result)); game = result;
    }
    assert.equal(game.status, won ? "WON" : "LOST"); assert.equal(game.word, target); assert.equal(game.hints.candidates.length, 716);
    assert.equal(game.xpEarned, won ? 50 : 0); assert.equal(game.guesses.length, won ? 1 : 6);
    await assert.rejects(buy(user.id, game.id, 1, new Date(now.getTime() + 3_600_000)), rejected("FINISHED"));
    assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: user.id } })).hintBalance, 7);
    // Bestaande regel: het afronden telt ook bij verlies als gespeelde activiteit.
    assert.equal(await L.db.streakActivity.count({ where: { userId: user.id } }), 1);
    assert.equal((await L.game.getWordGameRanking(user.id, "UTC", now)).provisionalRank !== null, won);
  }
});

test("verouderde selectie wordt afgewezen vóór betaling en de winkel blijft dezelfde voorraad", { skip }, async () => {
  const user = await account(0); const game = await start(user.id);
  const bought = await L.shop.buyHints(user.id, 1); assert.ok(bought.ok); assert.equal(bought.hintBalance, 1); assert.equal(L.shop.HINT_PRICE_XP, 50);
  await L.db.wordGame.update({ where: { id: game.id }, data: { hintLevel: 1, hintPools: '{}', hintPurchases: JSON.stringify([{ actionId: randomUUID(), level: 1, at: now.toISOString() }]) } });
  await assert.rejects(buy(user.id, game.id, 1));
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: user.id } })).hintBalance, 1);
  await L.db.wordGame.update({ where: { id: game.id }, data: { hintLevel: 0, hintPools: null, hintPurchases: '[]' } });
  const paid = await buy(user.id, game.id, 0); assert.equal(paid.hintBalance, 0); assert.equal(paid.game.word, null);
  assert.equal((await L.db.user.findUniqueOrThrow({ where: { id: user.id } })).xpTotal, 50);
});

test("een andere geselecteerde contentbron vervangt nooit het doelwoordenboek", { skip }, async () => {
  const user = await account(); await L.db.user.update({ where: { id: user.id }, data: { activeContentCollectionId: "content_dc" } });
  const game = await start(user.id); const paid = await buy(user.id, game.id, 0);
  assert.deepEqual(paid.game.hints.candidates, [...L.game.WORD_GAME_WORDS].sort());
  assert.equal(paid.game.hints.candidates.length, 716);
});
