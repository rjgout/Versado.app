import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";
import { recordLearningActivity } from "@/lib/streak";
import { getContentContext, BOFM_WORK } from "@/lib/contentCollections";
import { MYSTERY_001A } from "./mystery001a";
import type { MysteryDefinition, MysteryDifficultyId } from "./types";
import { completionTransition, isSolutionCorrect } from "./logic";
import { firstCompletionUpdate } from "./progressRules";
import type { Placements } from "./types";

function dbDifficulty(difficulty: MysteryDifficultyId) {
  return difficulty === "discoverer" ? "DISCOVERER" as const : "INVESTIGATOR" as const;
}

export interface MysteryProgressView {
  completed: boolean;
  completedAt: string | null;
  hintCount: number | null;
  tutorialSeen: boolean;
  mysteryCompleted: boolean;
}

export async function canUseMystery(userId: string, isAdmin: boolean): Promise<boolean> {
  const [settings, context] = await Promise.all([
    prisma.gameSettings.findUnique({ where: { id: "singleton" }, select: { mysteryEnabled: true } }),
    getContentContext(userId),
  ]);
  return ((settings?.mysteryEnabled ?? true) || isAdmin)
    && context.active.work === BOFM_WORK
    && context.gameKeys.includes("mystery");
}

export async function getMysteryProgress(userId: string, definition: MysteryDefinition): Promise<MysteryProgressView> {
  const [progress, mysteryCompletion] = await Promise.all([
    prisma.mysteryProgress.findUnique({
      where: { userId_mysteryId_difficulty: { userId, mysteryId: definition.mysteryId, difficulty: dbDifficulty(definition.difficulty) } },
    }),
    prisma.mysteryProgress.findFirst({ where: { userId, mysteryId: definition.mysteryId, completed: true }, select: { id: true } }),
  ]);
  return {
    completed: progress?.completed ?? false,
    completedAt: progress?.completedAt?.toISOString() ?? null,
    hintCount: progress?.hintCount ?? null,
    tutorialSeen: progress?.tutorialSeenAt !== null && progress?.tutorialSeenAt !== undefined,
    mysteryCompleted: mysteryCompletion !== null,
  };
}

export async function markMysteryTutorialSeen(userId: string, definition: MysteryDefinition): Promise<void> {
  if (!definition.tutorial) return;
  const now = new Date();
  await prisma.mysteryProgress.upsert({
    where: { userId_mysteryId_difficulty: { userId, mysteryId: definition.mysteryId, difficulty: dbDifficulty(definition.difficulty) } },
    create: { userId, mysteryId: definition.mysteryId, difficulty: dbDifficulty(definition.difficulty), tutorialSeenAt: now },
    update: { tutorialSeenAt: now },
  });
}

export async function completeMystery(
  userId: string,
  definition: MysteryDefinition,
  placements: Placements,
  hintCount: number
): Promise<{ correct: boolean; firstCompletion: boolean; completedAt?: string }> {
  if (!isSolutionCorrect(definition, placements)) return { correct: false, firstCompletion: false };
  const completedAt = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await tx.mysteryProgress.upsert({
      where: { userId_mysteryId_difficulty: { userId, mysteryId: definition.mysteryId, difficulty: dbDifficulty(definition.difficulty) } },
      create: { userId, mysteryId: definition.mysteryId, difficulty: dbDifficulty(definition.difficulty) },
      update: {},
    });
    await tx.$queryRaw`SELECT "id" FROM "MysteryProgress" WHERE "userId" = ${userId} AND "mysteryId" = ${definition.mysteryId} AND "difficulty" = ${dbDifficulty(definition.difficulty)}::"MysteryDifficulty" FOR UPDATE`;
    const current = await tx.mysteryProgress.findUniqueOrThrow({
      where: { userId_mysteryId_difficulty: { userId, mysteryId: definition.mysteryId, difficulty: dbDifficulty(definition.difficulty) } },
      select: { completed: true },
    });
    const transition = completionTransition(current.completed);
    const update = firstCompletionUpdate(current.completed, hintCount, completedAt);
    if (!transition.firstCompletion || !update) return { firstCompletion: false, streakChanged: false };

    await tx.mysteryProgress.update({
      where: { userId_mysteryId_difficulty: { userId, mysteryId: definition.mysteryId, difficulty: dbDifficulty(definition.difficulty) } },
      data: update,
    });
    // Geen los XP-bedrag: de centrale economie kent nog geen mysteryreward.
    // De eerste echte oplossing is wel een afgerond educatief spel en loopt
    // daarom via exact dezelfde centrale reeksregel als andere spellen.
    const streak = await recordLearningActivity(tx, userId, {
      kind: "GAME",
      answered: 1,
      required: 1,
      key: `mystery:${definition.mysteryId}:${definition.difficulty}:first-completion`,
    });
    return { firstCompletion: true, streakChanged: streak.dayEarned };
  });
  if (result.firstCompletion) {
    emitToUser(userId, "streak_changed", { dayEarned: result.streakChanged });
  }
  return { correct: true, firstCompletion: result.firstCompletion, completedAt: completedAt.toISOString() };
}

export const canUseMystery001a = canUseMystery;
export async function getMystery001aProgress(userId: string) { return getMysteryProgress(userId, MYSTERY_001A); }
export async function markMystery001aTutorialSeen(userId: string) { return markMysteryTutorialSeen(userId, MYSTERY_001A); }
export async function completeMystery001a(userId: string, placements: Placements, hintCount: number) { return completeMystery(userId, MYSTERY_001A, placements, hintCount); }

export async function mysteryReaderHref(userId: string, definition: MysteryDefinition): Promise<string> {
  const context = await getContentContext(userId);
  const chapter = await prisma.chapter.findFirst({
    where: {
      number: definition.story.source.chapterStart,
      book: { key: definition.story.source.bookKey, contentCollectionId: context.active.id },
    },
    select: { id: true },
  });
  return chapter ? `/lesson/${chapter.id}` : "/courses";
}

export async function mystery001aReaderHref(userId: string): Promise<string> {
  return mysteryReaderHref(userId, MYSTERY_001A);
}
