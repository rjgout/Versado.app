import { z } from "zod";
const answer = z
  .object({
    exerciseId: z.string().min(1).max(128),
    given: z.array(z.string().max(2000)).min(1).max(30),
    correct: z.boolean(),
  })
  .strict();
const schema = z
  .object({
    index: z.number().int().nonnegative(),
    answers: z.array(answer).max(18),
    reviewQueue: z.array(z.string()).max(18).nullable(),
    reviewPos: z.number().int().nonnegative(),
    pending: z.array(answer).max(18).nullable(),
  })
  .strict();
export type ExerciseCheckpoint = z.infer<typeof schema>;
/** Alleen herstel van de UI. Inleveren en XP worden altijd opnieuw op de server beoordeeld. */
export function restoreExerciseCheckpoint(
  value: unknown,
  ids: string[],
): ExerciseCheckpoint | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success || !ids.length) return null;
  const checkpoint = parsed.data;
  if (
    checkpoint.index >= ids.length ||
    checkpoint.answers.some((a, i) => a.exerciseId !== ids[i]) ||
    new Set(checkpoint.answers.map((a) => a.exerciseId)).size !==
      checkpoint.answers.length
  )
    return null;
  if (
    checkpoint.reviewQueue !== null &&
    (!checkpoint.reviewQueue.length ||
      checkpoint.reviewPos >= checkpoint.reviewQueue.length ||
      checkpoint.answers.length !== ids.length ||
      new Set(checkpoint.reviewQueue).size !== checkpoint.reviewQueue.length ||
      checkpoint.reviewQueue.some((id) => !ids.includes(id)))
  )
    return null;
  if (
    checkpoint.pending !== null &&
    (checkpoint.pending.length !== ids.length ||
      checkpoint.pending.some((a, i) => a.exerciseId !== ids[i]))
  )
    return null;
  if (
    checkpoint.reviewQueue === null &&
    checkpoint.pending === null &&
    checkpoint.answers.length !== checkpoint.index
  )
    return null;
  return checkpoint;
}

export function studyExerciseDraftKey(
  sessionKey: string,
  editionId: string,
  revisionId: string,
  stepIndex: number | null,
) {
  return `cfm-exercise:${sessionKey}:${editionId}:${revisionId}:${stepIndex ?? "week"}`;
}
