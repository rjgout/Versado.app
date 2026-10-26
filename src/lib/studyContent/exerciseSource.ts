import { z } from "zod";
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
) {
  if (process.env.CFM_EXERCISES === "off") return null;
  const edition = await db.studyLessonEdition.findUnique({
    where: { id: editionId },
    select: { lessonId: true, collectionId: true },
  });
  if (!edition) return null;
  const lesson = await getPublishedStudyLesson(
    actor,
    edition.lessonId,
    edition.collectionId,
    db,
  );
  if (!lesson) return null;
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
    ? { lesson, plan, prepared, contentKey: studyLessonContentKey(lesson) }
    : null;
}
