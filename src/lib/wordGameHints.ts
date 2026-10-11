import { z } from "zod";
import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";
import { getOrCreateTodayGame, WORD_GAME_WORDS, wordGameDayKey } from "@/lib/wordGame";
import { createWordGameHintPools, readWordGameHintPools, WORD_GAME_HINT_COOLDOWN_MS } from "@/lib/wordGameHintRules";

export const wordGameHintRequestSchema = z.object({
  gameId: z.string().min(1).max(100),
  actionId: z.string().uuid(),
  expectedLevel: z.number().int().min(0).max(5),
}).strict();
export type WordGameHintRequest = z.infer<typeof wordGameHintRequestSchema>;
const purchasesSchema = z.array(z.object({ actionId: z.string().uuid(), level: z.number().int().min(1).max(5), at: z.string().datetime() }).strict()).max(5);

export class WordGameHintError extends Error {
  constructor(readonly code: "NOT_FOUND" | "DAY_CHANGED" | "FINISHED" | "MAX_LEVEL" | "COOLDOWN" | "EMPTY" | "CONFLICT" | "INVALID_STATE", readonly nextHintAt: string | null = null, readonly serverNow = Date.now()) { super(code); }
}

/** Lockvolgorde potje → gebruiker, zoals bestaande sessie-/voorraadmutations. */
export async function buyWordGameHint(userId: string, request: WordGameHintRequest, testNow?: Date) {
  const input = wordGameHintRequestSchema.parse(request);
  let changed = false;
  const result = await prisma.$transaction(async (tx) => {
    const owned = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "WordGame" WHERE "id" = ${input.gameId} AND "userId" = ${userId} FOR UPDATE`;
    if (!owned.length) throw new WordGameHintError("NOT_FOUND");
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const game = await tx.wordGame.findUniqueOrThrow({ where: { id: input.gameId } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { hintBalance: true, wordGameLastHintAt: true, timeZone: true } });
    // Pas na eventuele lockwachttijd: de request-/toestelklok is geen betaalmoment.
    const now = testNow ?? new Date();
    const purchases = purchasesSchema.parse(JSON.parse(game.hintPurchases));
    if (purchases.length !== game.hintLevel || purchases.some((purchase, index) => purchase.level !== index + 1) || new Set(purchases.map((purchase) => purchase.actionId)).size !== purchases.length) throw new WordGameHintError("INVALID_STATE");
    const previous = purchases.find((purchase) => purchase.actionId === input.actionId);
    // Ook na afronden/dagwissel kan een verloren betaalresponse veilig herstellen.
    if (previous) {
      if (previous.level !== input.expectedLevel + 1) throw new WordGameHintError("CONFLICT");
      return { hintBalance: user.hintBalance, replayed: true, timeZone: user.timeZone, now };
    }
    if (game.dayKey !== wordGameDayKey(now, user.timeZone ?? undefined)) throw new WordGameHintError("DAY_CHANGED");
    if (game.status !== "IN_PROGRESS") throw new WordGameHintError("FINISHED");
    const pools = game.hintPools ? readWordGameHintPools(game.hintPools, game.word) : createWordGameHintPools(WORD_GAME_WORDS, game.word);
    if (game.hintLevel >= pools.lists.length) throw new WordGameHintError("MAX_LEVEL");
    if (game.hintLevel !== input.expectedLevel) throw new WordGameHintError("CONFLICT");
    const availableAt = user.wordGameLastHintAt ? new Date(user.wordGameLastHintAt.getTime() + WORD_GAME_HINT_COOLDOWN_MS) : null;
    if (availableAt && now < availableAt) throw new WordGameHintError("COOLDOWN", availableAt.toISOString(), now.getTime());
    const paid = await tx.user.updateMany({ where: { id: userId, hintBalance: { gt: 0 } }, data: { hintBalance: { decrement: 1 }, wordGameLastHintAt: now } });
    if (paid.count !== 1) throw new WordGameHintError("EMPTY");
    const level = game.hintLevel + 1;
    await tx.wordGame.update({ where: { id: game.id }, data: { hintLevel: level, hintPools: JSON.stringify(pools), hintPurchases: JSON.stringify([...purchases, { actionId: input.actionId, level, at: now.toISOString() }]) } });
    changed = true;
    return { hintBalance: user.hintBalance - 1, replayed: false, timeZone: user.timeZone, now };
  });
  // Alle apparaten verversen potje én dezelfde centrale voorraad, uitsluitend na commit.
  if (changed) emitToUser(userId, "hints_changed");
  return { game: await getOrCreateTodayGame(userId, result.timeZone, result.now), hintBalance: result.hintBalance, replayed: result.replayed };
}
