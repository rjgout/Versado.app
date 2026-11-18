BEGIN;
-- Additief: bestaande web-/CFM-sessies en alle voortgang blijven ongewijzigd.
ALTER TABLE "ExerciseSession" ADD COLUMN "nativeContext" JSONB;
ALTER TABLE "ExerciseSession" ADD CONSTRAINT "ExerciseSession_native_context_check" CHECK (
  "nativeContext" IS NULL OR ("chapterId" IS NOT NULL AND "studyContext" IS NULL AND
  COALESCE(jsonb_typeof("nativeContext") = 'object' AND "nativeContext"->'nativeLearning' = '1'::jsonb, false)));
-- courseLessonId blijft herschrijfbaar voor de bestaande historische FK-remap.
-- De oorspronkelijke native route/grenzen blijven immutable in nativeContext.
CREATE FUNCTION protect_native_learning_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."nativeContext" IS NOT NULL AND
    (NEW.id,NEW."userId",NEW."chapterId",NEW."contentKey",NEW."exerciseIds",NEW."nativeContext",NEW."createdAt") IS DISTINCT FROM
    (OLD.id,OLD."userId",OLD."chapterId",OLD."contentKey",OLD."exerciseIds",OLD."nativeContext",OLD."createdAt") THEN
    RAISE EXCEPTION 'NATIVE_LEARNING_SESSION_IMMUTABLE';
  END IF;
  IF OLD."nativeContext" IS NOT NULL AND OLD."submittedAt" IS NOT NULL AND
    (NEW."submittedAt" IS DISTINCT FROM OLD."submittedAt" OR (OLD.result IS NOT NULL AND NEW.result IS DISTINCT FROM OLD.result)) THEN
    RAISE EXCEPTION 'NATIVE_LEARNING_RESULT_IMMUTABLE';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER native_learning_session_identity BEFORE UPDATE ON "ExerciseSession"
  FOR EACH ROW EXECUTE FUNCTION protect_native_learning_session();
-- De bestaande result_check (result alleen na submittedAt) blijft intact.
COMMIT;
