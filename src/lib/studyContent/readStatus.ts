import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";
import { recordLearningActivity, type StreakSnapshot } from "@/lib/streak";
import { getPublishedStudyLesson, type PublishedStudyDTO } from "./revisions";

type Actor = { id: string; isAdmin: boolean };
type Tx = Prisma.TransactionClient;

export class StudyReadError extends Error {
  constructor(
    readonly code: "INVALID" | "UNAVAILABLE" | "REVISION_CHANGED",
    readonly state?: StudyReadState,
  ) {
    super(code);
  }
}

export interface StudyReadState {
  read: boolean;
  readAt: string | null;
}

export interface StudyReadResult {
  state: StudyReadState;
  changed: boolean;
  counted: boolean;
  streak: StreakSnapshot | null;
}

/**
 * Stabiele inhoudsidentiteit: een StudyLesson blijft dezelfde les over
 * vertalingen en immutable revisies. De periodKey voorkomt een botsing tussen
 * hergebruikte bronsleutels uit verschillende lesjaren of programma-perioden.
 */
export function studyLessonContentKey(lesson: Pick<PublishedStudyDTO, "workKey" | "periodId" | "sourceKey">) {
  return `study:${lesson.workKey}:${lesson.periodId}:${lesson.sourceKey}`;
}

function view(row: { readStatus: "READING" | "READ" | null; readAt: Date | null } | null): StudyReadState {
  return { read: row?.readStatus === "READ", readAt: row?.readAt?.toISOString() ?? null };
}

export async function getStudyLessonReadState(
  db: Pick<PrismaClient, "contentProgress"> | Tx,
  userId: string,
  lesson: Pick<PublishedStudyDTO, "workKey" | "periodId" | "sourceKey">,
): Promise<StudyReadState> {
  const row = await db.contentProgress.findUnique({
    where: { userId_contentKey: { userId, contentKey: studyLessonContentKey(lesson) } },
    select: { readStatus: true, readAt: true },
  });
  return view(row);
}

/**
 * Bewuste lesafronding. Alleen de actuele gepubliceerde editie wordt
 * geaccepteerd; herhaling is semantisch idempotent via de logische
 * ContentProgress-rij én de vaste StreakActivity-sleutel.
 */
export async function markStudyLessonRead(
  actor: Actor,
  input: { lessonEditionId: string; revisionId: string; actionId: string },
  client: PrismaClient = prisma,
): Promise<StudyReadResult> {
  const result = await client.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
    await tx.$executeRaw`SET LOCAL lock_timeout='5s'`;
    await tx.$executeRaw`SET LOCAL statement_timeout='5s'`;
    // Publiceren gebruikt dezelfde editie als vergrendelingspunt. De lock
    // voorkomt dat een pointerwissel tussen rechtencontrole en READ-claim valt.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "StudyLessonEdition" WHERE id=${input.lessonEditionId} FOR SHARE`;
    if (!locked.length) throw new StudyReadError("UNAVAILABLE");
    // getPublishedStudyLesson heeft een lesId en collectie nodig; laad de
    // geverifieerde identiteit vanuit de vastgezette editie, niet uit de client.
    const edition = await tx.studyLessonEdition.findUnique({
      where: { id: input.lessonEditionId },
      select: { lessonId: true, collectionId: true },
    });
    if (!edition) throw new StudyReadError("UNAVAILABLE");
    const published = await getPublishedStudyLesson(actor, edition.lessonId, edition.collectionId, tx);
    if (!published || published.editionId !== input.lessonEditionId)
      throw new StudyReadError("UNAVAILABLE");

    const contentKey = studyLessonContentKey(published);
    // Centrale lockvolgorde: gebruiker vóór de logische voortgangsrij. De
    // bestaande reeksservice neemt dezelfde gebruiker onder deze transactie.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.id} FOR UPDATE`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.id, contentKey])}, 0))`;
    const existing = await tx.contentProgress.findUnique({
      where: { userId_contentKey: { userId: actor.id, contentKey } },
      select: { readStatus: true, readAt: true },
    });
    // Een verloren response herstelt de echte toestand, ook als er intussen
    // een nieuwe revisie gepubliceerd is. Deze branch schrijft niets.
    if (existing?.readStatus === "READ")
      return { state: view(existing), changed: false, counted: false, streak: null };
    if (published.revisionId !== input.revisionId)
      throw new StudyReadError("REVISION_CHANGED", view(existing));

    const now = new Date();
    const saved = existing
      ? await tx.contentProgress.update({
          where: { userId_contentKey: { userId: actor.id, contentKey } },
          data: { readStatus: "READ", readAt: existing.readAt ?? now, readStartedAt: now },
          select: { readStatus: true, readAt: true },
        })
      : await tx.contentProgress.create({
          data: { userId: actor.id, contentKey, readStatus: "READ", readStartedAt: now, readAt: now },
          select: { readStatus: true, readAt: true },
        });
    const streak = await recordLearningActivity(tx, actor.id, {
      kind: "READING",
      answered: 1,
      required: 1,
      key: `read:${contentKey}`,
    });
    return { state: view(saved), changed: true, counted: streak.counted, streak };
  }, { maxWait: 5000, timeout: 10000 });
  if (result.counted && result.streak)
    emitToUser(actor.id, "streak_changed", {
      dayEarned: result.streak.dayEarned,
      currentStreak: result.streak.currentStreak,
    });
  return result;
}
