import { prisma } from "@/lib/db";

/**
 * Bewaart alleen een kleine, geordende verwijzing naar al behaalde
 * prestaties. De controle blijft server-side zodat een gemanipuleerde
 * profielclient nooit een ongekende badge kan etaleren.
 */
export async function saveFeaturedAchievements(userId: string, achievementIds: string[]): Promise<void> {
  if (achievementIds.length > 5 || new Set(achievementIds).size !== achievementIds.length || achievementIds.some((id) => !id || id.length > 128)) {
    throw new Error("INVALID_FEATURED_ACHIEVEMENTS");
  }

  const earned = achievementIds.length
    ? await prisma.userAchievement.findMany({ where: { userId, achievementId: { in: achievementIds } }, select: { achievementId: true } })
    : [];
  if (earned.length !== achievementIds.length) throw new Error("INVALID_FEATURED_ACHIEVEMENTS");

  await prisma.$transaction([
    prisma.featuredAchievement.deleteMany({ where: { userId } }),
    ...(achievementIds.length
      ? [prisma.featuredAchievement.createMany({ data: achievementIds.map((achievementId, position) => ({ userId, achievementId, position })) })]
      : []),
  ]);
}
