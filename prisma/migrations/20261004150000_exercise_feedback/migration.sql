-- Vraagfeedback leeft bewust in dezelfde tabel als profiel-feedback, zodat
-- status, admin-afhandeling en de gebruikerslijst niet dubbel worden.
CREATE TYPE "FeedbackKind" AS ENUM ('GENERAL', 'EXERCISE');
CREATE TYPE "ExerciseFeedbackCategory" AS ENUM (
  'ANSWER_SHOULD_BE_ACCEPTED',
  'ANSWER_SHOULD_BE_REJECTED',
  'QUESTION_UNCLEAR',
  'ANSWERS_INCORRECT',
  'VISUAL_BROKEN',
  'OTHER'
);
CREATE TYPE "ExerciseFeedbackSource" AS ENUM ('SCRIPTURE', 'INTRO', 'KIDS', 'PODCAST');

ALTER TABLE "Feedback"
  ADD COLUMN "kind" "FeedbackKind" NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "questionId" TEXT,
  ADD COLUMN "questionSource" "ExerciseFeedbackSource",
  ADD COLUMN "questionCategory" "ExerciseFeedbackCategory",
  ADD COLUMN "courseId" TEXT,
  ADD COLUMN "lessonId" TEXT,
  ADD COLUMN "contentKey" TEXT,
  ADD COLUMN "chapterId" TEXT,
  ADD COLUMN "verseRef" TEXT,
  ADD COLUMN "questionType" "ExerciseType",
  ADD COLUMN "givenAnswer" TEXT,
  ADD COLUMN "correctAnswer" TEXT,
  ADD COLUMN "uiLanguage" TEXT,
  ADD COLUMN "contentLanguage" TEXT,
  ADD COLUMN "questionSnapshot" TEXT,
  ADD COLUMN "submissionKey" TEXT;

CREATE UNIQUE INDEX "Feedback_submissionKey_key" ON "Feedback"("submissionKey");
CREATE INDEX "Feedback_questionId_questionSource_idx" ON "Feedback"("questionId", "questionSource");
