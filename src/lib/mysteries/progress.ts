import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";
import { recordLearningActivity } from "@/lib/streak";
import { getContentContext, BOFM_WORK } from "@/lib/contentCollections";
import { MYSTERY_001A } from "./mystery001a";
import { completionTransition, isSolutionCorrect } from "./logic";
import { firstCompletionUpdate } from "./progressRules";
import type { Placements } from "./types";

const DIFFICULTY = "DISCOVERER" as const;

export interface MysteryProgressView {
  completed: boolean;
  completedAt: string | null;
  hintCount: number | null;
  tutorialSeen: boolean;
}

export async function canUseMystery001a(userId: string, isAdmin: boolean): Promise<boolean> {
  const [settings, context] = await Promise.all([
    prisma.gameSettings.findUnique({ where: { id: "singleton" }, select: { mysteryEnabled: true } }),
    getContentContext(userId),
  ]);
  return ((settings?.mysteryEnabled ?? true) || isAdmin)
    && context.active.work === BOFM_WORK
    && context.gameKeys.includes("mystery");
}

export async function getMystery001aProgress(userId: string): Promise<MysteryProgressView> {
  const progress = await prisma.mysteryProgress.findUnique({
    where: { userId_mysteryId_difficulty: { userId, mysteryId: MYSTERY_001A.id, difficulty: DIFFICULTY } },
  });
  return {
    completed: progress?.completed ?? false,
    completedAt: progress?.completedAt?.toISOString() ?? null,
    hintCount: progress?.hintCount ?? null,
    tutorialSeen: progress?.tutorialSeenAt !== null && progress?.tutorialSeenAt !== undefined,
  };
}

export async function markMystery001aTutorialSeen(userId: string): Promise<void> {
  const now = new Date();
  await prisma.mysteryProgress.upsert({
    where: { userId_mysteryId_difficulty: { userId, mysteryId: MYSTERY_001A.id, difficulty: DIFFICULTY } },
    create: { userId, mysteryId: MYSTERY_001A.id, difficulty: DIFFICULTY, tutorialSeenAt: now },
    update: { tutorialSeenAt: now },
  });
}

export async function completeMystery001a(
  userId: string,
  placements: Placements,
  hintCount: number
): Promise<{ correct: boolean; firstCompletion: boolean; completedAt?: string }> {
  if (!isSolutionCorrect(MYSTERY_001A, placements)) return { correct: false, firstCompletion: false };
  const completedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await tx.mysteryProgress.upsert({
      where: { userId_mysteryId_difficulty: { userId, mysteryId: MYSTERY_001A.id, difficulty: DIFFICULTY } },
      create: { userId, mysteryId: MYSTERY_001A.id, difficulty: DIFFICULTY },
      update: {},
    });
    await tx.$queryRaw`SELECT "id" FROM "MysteryProgress" WHERE "userId" = ${userId} AND "mysteryId" = ${MYSTERY_001A.id} AND "difficulty" = ${DIFFICULTY}::"MysteryDifficulty" FOR UPDATE`;
    const current = await tx.mysteryProgress.findUniqueOrThrow({
      where: { userId_mysteryId_difficulty: { userId, mysteryId: MYSTERY_001A.id, difficulty: DIFFICULTY } },
      select: { completed: true },
    });
    const transition = completionTransition(current.completed);
    const update = firstCompletionUpdate(current.completed, hintCount, completedAt);
    if (!transition.firstCompletion || !update) return { firstCompletion: false, streakChanged: false };

    await tx.mysteryProgress.update({
      where: { userId_mysteryId_difficulty: { userId, mysteryId: MYSTERY_001A.id, difficulty: DIFFICULTY } },
      data: update,
    });
    // Geen los XP-bedrag: de centrale economie kent nog geen mysteryreward.
    // De eerste echte oplossing is wel een afgerond educatief spel en loopt
    // daarom via exact dezelfde centrale reeksregel als andere spellen.
    const streak = await recordLearningActivity(tx, userId, {
      kind: "GAME",
      answered: 1,
      required: 1,
      key: `mystery:${MYSTERY_001A.id}:${MYSTERY_001A.difficulty}:first-completion`,
    });
    return { firstCompletion: true, streakChanged: streak.dayEarned };
  });
  if (result.firstCompletion) {
    emitToUser(userId, "streak_changed", { dayEarned: result.streakChanged });
  }
  return { correct: true, firstCompletion: result.firstCompletion, completedAt: completedAt.toISOString() };
}

export async function mystery001aReaderHref(userId: string): Promise<string> {
  const context = await getContentContext(userId);
  const chapter = await prisma.chapter.findFirst({
    where: {
      number: MYSTERY_001A.story.source.chapterStart,
      book: { key: MYSTERY_001A.story.source.bookKey, contentCollectionId: context.active.id },
    },
    select: { id: true },
  });
  return chapter ? `/lesson/${chapter.id}` : "/courses";
}
