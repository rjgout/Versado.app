import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getPublishedStudyLesson, type PublishedStudyDTO } from "./revisions";
import { PERSONAL_STUDY_STEPS, PERSONAL_STUDY_VERSION, validatePersonalPlan, type PersonalStudyPlan } from "./personalStudy";
import { legacyPersonalPlan, personalStudyFor } from "./personalStudyOverrides";

type Actor = { id: string; isAdmin: boolean };
export type StepStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";

/** Dezelfde veilige terugval als de lezer: een ongeldige indeling kent geen stappen. */
function plannedSteps(lesson: Parameters<typeof personalStudyFor>[0]): PersonalStudyPlan {
  const plan = personalStudyFor(lesson);
  return plan.supported && validatePersonalPlan(lesson.body, plan).length ? { supported: false, reason: "ongeldige indeling" } : plan;
}

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
  lesson: Pick<PublishedStudyDTO, "editionId" | "revisionId" | "workKey" | "sourceKey" | "body">,
  plan: PersonalStudyPlan,
  client: Pick<PrismaClient, "studyStepProgress"> = prisma,
): Promise<StepProgressState | null> {
  if (!plan.supported) return null;
  await coverLegacyProgress(actor, lesson, plan, client);
  const rows = await client.studyStepProgress.findMany({
    where: { userId: actor.id, lessonEditionId: lesson.editionId, stepFingerprint: { in: plan.steps.map((s) => s.fingerprint) } },
    select: { stepFingerprint: true, status: true, openedAt: true, completedAt: true },
  });
  return view(plan, rows);
}

/**
 * Omzetting van de zevenstappenindeling (versie 1) naar de zesstappenindeling. Een nieuwe stap geldt alleen als afgerond
 * als elke oude stap die ook maar één van zijn blokken bevat afgerond is, met een identieke inhoudsvingerafdruk (dus
 * dezelfde brontekst). Alles wat zo niet volledig gedekt is begint opnieuw; oude rijen blijven ongemoeid bewaard.
 * Idempotent: een bestaande rij van de nieuwe indeling wordt nooit overschreven of verlaagd.
 */
async function coverLegacyProgress(
  actor: Actor,
  lesson: Pick<PublishedStudyDTO, "editionId" | "revisionId" | "workKey" | "sourceKey" | "body">,
  plan: Extract<PersonalStudyPlan, { supported: true }>,
  client: Pick<PrismaClient, "studyStepProgress">,
) {
  const legacyRows = await client.studyStepProgress.findMany({
    where: { userId: actor.id, lessonEditionId: lesson.editionId, planVersion: { lt: PERSONAL_STUDY_VERSION }, status: "COMPLETED" },
    select: { stepFingerprint: true, completedAt: true },
  });
  if (!legacyRows.length) return;
  const legacy = legacyPersonalPlan(lesson);
  if (!legacy.supported) return;
  const doneAt = new Map(legacyRows.map((r) => [r.stepFingerprint, r.completedAt]));
  const legacyStepOfBlock = new Map<string, (typeof legacy.steps)[number]>();
  for (const step of legacy.steps) for (const id of step.blockIds) legacyStepOfBlock.set(id, step);
  const covered = plan.steps.flatMap((step) => {
    const sources = new Set(step.blockIds.map((id) => legacyStepOfBlock.get(id)));
    if (!sources.size || [...sources].some((source) => !source || !doneAt.has(source.fingerprint))) return [];
    const at = [...sources].map((source) => doneAt.get(source!.fingerprint)!.getTime());
    return [{ step, completedAt: new Date(Math.max(...at)) }];
  });
  if (!covered.length) return;
  await client.studyStepProgress.createMany({
    data: covered.map(({ step, completedAt }) => ({
      userId: actor.id, lessonEditionId: lesson.editionId, stepFingerprint: step.fingerprint, stepIndex: step.index,
      planVersion: PERSONAL_STUDY_VERSION, revisionId: lesson.revisionId, status: "COMPLETED" as const, openedAt: completedAt, completedAt,
    })),
    skipDuplicates: true,
  });
}

