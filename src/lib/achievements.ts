import type { Prisma } from "@/generated/prisma/client";
import { recordAchievementActivity } from "@/lib/activityFeed";

interface AchievementDef {
  slug: string;
  check: (tx: Prisma.TransactionClient, userId: string) => Promise<boolean>;
}

// Voorwaarden worden bij elke aanroep herberekend vanuit de huidige data
// (i.p.v. losse "event" tracking) — eenvoudiger correct te houden, en werkt
// ongeacht vanuit welke flow (les, freeze, duel, vriendschap) je aanroept.
// "Een hoofdstuk afgerond" is een volledig gemaakte oefenset van een stuk
// inhoud, in welke route of taal ook; "perfect" is die set helemaal goed
// (zie ContentProgress en docs/LEERVOORTGANG.md). Lezen alleen telt hier niet.
const ACHIEVEMENTS: AchievementDef[] = [
  {
    slug: "streak-3",
    check: async (tx, userId) => (await tx.user.findUniqueOrThrow({ where: { id: userId } })).longestStreak >= 3,
  },
  {
    slug: "streak-7",
    check: async (tx, userId) => (await tx.user.findUniqueOrThrow({ where: { id: userId } })).longestStreak >= 7,
  },
  {
    slug: "streak-30",
    check: async (tx, userId) => (await tx.user.findUniqueOrThrow({ where: { id: userId } })).longestStreak >= 30,
  },
  {
    slug: "streak-100",
    check: async (tx, userId) => (await tx.user.findUniqueOrThrow({ where: { id: userId } })).longestStreak >= 100,
  },
  {
    slug: "first-chapter",
    check: async (tx, userId) => (await tx.contentProgress.count({ where: { userId, exercisesCompletedAt: { not: null } } })) >= 1,
  },
  {
    slug: "chapters-5",
    check: async (tx, userId) => (await tx.contentProgress.count({ where: { userId, exercisesCompletedAt: { not: null } } })) >= 5,
  },
  {
    slug: "chapters-10",
    check: async (tx, userId) => (await tx.contentProgress.count({ where: { userId, exercisesCompletedAt: { not: null } } })) >= 10,
  },
  {
    slug: "chapters-25",
    check: async (tx, userId) => (await tx.contentProgress.count({ where: { userId, exercisesCompletedAt: { not: null } } })) >= 25,
  },
  {
    slug: "chapters-50",
    check: async (tx, userId) => (await tx.contentProgress.count({ where: { userId, exercisesCompletedAt: { not: null } } })) >= 50,
  },
  {
    slug: "perfect-chapter",
    check: async (tx, userId) => (await tx.contentProgress.count({ where: { userId, rewardBonusAt: { not: null } } })) >= 1,
  },
  {
    slug: "perfect-10",
    check: async (tx, userId) => (await tx.contentProgress.count({ where: { userId, rewardBonusAt: { not: null } } })) >= 10,
  },
  {
    slug: "xp-1000",
    check: async (tx, userId) => (await tx.user.findUniqueOrThrow({ where: { id: userId } })).xpTotal >= 1000,
  },
  {
    slug: "xp-5000",
    check: async (tx, userId) => (await tx.user.findUniqueOrThrow({ where: { id: userId } })).xpTotal >= 5000,
  },
  {
    slug: "xp-10000",
    check: async (tx, userId) => (await tx.user.findUniqueOrThrow({ where: { id: userId } })).xpTotal >= 10000,
  },
  {
    slug: "first-freeze-earned",
    check: async (tx, userId) => (await tx.freezeTransaction.count({ where: { userId, type: "EARNED" } })) >= 1,
  },
  {
    slug: "first-freeze-gifted",
    check: async (tx, userId) => (await tx.freezeTransaction.count({ where: { userId, type: "GIFT_SENT" } })) >= 1,
  },
  {
    slug: "first-friend",
    check: async (tx, userId) =>
      (await tx.friendship.count({
        where: { status: "ACCEPTED", OR: [{ senderId: userId }, { receiverId: userId }] },
      })) >= 1,
  },
  {
    slug: "friends-5",
    check: async (tx, userId) =>
      (await tx.friendship.count({
        where: { status: "ACCEPTED", OR: [{ senderId: userId }, { receiverId: userId }] },
      })) >= 5,
  },
  {
    slug: "first-duel-won",
    check: async (tx, userId) => {
      const played = await tx.liveGamePlayer.findMany({
        where: { userId, game: { status: "FINISHED" } },
        include: { game: { include: { players: true } } },
      });
      return played.some(
        (p) => p.score > 0 && p.game.players.every((other) => other.userId === p.userId || other.score < p.score)
      );
    },
  },
  {
    slug: "duels-10-won",
    check: async (tx, userId) => {
      const played = await tx.liveGamePlayer.findMany({
        where: { userId, game: { status: "FINISHED" } },
        include: { game: { include: { players: true } } },
      });
      return (
        played.filter(
          (p) => p.score > 0 && p.game.players.every((other) => other.userId === p.userId || other.score < p.score)
        ).length >= 10
      );
    },
  },
  {
    slug: "family-game-first-play",
    check: async (tx, userId) =>
      (await tx.liveGamePlayer.count({ where: { userId, game: { mode: "FAMILY_GAME", status: "FINISHED" } } })) >= 1,
  },
  {
    slug: "word-game-first-win",
    check: async (tx, userId) => (await tx.wordGame.count({ where: { userId, status: "WON" } })) >= 1,
  },
  {
    slug: "word-game-7-wins",
    check: async (tx, userId) => (await tx.wordGame.count({ where: { userId, status: "WON" } })) >= 7,
  },
  {
    slug: "podcast-first-lesson",
    check: async (tx, userId) => (await tx.podcastEpisodeProgress.count({ where: { userId, completed: true } })) >= 1,
  },
  {
    slug: "podcast-10-lessons",
    check: async (tx, userId) => (await tx.podcastEpisodeProgress.count({ where: { userId, completed: true } })) >= 10,
  },
  {
    slug: "kids-first-story",
    check: async (tx, userId) => (await tx.kidsStoryProgress.count({ where: { userId, completed: true } })) >= 1,
  },
  {
    slug: "kids-10-stories",
    check: async (tx, userId) => (await tx.kidsStoryProgress.count({ where: { userId, completed: true } })) >= 10,
  },
  {
    slug: "intro-first-lesson",
    check: async (tx, userId) => (await tx.introLessonProgress.count({ where: { userId, completed: true } })) >= 1,
  },
  {
    slug: "intro-all-lessons",
    check: async (tx, userId) => {
      const total = await tx.introLesson.count();
      if (total === 0) return false;
      return (await tx.introLessonProgress.count({ where: { userId, completed: true } })) >= total;
    },
  },
];

