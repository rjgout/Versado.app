import { prisma } from "@/lib/db";
import { getContentContext, BOFM_WORK } from "@/lib/contentCollections";
import { MYSTERY_001A } from "./mystery001a";
import type { MysteryDefinition, MysteryDifficultyId } from "./types";

function dbDifficulty(difficulty: MysteryDifficultyId) {
  if (difficulty === "discoverer") return "DISCOVERER" as const;
  if (difficulty === "investigator") return "INVESTIGATOR" as const;
  return "SCRIPTURE_SCHOLAR" as const;
}

export interface MysteryProgressView {
  completed: boolean;
  completedAt: string | null;
  hintCount: number | null;
  tutorialSeen: boolean;
  mysteryCompleted: boolean;
}

export async function canUseMystery(userId: string, isAdmin: boolean): Promise<boolean> {
  void isAdmin;
  const [settings, context] = await Promise.all([
    prisma.gameSettings.findUnique({ where: { id: "singleton" }, select: { mysteryEnabled: true } }),
    getContentContext(userId),
  ]);
  return (settings?.mysteryEnabled ?? true)
    && context.active.work === BOFM_WORK
    && context.gameKeys.includes("mystery");
}

/** Iedere volgende mystery volgt de eerste voltooide variant van de vorige. */
export async function canUseMysteryNumber(userId: string, isAdmin: boolean, number: number): Promise<boolean> {
  if (!(await canUseMystery(userId, isAdmin))) return false;
  if (number <= 1) return true;
  const previousId = `mystery-${String(number - 1).padStart(3, "0")}`;
  const previous = await prisma.mysteryProgress.findFirst({ where: { userId, mysteryId: previousId, completed: true }, select: { id: true } });
  return previous !== null;
}

export const canUseMystery002 = (userId: string, isAdmin: boolean) => canUseMysteryNumber(userId, isAdmin, 2);
export const canUseMystery003 = (userId: string, isAdmin: boolean) => canUseMysteryNumber(userId, isAdmin, 3);
export const canUseMystery004 = (userId: string, isAdmin: boolean) => canUseMysteryNumber(userId, isAdmin, 4);
export const canUseMystery005 = (userId: string, isAdmin: boolean) => canUseMysteryNumber(userId, isAdmin, 5);
export const canUseMystery006 = (userId: string, isAdmin: boolean) => canUseMysteryNumber(userId, isAdmin, 6);

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

export const canUseMystery001a = canUseMystery;
export async function getMystery001aProgress(userId: string) { return getMysteryProgress(userId, MYSTERY_001A); }

export async function mysteryReaderHref(userId: string, definition: MysteryDefinition): Promise<string> {
  const { getMysteryAttempt } = await import("./attempts");
  return (await getMysteryAttempt(userId, definition))?.readerHref ?? "/courses";
}

export async function mystery001aReaderHref(userId: string): Promise<string> {
  return mysteryReaderHref(userId, MYSTERY_001A);
}
