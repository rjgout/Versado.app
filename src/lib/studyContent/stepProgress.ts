import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPublishedStudyLesson, type PublishedStudyDTO } from "./revisions";
import { PERSONAL_STUDY_STEPS, type PersonalStudyPlan } from "./personalStudy";
import { personalStudyFor } from "./personalStudyOverrides";

type Actor = { id: string; isAdmin: boolean };
export type StepStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

export class StepProgressError extends Error {
  constructor(
    readonly code: "INVALID" | "UNAVAILABLE" | "REVISION_CHANGED",
    readonly state?: StepProgressState,
  ) {
    super(code);
  }
}
export interface StepProgressState {
  steps: Array<{ index: number; fingerprint: string; status: StepStatus; completedAt: string | null }>;
  /** Stapnummer dat het laatst is geopend binnen de huidige indeling, of null. */
  lastOpenedIndex: number | null;
  completedCount: number;
  allCompleted: boolean;
}

type Row = { stepFingerprint: string; status: "IN_PROGRESS" | "COMPLETED"; openedAt: Date; completedAt: Date | null };
function view(plan: Extract<PersonalStudyPlan, { supported: true }>, rows: Row[]): StepProgressState {
  // Voortgang telt alleen mee bij een identieke inhoudsvingerafdruk: een nieuwe revisie met andere stapgrenzen
  // begint die stap opnieuw in plaats van stil als afgerond te gelden.
  const byFingerprint = new Map(rows.map((r) => [r.stepFingerprint, r]));
  const steps = plan.steps.map((s) => {
    const row = byFingerprint.get(s.fingerprint);
    return {
      index: s.index,
      fingerprint: s.fingerprint,
      status: (row ? row.status : "NOT_STARTED") as StepStatus,
      completedAt: row?.completedAt?.toISOString() ?? null,
    };
  });
  const opened = plan.steps
    .map((s) => ({ index: s.index, at: byFingerprint.get(s.fingerprint)?.openedAt.getTime() ?? -1 }))
    .filter((s) => s.at >= 0)
    .sort((a, b) => b.at - a.at || a.index - b.index)[0];
  const completedCount = steps.filter((s) => s.status === "COMPLETED").length;
  return { steps, lastOpenedIndex: opened?.index ?? null, completedCount, allCompleted: completedCount === PERSONAL_STUDY_STEPS };
}

export async function getStepProgress(
  actor: Actor,
  lesson: Pick<PublishedStudyDTO, "editionId">,
  plan: PersonalStudyPlan,
  client: Pick<PrismaClient, "studyStepProgress"> = prisma,
): Promise<StepProgressState | null> {
  if (!plan.supported) return null;
  const rows = await client.studyStepProgress.findMany({
    where: { userId: actor.id, lessonEditionId: lesson.editionId, stepFingerprint: { in: plan.steps.map((s) => s.fingerprint) } },
    select: { stepFingerprint: true, status: true, openedAt: true, completedAt: true },
  });
  return view(plan, rows);
}

/** Aantal afgeronde stappen per editie voor de weekkaarten; telt alleen rijen van de nu gepubliceerde revisie. */
export async function completedStepCounts(
  actor: Actor,
  editions: ReadonlyArray<{ editionId: string; revisionId: string }>,
  client: Pick<PrismaClient, "studyStepProgress"> = prisma,
): Promise<Map<string, number>> {
  if (!editions.length) return new Map();
  const rows = await client.studyStepProgress.findMany({
    where: { userId: actor.id, status: "COMPLETED", lessonEditionId: { in: editions.map((e) => e.editionId) } },
    select: { lessonEditionId: true, revisionId: true },
  });
  const current = new Map(editions.map((e) => [e.editionId, e.revisionId]));
  const counts = new Map<string, number>();
  for (const row of rows)
    if (current.get(row.lessonEditionId) === row.revisionId) counts.set(row.lessonEditionId, (counts.get(row.lessonEditionId) ?? 0) + 1);
  return counts;
}

