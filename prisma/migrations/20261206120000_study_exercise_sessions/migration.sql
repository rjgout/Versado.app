BEGIN;
ALTER TABLE "Exercise" ALTER COLUMN "chapterId" DROP NOT NULL;
ALTER TABLE "Exercise" ADD COLUMN "studyLessonEditionId" TEXT, ADD COLUMN "studySource" JSONB;
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_studyEdition_fkey" FOREIGN KEY ("studyLessonEditionId") REFERENCES "StudyLessonEdition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_content_target_check" CHECK (
  ("chapterId" IS NOT NULL AND "studyLessonEditionId" IS NULL AND "studySource" IS NULL) OR
  ("chapterId" IS NULL AND "studyLessonEditionId" IS NOT NULL AND "studySource" IS NOT NULL AND "sourceVerseId" IS NULL));
CREATE INDEX "Exercise_studyLessonEditionId_idx" ON "Exercise"("studyLessonEditionId");
ALTER TABLE "ExerciseSession" ALTER COLUMN "chapterId" DROP NOT NULL;
ALTER TABLE "ExerciseSession" ADD COLUMN "studyContext" JSONB, ADD COLUMN "result" JSONB;
ALTER TABLE "ExerciseSession" ADD CONSTRAINT "ExerciseSession_content_target_check" CHECK (
  ("chapterId" IS NOT NULL AND "studyContext" IS NULL) OR
  ("chapterId" IS NULL AND "studyContext" IS NOT NULL AND "courseLessonId" IS NULL));
ALTER TABLE "ExerciseSession" ADD CONSTRAINT "ExerciseSession_result_check" CHECK ("result" IS NULL OR "submittedAt" IS NOT NULL);
CREATE FUNCTION protect_study_exercise_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."studyContext" IS NOT NULL OR NEW."studyContext" IS NOT NULL) AND
     (NEW."userId",NEW."chapterId",NEW."contentKey",NEW."exerciseIds",NEW."studyContext",NEW."courseLessonId",NEW."createdAt") IS DISTINCT FROM
     (OLD."userId",OLD."chapterId",OLD."contentKey",OLD."exerciseIds",OLD."studyContext",OLD."courseLessonId",OLD."createdAt") THEN
    RAISE EXCEPTION 'STUDY_EXERCISE_SESSION_IMMUTABLE';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER study_exercise_session_identity BEFORE UPDATE ON "ExerciseSession" FOR EACH ROW EXECUTE FUNCTION protect_study_exercise_session();
COMMIT;
