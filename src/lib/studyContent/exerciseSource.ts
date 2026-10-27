import { prisma } from "@/lib/db";
import { QUESTIONS_PER_PART as STUDY_PART_SIZE } from "@/lib/learning/exercisePlan";
import { z } from "zod";
import { loadPilotReadings } from "./pilotReadingSource";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { getPublishedStudyLesson } from "./revisions";
import { studyLessonContentKey } from "./readStatus";
import {
  generateStudyQuestion,
  preparedStudyQuestions,
  studyExercisePlan,
  studyQuestionSourceSchema,
  type StudyQuestion,
} from "./exercisePlan";
export type ExerciseActor = { id: string; isAdmin: boolean };
export const studyExerciseContextSchema = z
  .object({
    editionId: z.string(),
    revisionId: z.string(),
    fingerprint: z.string(),
    stepIndex: z.number().int().min(1).max(6).nullable(),
  })
  .strict();
export type StudyExerciseContext = z.infer<typeof studyExerciseContextSchema>;
export async function loadStudyExerciseSource(
  actor: ExerciseActor,
  editionId: string,
  db: PrismaClient | Prisma.TransactionClient,
  lockScriptures = false,
) {
  if (process.env.CFM_EXERCISES === "off") return null;
  const edition = await db.studyLessonEdition.findUnique({
    where: { id: editionId },
    select: { lessonId: true, collectionId: true },
  });
  if (!edition) return null;
  const published = await getPublishedStudyLesson(
    actor,
    edition.lessonId,
    edition.collectionId,
    db,
  );
  if (!published) return null;
  const scriptureReadings = await loadPilotReadings(
    actor,
    published,
    db,
    lockScriptures,
  );
  const lesson = { ...published, scriptureReadings };
  const stored = await db.exercise.findMany({
    where: { studyLessonEditionId: editionId },
    include: { options: { orderBy: { order: "asc" } } },
  });
  const prepared = preparedStudyQuestions(lesson);
  const questions: StudyQuestion[] = stored.flatMap((row) => {
    const source = studyQuestionSourceSchema.safeParse(row.studySource);
    if (row.status !== "APPROVED" || !source.success) return [];
    const generated = generateStudyQuestion(source.data, lesson.language);
    if (
      !generated ||
      generated.type !== row.type ||
      generated.prompt !== row.prompt ||
      JSON.stringify(generated.answers) !== row.answers ||
      JSON.stringify(generated.wordBank ?? null) !== (row.wordBank ?? "null") ||
      JSON.stringify(generated.options ?? []) !==
        JSON.stringify(row.options.map((o) => o.label))
    )
      return [];
    return [{ ...generated, id: row.id, studySource: source.data }];
  });
  for (const question of prepared)
    if (!stored.some((e) => e.id === question.id)) questions.push(question);
  const plan = studyExercisePlan(lesson, questions);
  return plan
    ? {
        lesson,
        plan,
        prepared,
        scriptureReadings,
        contentKey: studyLessonContentKey(lesson),
      }
    : null;
}

/** Alleen navigatieadvies uit dezelfde goedgekeurde set en bestaande inzendhistorie.
 * Een volledig ingeleverde set telt ongeacht de score; leesstatus en XP zijn geen quizvoltooiing.
 * Transport-/databasefouten worden bewust niet als ontbrekende vragen behandeld.
 */
export async function studyStepQuestionState(
  actor: ExerciseActor,
  input: { editionId: string; revisionId: string; stepIndex: number; exerciseSessionId?: string },
): Promise<"available" | "completed" | "unavailable"> {
  const source = await loadStudyExerciseSource(actor, input.editionId, prisma);
  if (!source) return "unavailable";
  if (source.lesson.revisionId !== input.revisionId) throw new Error("REVISION_CHANGED");
  const part = source.plan.parts.find(p => p.index === input.stepIndex);
  if (!part || part.questions.length !== STUDY_PART_SIZE) return "unavailable";
  const where: Prisma.ExerciseSessionWhereInput = {
      userId: actor.id, contentKey: source.contentKey, chapterId: null,
      submittedAt: { not: null },
      exerciseIds: { in: [JSON.stringify(part.questions.map(q => q.id)), JSON.stringify(source.plan.parts.flatMap(p => p.questions.map(q => q.id)))] },
      AND: [
        { studyContext: { path: ["editionId"], equals: input.editionId } },
        { studyContext: { path: ["revisionId"], equals: input.revisionId } },
        { studyContext: { path: ["fingerprint"], equals: source.plan.fingerprint } },
      ],
  };
  const completed = await prisma.exerciseSession.findFirst({ where, select: { id: true } });
  if (!completed) return "available";
  // Herstel een reeds ingeleverde eigen sessie na antwoordverlies naar het resultaat.
  // Een oudere onafgemaakte set verplicht niet opnieuw na voltooiing via de weekroute.
  if (input.exerciseSessionId && await prisma.exerciseSession.findFirst({
    where: { ...where, id: input.exerciseSessionId }, select: { id: true },
  })) return "available";
  return "completed";
}