/** Aantal afgeronde stappen per editie voor de weekkaarten; telt alleen rijen van de nu gepubliceerde revisie. */
export async function completedStepCounts(
  actor: Actor,
  editions: ReadonlyArray<{ editionId: string; revisionId: string }>,
  client: Pick<PrismaClient, "studyStepProgress"> = prisma,
): Promise<Map<string, number>> {
  if (!editions.length) return new Map();
  const rows = await client.studyStepProgress.findMany({
    where: { userId: actor.id, status: "COMPLETED", planVersion: PERSONAL_STUDY_VERSION, lessonEditionId: { in: editions.map((e) => e.editionId) } },
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
      const plan = plannedSteps(published);
      if (!plan.supported) throw new StepProgressError("INVALID");
      if (published.revisionId !== input.revisionId)
        throw new StepProgressError("REVISION_CHANGED", (await getStepProgress(actor, published, plan, tx)) ?? undefined);
      const step = plan.steps[input.stepIndex - 1];
      if (!step || step.fingerprint !== input.stepFingerprint) throw new StepProgressError("INVALID");

      const changed = await applyStepProgress(tx, actor.id, { lessonEditionId: input.lessonEditionId, revisionId: published.revisionId, step, action: input.action });
      return { state: (await getStepProgress(actor, published, plan, tx))!, changed };
    },
    { maxWait: 5000, timeout: 10000 },
  );
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
/**
 * Schrijft de stapstatus binnen een transactie. Monotoon en idempotent: afgerond blijft afgerond, heropenen werkt alleen
 * "laatst geopend" bij en een tweede afronding verandert niets (changed=false). De advisory lock serialiseert gelijktijdige
 * verzoeken van dezelfde gebruiker voor dezelfde editie.
 */
export async function applyStepProgress(
  tx: Tx,
  userId: string,
  input: { lessonEditionId: string; revisionId: string; step: { index: number; fingerprint: string }; action: "OPEN" | "COMPLETE" },
): Promise<boolean> {
  const { step } = input;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([userId, "step", input.lessonEditionId])}, 0))`;
  const key = { userId_lessonEditionId_stepFingerprint: { userId, lessonEditionId: input.lessonEditionId, stepFingerprint: step.fingerprint } };
  const existing = await tx.studyStepProgress.findUnique({ where: key, select: { status: true } });
  const now = new Date();
  if (!existing) {
    await tx.studyStepProgress.create({
      data: {
        userId, lessonEditionId: input.lessonEditionId, stepFingerprint: step.fingerprint, stepIndex: step.index, planVersion: PERSONAL_STUDY_VERSION,
        revisionId: input.revisionId, openedAt: now,
        status: input.action === "COMPLETE" ? "COMPLETED" : "IN_PROGRESS", completedAt: input.action === "COMPLETE" ? now : null,
      },
    });
    return true;
  }
  if (input.action === "COMPLETE" && existing.status !== "COMPLETED") {
    await tx.studyStepProgress.update({ where: key, data: { status: "COMPLETED", completedAt: now, openedAt: now, revisionId: input.revisionId, stepIndex: step.index } });
    return true;
  }
  // Heropenen of dubbele afronding: alleen "laatst geopend" en de revisie bijwerken, nooit de status verlagen.
  await tx.studyStepProgress.update({ where: key, data: { openedAt: now, revisionId: input.revisionId, stepIndex: step.index } });
  return false;
}

/** Leesroute voor de stapkaarten: eigen rechten, geen schrijfactie; null als de les niet beschikbaar of niet ondersteund is. */
export async function getStepProgressForEdition(actor: Actor, lessonEditionId: string, client: PrismaClient = prisma) {
  const edition = await client.studyLessonEdition.findUnique({ where: { id: lessonEditionId }, select: { lessonId: true, collectionId: true } });
  if (!edition) return null;
  const published = await getPublishedStudyLesson(actor, edition.lessonId, edition.collectionId, client);
  if (!published || published.editionId !== lessonEditionId) return null;
  const plan = plannedSteps(published);
  const state = await getStepProgress(actor, published, plan, client);
  if (!state || !plan.supported) return null;
  // De stapkaarten (titel, schriftgedeelten) komen mee zodat het weekpad een week lui kan uitklappen zonder de les te laden.
  return {
    revisionId: published.revisionId,
    state,
    steps: plan.steps.map((s) => ({ index: s.index, title: s.title, continued: s.continued, labels: s.labels, fingerprint: s.fingerprint })),
  };
}

/**
 * De stap waar de gebruiker verder kan: de laatst geopende stap als die nog niet klaar is, anders de eerste onafgeronde.
 * Zijn alle zes stappen af, dan de laatste stap (daar staat de uitnodiging om de les als gelezen te markeren). Nooit een vergrendeling.
 */
export function activeStepIndex(steps: ReadonlyArray<{ index: number; fingerprint: string }>, state: StepProgressState): number {
  const statusOf = (fingerprint: string) => state.steps.find((s) => s.fingerprint === fingerprint)?.status ?? "NOT_STARTED";
  const lastOpened = steps.find((s) => s.index === state.lastOpenedIndex);
  const active =
    (lastOpened && statusOf(lastOpened.fingerprint) !== "COMPLETED" ? lastOpened : null) ??
    steps.find((s) => statusOf(s.fingerprint) !== "COMPLETED") ??
    null;
  return active?.index ?? steps[steps.length - 1]?.index ?? 1;
}
