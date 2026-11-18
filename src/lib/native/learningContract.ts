import { z } from "zod";
import { nativeCourseId as id } from "./coursesContract";

/** Geen clientbeoordeling: identiteit en expliciete intentie, nooit score/XP. */
export const nativeLearningScope = z.object({
  activeCollectionId: id,
  selectionVersion: z.number().int().nonnegative(),
  language: z.enum(["nl", "en", "de", "fr", "es"]),
  chapterId: id,
  startVerse: z.number().int().min(1).max(500),
  endVerse: z.number().int().min(1).max(500),
}).strict();
const given = z.array(z.string().max(2000)).min(1).max(100);
export const nativeLearningStart = nativeLearningScope.extend({ actionId: z.uuid() }).strict();
export const nativeLearningSubmit = nativeLearningScope.extend({
  sessionId: z.uuid(),
  answers: z.array(z.object({ exerciseId: id, given }).strict()).min(1).max(300),
}).strict();
export const nativeLearningCheck = nativeLearningScope.extend({ sessionId: z.uuid(), exerciseId: id, given }).strict();
export type NativeLearningScope = z.infer<typeof nativeLearningScope>;
export type NativeLearningStart = z.infer<typeof nativeLearningStart>;
export type NativeLearningSubmit = z.infer<typeof nativeLearningSubmit>;
export type NativeLearningCheck = z.infer<typeof nativeLearningCheck>;
export const NATIVE_LEARNING_CAPABILITY = "scripture-learning-v1";

/** Alleen types uit het bestaande domein; geen servercode in de native bundel. */
export type NativeLearningOutcome =
  | (import("@/lib/learning/contentProgress").ContentExerciseResult & { nextLessonId?: string | null; nextChapterId?: string | null })
  | { nextLessonId: string | null }
  | { content: import("@/lib/learning/contentProgress").ChapterContentState; counted: boolean; nextChapterId: string | null };
export interface NativeLearningSession {
  version: 1;
  sessionId: string;
  status: "open" | "submitted";
  exercises: import("@/lib/learning/contentProgress").IssuedExercise[];
  outcome: NativeLearningOutcome | null;
  replayed?: boolean;
}
