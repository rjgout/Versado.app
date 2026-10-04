import type { MessageKey } from "@/lib/i18n/core";

/** Vaste productvolgorde: wijzig deze lijst alleen bewust, want dit is UX én data. */
export const EXERCISE_FEEDBACK_OPTIONS = [
  { code: "ANSWER_SHOULD_BE_ACCEPTED", labelKey: "feedback.exercise.categories.answerShouldBeAccepted" },
  { code: "ANSWER_SHOULD_BE_REJECTED", labelKey: "feedback.exercise.categories.answerShouldBeRejected" },
  { code: "QUESTION_UNCLEAR", labelKey: "feedback.exercise.categories.questionUnclear" },
  { code: "ANSWERS_INCORRECT", labelKey: "feedback.exercise.categories.answersIncorrect" },
  { code: "VISUAL_BROKEN", labelKey: "feedback.exercise.categories.visualBroken" },
  { code: "OTHER", labelKey: "feedback.exercise.categories.other" },
] as const satisfies readonly { code: string; labelKey: MessageKey }[];

export type ExerciseFeedbackCategory = (typeof EXERCISE_FEEDBACK_OPTIONS)[number]["code"];
export type ExerciseFeedbackSource = "SCRIPTURE" | "INTRO" | "KIDS" | "PODCAST";

export function isExerciseFeedbackCategory(value: string): value is ExerciseFeedbackCategory {
  return EXERCISE_FEEDBACK_OPTIONS.some((option) => option.code === value);
}

export interface ExerciseFeedbackContext {
  questionId: string;
  source: ExerciseFeedbackSource;
  courseId?: string;
  lessonId?: string;
  contentKey?: string;
  chapterId?: string;
  verseRef?: string;
  contentLanguage?: string;
}
