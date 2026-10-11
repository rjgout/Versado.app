import { z } from "zod";

export const studyWorkKeySchema = z.string().min(1).max(128).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const studyContextActionSchema = z.object({
  workKey: studyWorkKeySchema,
  activeLessonKey: z.string().min(1).max(256).nullable(),
  expectedVersion: z.number().int().min(0).max(2_147_483_646),
  actionId: z.uuid(),
}).strict();
export type StudyContextAction = z.infer<typeof studyContextActionSchema>;

export interface StudyContextView {
  workKey: string;
  activeLessonKey: string | null;
  version: number;
  updatedAt: string | null;
  available: boolean;
  /** Alleen een normale, toegankelijke gepubliceerde les krijgt een bestemming. */
  lessonHref: string | null;
}

/** Voeg dit naast collectie/taal toe aan toekomstige lesgebonden querykeys. */
export function studyContextIdentity(context: Pick<StudyContextView, "workKey" | "activeLessonKey" | "version">) {
  return { studyWork: context.workKey, studyLesson: context.activeLessonKey, studyVersion: context.version };
}
