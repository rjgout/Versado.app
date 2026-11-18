import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Bewaart alleen een kleine, geordende verwijzing naar al behaalde
 * prestaties. De controle blijft server-side zodat een gemanipuleerde
 * profielclient nooit een ongekende badge kan etaleren.
 */
export async function saveFeaturedAchievements(userId: string, achievementIds: string[], tx?: Prisma.TransactionClient): Promise<void> {
  if (achievementIds.length > 5 || new Set(achievementIds).size !== achievementIds.length || achievementIds.some((id) => !id || id.length > 128)) {
    throw new Error("INVALID_FEATURED_ACHIEVEMENTS");
  }

  if (!tx) { await prisma.$transaction(inner => saveFeaturedAchievements(userId, achievementIds, inner)); return; }
  const earned = achievementIds.length
    ? await tx.userAchievement.findMany({ where: { userId, achievementId: { in: achievementIds } }, select: { achievementId: true } })
    : [];
  if (earned.length !== achievementIds.length) throw new Error("INVALID_FEATURED_ACHIEVEMENTS");

  await tx.featuredAchievement.deleteMany({ where: { userId } });
  if (achievementIds.length) await tx.featuredAchievement.createMany({ data: achievementIds.map((achievementId, position) => ({ userId, achievementId, position })) });
}
