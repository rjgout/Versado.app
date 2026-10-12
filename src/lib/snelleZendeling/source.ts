import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getActiveGameCollection } from "@/lib/contentCollections";
import { getContentAvailability } from "@/lib/contentAccess";
import { checkGameAvailability } from "@/lib/gameAvailability";
import { selectReviveOptions } from "./rules";

type Db = Prisma.TransactionClient;
export type RunSource = { id: string; contentCollectionId: string | null; reviveExerciseId: string | null; status: string };
export type SourceReason = "legacy-source" | "source-unavailable" | null;

/** Nieuwe start/deelname: één serverselectie, daarna uitsluitend dit exacte ID. */
export async function requireQuickMissionarySource(userId: string, db: Db = prisma): Promise<string> {
  const collection = await getActiveGameCollection(userId, db);
  if (!collection || !(await checkGameAvailability("quick-missionary", collection.id, 5, db)).available) throw new Error("SOURCE_UNAVAILABLE");
  return collection.id;
}

/** Alleen de bestaande vraagrelatie bewijst een onbekende historische bron. */
export async function runSource(db: Db, run: RunSource, persist = false): Promise<{ collectionId: string | null; reason: SourceReason }> {
  const question = run.reviveExerciseId ? await db.quickMissionaryReviveQuestion.findUnique({
    where: { id: run.reviveExerciseId }, select: { chapter: { select: { book: { select: { contentCollectionId: true } } } } },
  }) : null;
  const proven = question?.chapter.book.contentCollectionId ?? null;
  const collectionId = run.contentCollectionId ?? proven;
  if (!collectionId) return { collectionId: null, reason: "legacy-source" };
  if ((run.reviveExerciseId && proven !== collectionId) || !(await getContentAvailability({ isAdmin: false }, collectionId, "read", db))) {
    return { collectionId, reason: "source-unavailable" };
  }
  if (persist && !run.contentCollectionId && ["DEAD_AWAITING_REVIVE", "REVIVE_READY"].includes(run.status)) {
    // De aanroeper bezit de wedstrijd-/runlock. Nooit opnieuw uitgeven/verbruiken.
    await db.quickMissionaryRun.update({ where: { id: run.id }, data: { contentCollectionId: collectionId } });
    run.contentCollectionId = collectionId;
  }
  return { collectionId, reason: null };
}

/** Geen aankoop voor een bank die uitsluitend onbruikbare antwoordsets bevat. */
export async function hasUsableReviveQuestions(db: Db, collectionId: string): Promise<boolean> {
  const rows = await db.quickMissionaryReviveQuestion.findMany({
    where: { status: "APPROVED", chapter: { book: { contentCollectionId: collectionId } } },
    select: { options: { orderBy: { order: "asc" }, select: { id: true, label: true, isCorrect: true } } },
  });
  return rows.some(row => selectReviveOptions(row.options) !== null);
}