/**
 * Stap openen of afronden. Uitsluitend studievoortgang: geen READ-actie, reeks, XP of celebration. Herhalen is
 * idempotent en de status is monotoon (afgerond blijft afgerond), zodat twee apparaten elkaar nooit terugzetten.
 */
export async function recordStepProgress(
  actor: Actor,
  input: { lessonEditionId: string; revisionId: string; stepIndex: number; stepFingerprint: string; action: "OPEN" | "COMPLETE" },
  client: PrismaClient = prisma,
): Promise<{ state: StepProgressState; changed: boolean }> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout='5s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout='5s'`;
      // Zelfde lock als de leesactie: een pointerwissel van de publicatie valt niet tussen controle en schrijven.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "StudyLessonEdition" WHERE id=${input.lessonEditionId} FOR SHARE`;
      if (!locked.length) throw new StepProgressError("UNAVAILABLE");
      const edition = await tx.studyLessonEdition.findUnique({ where: { id: input.lessonEditionId }, select: { lessonId: true, collectionId: true } });
      if (!edition) throw new StepProgressError("UNAVAILABLE");
      const published = await getPublishedStudyLesson(actor, edition.lessonId, edition.collectionId, tx);
      if (!published || published.editionId !== input.lessonEditionId) throw new StepProgressError("UNAVAILABLE");
      const plan = personalStudyFor(published);
      if (!plan.supported) throw new StepProgressError("INVALID");
      if (published.revisionId !== input.revisionId)
        throw new StepProgressError("REVISION_CHANGED", (await getStepProgress(actor, published, plan, tx)) ?? undefined);
      const step = plan.steps[input.stepIndex - 1];
      if (!step || step.fingerprint !== input.stepFingerprint) throw new StepProgressError("INVALID");

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([actor.id, "step", input.lessonEditionId])}, 0))`;
      const key = { userId_lessonEditionId_stepFingerprint: { userId: actor.id, lessonEditionId: input.lessonEditionId, stepFingerprint: step.fingerprint } };
      const existing = await tx.studyStepProgress.findUnique({ where: key, select: { status: true } });
      const now = new Date();
      let changed = false;
      if (!existing) {
        await tx.studyStepProgress.create({
          data: {
            userId: actor.id, lessonEditionId: input.lessonEditionId, stepFingerprint: step.fingerprint, stepIndex: step.index,
            revisionId: published.revisionId, openedAt: now,
            status: input.action === "COMPLETE" ? "COMPLETED" : "IN_PROGRESS", completedAt: input.action === "COMPLETE" ? now : null,
          },
        });
        changed = true;
      } else if (input.action === "COMPLETE" && existing.status !== "COMPLETED") {
        await tx.studyStepProgress.update({ where: key, data: { status: "COMPLETED", completedAt: now, openedAt: now, revisionId: published.revisionId, stepIndex: step.index } });
        changed = true;
      } else {
        // Heropenen of dubbele afronding: alleen "laatst geopend" en de revisie bijwerken, nooit de status verlagen.
        await tx.studyStepProgress.update({ where: key, data: { openedAt: now, revisionId: published.revisionId, stepIndex: step.index } });
      }
      return { state: (await getStepProgress(actor, published, plan, tx))!, changed };
    },
    { maxWait: 5000, timeout: 10000 },
  );
}

/** Leesroute voor de stapkaarten: eigen rechten, geen schrijfactie; null als de les niet beschikbaar of niet ondersteund is. */
export async function getStepProgressForEdition(actor: Actor, lessonEditionId: string, client: PrismaClient = prisma) {
  const edition = await client.studyLessonEdition.findUnique({ where: { id: lessonEditionId }, select: { lessonId: true, collectionId: true } });
  if (!edition) return null;
  const published = await getPublishedStudyLesson(actor, edition.lessonId, edition.collectionId, client);
  if (!published || published.editionId !== lessonEditionId) return null;
  const plan = personalStudyFor(published);
  const state = await getStepProgress(actor, published, plan, client);
  return state ? { revisionId: published.revisionId, state } : null;
}