// Vriendenreeksen (src/lib/social/friendStreaks.ts): de langste reeks die je
// ooit met een vriend haalde, dus een verbroken reeks neemt niets terug.
async function longestFriendStreak(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  const best = await tx.friendStreak.aggregate({
    where: { OR: [{ userAId: userId }, { userBId: userId }] },
    _max: { longestStreak: true },
  });
  return best._max.longestStreak ?? 0;
}

for (const days of [1, 7, 30, 100, 365]) {
  ACHIEVEMENTS.push({ slug: `friend-streak-${days}`, check: async (tx, userId) => (await longestFriendStreak(tx, userId)) >= days });
}

export async function checkAndAwardAchievements(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const earned = await tx.userAchievement.findMany({
    where: { userId },
    select: { achievement: { select: { slug: true } } },
  });
  const alreadyEarned = new Set(earned.map((e) => e.achievement.slug));

  const newlyEarned: string[] = [];
  for (const def of ACHIEVEMENTS) {
    if (alreadyEarned.has(def.slug)) continue;
    if (!(await def.check(tx, userId))) continue;

    const achievement = await tx.achievement.findUnique({ where: { slug: def.slug } });
    if (!achievement) continue; // nog niet geseed

    await tx.userAchievement.create({ data: { userId, achievementId: achievement.id } });
    await recordAchievementActivity(tx, userId, achievement);
    newlyEarned.push(def.slug);
  }
  return newlyEarned;
}

/**
 * Herstelt alleen duurzame UserAchievement-rijen voor bestaande prestaties.
 * Dit wordt gebruikt bij een avatarwijziging/profielopening, zodat historische
 * voortgang ook unlocks geeft zonder opnieuw een activiteit of teller te maken.
 * De normale activiteitspaden blijven verantwoordelijk voor feed en melding.
 */
export async function ensureAchievementRecords(tx: Prisma.TransactionClient, userId: string, slugs: Iterable<string>): Promise<void> {
  const wanted = new Set(slugs);
  if (wanted.size === 0) return;
  const earned = await tx.userAchievement.findMany({ where: { userId }, select: { achievementId: true, achievement: { select: { slug: true } } } });
  const earnedSlugs = new Set(earned.map((row) => row.achievement.slug));
  for (const def of ACHIEVEMENTS) {
    if (!wanted.has(def.slug) || earnedSlugs.has(def.slug) || !(await def.check(tx, userId))) continue;
    const achievement = await tx.achievement.findUnique({ where: { slug: def.slug }, select: { id: true } });
    if (!achievement) continue;
    await tx.userAchievement.upsert({
      where: { userId_achievementId: { userId, achievementId: achievement.id } },
      update: {},
      create: { userId, achievementId: achievement.id },
    });
  }
}
