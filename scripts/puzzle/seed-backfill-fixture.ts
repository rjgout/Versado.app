// Vult een WEGWERP-testdatabase met representatieve historische puzzelgegevens (vóór fase 4) om de records-backfill
// te oefenen. Nooit tegen productie: weigert alles behalve een database met "test" of "demo" in de naam.
//   DATABASE_URL=postgresql://.../backfill_demo npx tsx scripts/puzzle/seed-backfill-fixture.ts
import { randomUUID } from "node:crypto";
const url = process.env.DATABASE_URL ?? "";
if (!/(test|demo)/i.test(new URL(url).pathname)) throw new Error("Alleen een wegwerp-testdatabase");
process.env.SESSION_SECRET ??= "fixture-secret-fixture-secret-fixture";
const { prisma } = await import("../../src/lib/db");
const { ensureVariant } = await import("../../src/lib/puzzle/variants");
const { newPuzzleSnapshot } = await import("../../src/lib/puzzle/engine");
const { cachedPuzzleGeometry } = await import("../../src/lib/puzzle/geometryCache");
const match = await import("../../src/lib/puzzle/match");

// Minimale toegestane spelbron, zoals scripts/puzzle/prepare-multiplayer-fixture.mjs (alleen op een wegwerpdatabase).
await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { enabled: true, visibleToUsers: true, publicationState: "LEGACY" } });
await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", jigsawEnabled: true }, update: { jigsawEnabled: true } });
await prisma.gameContentScope.upsert({ where: { gameKey_contentCollectionId: { gameKey: "jigsaw", contentCollectionId: "content_bom" } }, create: { gameKey: "jigsaw", contentCollectionId: "content_bom" }, update: {} });
const users = await Promise.all(Array.from({ length: 6 }, (_, i) => prisma.user.create({ data: { email: `fixture-${i}-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Fx${i}${randomUUID().slice(0, 5)}`, discriminator: "00", currentStreak: 4, hintBalance: 3 } })));
async function session(userId: string, variantId: string, ms: number, o: { correct?: boolean | null; hints?: number; extra?: number; badSnapshot?: boolean; incomplete?: boolean } = {}) {
  const variant = await prisma.puzzleVariant.findUniqueOrThrow({ where: { id: variantId }, include: { definition: true } });
  const snapshot = newPuzzleSnapshot(cachedPuzzleGeometry(variant.pieceCount as 6, variant.definition.seed, variant.definition.geometryVersion), variant.difficulty as "ADVENTURER");
  const hints = Array.from({ length: o.hints ?? 0 }, (_, i) => ({ source: "INCLUDED", type: "PREVIEW", at: new Date().toISOString(), extra: i < (o.extra ?? 0), actionId: randomUUID(), expiresAt: new Date().toISOString(), target: { type: "PREVIEW" } }));
  const started = new Date(Date.now() - 86_400_000 * 30);
  return prisma.puzzleSession.create({ data: { ownerId: userId, variantId, mode: "SOLO", status: "ANSWERED", snapshot: o.badSnapshot ? "{kapot" : JSON.stringify({ ...snapshot, hints }), answerResult: o.correct === null ? null : JSON.stringify({ correct: o.correct ?? true, counted: true, streak: null }), startedAt: started, completedAt: o.incomplete ? null : new Date(started.getTime() + ms), answeredAt: new Date(started.getTime() + ms + 1000) } });
}
for (const [index, user] of users.entries()) {
  for (const image of [40, 41, 42]) {
    const v = (await ensureVariant(image, 6, "ADVENTURER")).variant;
    const first = await session(user.id, v.id, 300_000 - index * 1000);
    await session(user.id, v.id, 200_000 + index * 777, { hints: 2, extra: 1 }); await session(user.id, v.id, 240_000 - index); await session(user.id, v.id, 150_000, { hints: 1 });
    await session(user.id, v.id, 50_000, { correct: false }); await session(user.id, v.id, 60_000, { correct: null }); await session(user.id, v.id, 70_000, { badSnapshot: true }); await session(user.id, v.id, 80_000, { incomplete: true });
    await prisma.puzzlePersonalRecord.create({ data: { userId: user.id, variantId: v.id, sessionId: first.id, elapsedMs: first.completedAt!.getTime() - first.startedAt.getTime(), hintsUsed: 0, extraHintsUsed: 0, completedAt: first.completedAt! } });
  }
}
// Wedstrijden: één van regelversie 2 met een geldige finish, één oude (versie 1), één met DNF.
for (const rules of [2, 1, 2]) {
  const [a, b] = [users[0], users[1]]; await prisma.friendship.upsert({ where: { senderId_receiverId: { senderId: a.id, receiverId: b.id } }, create: { senderId: a.id, receiverId: b.id, status: "ACCEPTED" }, update: {} }).catch(() => {});
  const id = await match.createMatch(a.id, 43 + rules, 6, "ADVENTURER", [b.id], "ASYNC");
  await match.respondToMatchInvite(b.id, id, true); await match.beginMatchAttempt(a.id, id); await match.beginMatchAttempt(b.id, id);
  await prisma.puzzleMatch.update({ where: { id }, data: { resultRules: rules, status: "FINISHED", winnerId: a.id } });
  await prisma.puzzleMatchParticipant.update({ where: { matchId_userId: { matchId: id, userId: a.id } }, data: { status: "FINISHED", elapsedMs: 100_000, finishedAt: new Date(), rank: 1 } });
  await prisma.puzzleMatchParticipant.update({ where: { matchId_userId: { matchId: id, userId: b.id } }, data: rules === 2 && id.endsWith("x") ? { status: "DNF" } : { status: "FINISHED", elapsedMs: 130_000, hintsUsed: 1, finishedAt: new Date(), rank: 2 } });
}
console.log("Fixture klaar");
await prisma.$disconnect();
