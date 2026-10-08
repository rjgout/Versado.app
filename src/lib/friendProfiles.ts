import { prisma } from "@/lib/db";
import { weekStartKey } from "@/lib/dates";

/**
 * Vriendenprofielen zijn nooit een algemene gebruikersdirectory. Dezelfde
 * acceptatiecontrole staat op één plek zodat page en API geen verschillende
 * toegangspaden kunnen krijgen.
 */
export async function acceptedFriendship(viewerId: string, profileUserId: string) {
  if (viewerId === profileUserId) return null;
  return prisma.friendship.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { senderId: viewerId, receiverId: profileUserId },
        { senderId: profileUserId, receiverId: viewerId },
      ],
    },
    select: { id: true },
  });
}

export async function getFriendProfile(viewerId: string, profileUserId: string) {
  const friendship = await acceptedFriendship(viewerId, profileUserId);
  if (!friendship) return null;

  const target = await prisma.user.findUnique({
    where: { id: profileUserId },
    select: {
      id: true,
      handle: true,
      discriminator: true,
      avatarEmoji: true,
      shareAchievements: true,
      xpTotal: true,
      currentStreak: true,
      featuredAchievements: {
        orderBy: { position: "asc" },
        where: { achievement: { userAchievements: { some: { userId: profileUserId } } } },
        select: {
          position: true,
          achievement: { select: { id: true, slug: true, name: true, description: true, icon: true } },
        },
      },
    },
  });
  if (!target) return null;

  const [score, groups, games] = await Promise.all([
    target.shareAchievements
      ? prisma.weeklyScore.findUnique({
          where: { userId_weekStart: { userId: profileUserId, weekStart: weekStartKey() } },
          select: { tier: true },
        })
      : Promise.resolve(null),
    prisma.socialGroup.findMany({
      where: {
        memberships: { some: { userId: viewerId, leftAt: null } },
        AND: [{ memberships: { some: { userId: profileUserId, leftAt: null } } }],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, currentStreak: true },
    }),
    prisma.liveGame.findMany({
      where: {
        status: { in: ["LOBBY", "IN_PROGRESS"] },
        players: { some: { userId: viewerId } },
        AND: [{ players: { some: { userId: profileUserId } } }],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { code: true, mode: true, status: true },
    }),
  ]);

  return {
    friend: {
      id: target.id,
      handle: target.handle,
      discriminator: target.discriminator,
      avatarEmoji: target.avatarEmoji,
    },
    sharesAchievements: target.shareAchievements,
    stats: target.shareAchievements
      ? {
          currentStreak: target.currentStreak,
          xpTotal: target.xpTotal,
          tier: score?.tier ?? null,
          featuredAchievements: target.featuredAchievements.map((row) => ({ ...row.achievement, position: row.position })),
        }
      : null,
    together: { groups, games },
  };
}
