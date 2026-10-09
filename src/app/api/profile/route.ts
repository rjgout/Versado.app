import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { weekStartKey } from "@/lib/dates";
import { medalCountsFor, TIER_ORDER } from "@/lib/leagues";
import { companionToMascot } from "@/lib/companion";
import { apiError } from "@/lib/apiError";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const [chaptersCompleted, versesTotal, duelsWon, duelsPlayed, allAchievements, earned, featuredAchievements, weeklyScore, seasonResults, activeSeasonScore, podcasts] =
    await Promise.all([
      // Leesvoortgang: gelezen hoofdstukken, en hoeveel er in totaal begonnen zijn.
      prisma.contentProgress.count({ where: { userId: user.id, readStatus: "READ" } }),
      prisma.contentProgress.count({ where: { userId: user.id, readStatus: { not: null } } }),
      prisma.liveGamePlayer.findMany({
        where: { userId: user.id, game: { status: "FINISHED" } },
        include: { game: { include: { players: true } } },
      }),
      prisma.liveGamePlayer.count({ where: { userId: user.id, game: { status: "FINISHED" } } }),
      prisma.achievement.findMany({ orderBy: { name: "asc" } }),
      prisma.userAchievement.findMany({ where: { userId: user.id } }),
      // Een selectie is geen bewijs dat een prestatie nog bestaat of behaald
      // is; alleen UserAchievement is dat. Zo verschijnt een oude verwijzing
      // nooit alsnog als verdiende badge.
      prisma.featuredAchievement.findMany({
        where: { userId: user.id, achievement: { userAchievements: { some: { userId: user.id } } } },
        orderBy: { position: "asc" },
        select: { achievementId: true },
      }),
      prisma.weeklyScore.findUnique({ where: { userId_weekStart: { userId: user.id, weekStart: weekStartKey() } } }),
      // Seizoensgeschiedenis (sectie 10/11 van het productplan) — één rij per
      // afgesloten seizoen waarin deze gebruiker actief was, zie
      // runSeasonRolloverTick in src/lib/scheduler.ts.
      prisma.seasonResult.findMany({
        where: { userId: user.id },
        include: { season: { select: { index: true } } },
        orderBy: { season: { index: "desc" } },
      }),
      prisma.weeklyScore.findFirst({ where: { userId: user.id, season: { status: "ACTIVE" } }, select: { id: true } }),
      prisma.podcast.findMany({
        orderBy: { order: "asc" },
        select: { id: true, name: true, notificationPreferences: { where: { userId: user.id }, select: { enabled: true } } },
      }),
    ]);

  const wins = duelsWon.filter(
    (p) => p.score > 0 && p.game.players.every((other) => other.userId === p.userId || other.score < p.score)
  ).length;
  const earnedByAchievementId = new Map(earned.map((e) => [e.achievementId, e.earnedAt]));

  // Positie binnen de eigen groep van deze week (zie /competition) — null
  // als er deze week nog geen potje/oefening is gedaan.
  let groupPosition: number | null = null;
  if (weeklyScore?.groupId) {
    const peers = await prisma.weeklyScore.findMany({
      where: { groupId: weeklyScore.groupId },
      orderBy: [{ xp: "desc" }, { id: "asc" }],
      select: { userId: true },
    });
    const idx = peers.findIndex((p) => p.userId === user.id);
    groupPosition = idx === -1 ? null : idx + 1;
  }

  const bestTierIdx = Math.max(
    weeklyScore ? TIER_ORDER.indexOf(weeklyScore.tier) : -1,
    ...seasonResults.map((r) => TIER_ORDER.indexOf(r.highestTier))
  );
  const bestTierEver = bestTierIdx >= 0 ? TIER_ORDER[bestTierIdx] : null;
  const lifetimePromotions = seasonResults.reduce((sum, r) => sum + r.promotions, 0);
  const lifetimeDemotions = seasonResults.reduce((sum, r) => sum + r.demotions, 0);
  const competitionsWon = seasonResults.reduce((sum, r) => sum + r.competitionsWon, 0);
  const seasonCount = seasonResults.length + (activeSeasonScore ? 1 : 0);

  return NextResponse.json({
    displayName: user.handle,
    isAdmin: user.isAdmin,
    handle: user.handle,
    discriminator: user.discriminator,
    avatarEmoji: user.avatarEmoji,
    email: user.email,
    searchableByEmail: user.searchableByEmail,
    shareAchievements: user.shareAchievements,
    shareOnlineStatus: user.shareOnlineStatus,
    shareCurrentActivity: user.shareCurrentActivity,
    // Alleen of het (nog) actief is, nooit het exacte tijdstip — de client
    // heeft alleen "sta ik nu op onzichtbaar" nodig om de knop goed te tonen.
    incognitoActive: !!(user.invisibleUntil && user.invisibleUntil > new Date()),
    emailNotificationsEnabled: user.emailNotificationsEnabled,
    pushNotificationsEnabled: user.pushNotificationsEnabled,
    dailyReminderTime: user.dailyReminderTime,
    dailyTextTime: user.dailyTextTime,
    notifyDailyText: user.notifyDailyText,
    notifyDailyReminder: user.notifyDailyReminder,
    notifyStreakReturn: user.notifyStreakReturn,
    notifySocial: user.notifySocial,
    notifyActivityReactions: user.notifyActivityReactions,
    notifyAchievements: user.notifyAchievements,
    notifyWordGame: user.notifyWordGame,
    notifyFriendOnline: user.notifyFriendOnline,
    changelogEnabled: user.changelogEnabled,
    conferenceCountdownEnabled: user.conferenceCountdownEnabled,
    kompasOffersEnabled: user.kompasOffersEnabled,
    nudgesEnabled: user.nudgesEnabled,
    timeZone: user.timeZone,
    uiLanguage: user.uiLanguage,
    companion: companionToMascot(user.companion),
    totpEnabled: user.totpEnabled,
    xpTotal: user.xpTotal,
    currentStreak: user.currentStreak,
    longestStreak: user.longestStreak,
    freezeCount: user.freezeCount,
    chaptersCompleted,
    chaptersStarted: versesTotal,
    duelsPlayed,
    duelsWon: wins,
    tier: weeklyScore?.tier ?? null,
    groupPosition,
    medals: await medalCountsFor(prisma, user.id, weekStartKey()),
    bestTierEver,
    lifetimePromotions,
    lifetimeDemotions,
    competitionsWon,
    seasonCount,
    bestNationalRank: user.bestNationalRank,
    seasons: seasonResults.map((r) => ({
      seasonIndex: r.season.index,
      highestTier: r.highestTier,
      finalTier: r.finalTier,
      finalGroupPosition: r.finalGroupPosition,
    })),
    achievements: allAchievements.map((a) => ({
      id: a.id,
      slug: a.slug,
      name: a.name,
      description: a.description,
      icon: a.icon,
      earnedAt: earnedByAchievementId.get(a.id) ?? null,
    })),
    featuredAchievementIds: featuredAchievements.map((row) => row.achievementId),
    podcastNotifications: podcasts.map((podcast) => ({
      podcastId: podcast.id,
      podcastName: podcast.name,
      enabled: podcast.notificationPreferences[0]?.enabled ?? false,
    })),
  });
}
