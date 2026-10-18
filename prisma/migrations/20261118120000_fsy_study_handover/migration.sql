BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "FsyLesson" ADD COLUMN "studyLessonEditionId" TEXT;
CREATE UNIQUE INDEX "FsyLesson_studyLessonEditionId_key" ON "FsyLesson"("studyLessonEditionId");
ALTER TABLE "FsyLesson" ADD CONSTRAINT "FsyLesson_studyLessonEditionId_fkey"
  FOREIGN KEY ("studyLessonEditionId") REFERENCES "StudyLessonEdition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
-- Geen backfill of writerwissel: alleen een bewuste conversietransactie mag de mapping zetten.
CREATE FUNCTION versado_fsy_writer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."studyLessonEditionId" IS NOT NULL THEN RAISE EXCEPTION 'FSY_STUDY_MAPPING_INVALID'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."studyLessonEditionId" IS NOT NULL THEN RAISE EXCEPTION 'FSY_STUDY_WRITER_ACTIVE'; END IF;
    RETURN OLD;
  END IF;
  IF OLD."studyLessonEditionId" IS NOT NULL THEN
    IF to_jsonb(NEW) - 'studyLessonEditionId' IS DISTINCT FROM to_jsonb(OLD) - 'studyLessonEditionId' THEN
      RAISE EXCEPTION 'FSY_STUDY_WRITER_ACTIVE';
    END IF;
    IF NEW."studyLessonEditionId" IS DISTINCT FROM OLD."studyLessonEditionId" AND
      NOT (NEW."studyLessonEditionId" IS NULL AND coalesce(current_setting('versado.fsy_handover', true), '') = 'rollback') THEN
      RAISE EXCEPTION 'FSY_STUDY_WRITER_ACTIVE';
    END IF;
  ELSIF NEW."studyLessonEditionId" IS NOT NULL THEN
    IF current_setting('versado.fsy_handover', true) IS DISTINCT FROM 'convert' OR
      to_jsonb(NEW) - 'studyLessonEditionId' IS DISTINCT FROM to_jsonb(OLD) - 'studyLessonEditionId' OR
      NOT EXISTS (SELECT 1 FROM "StudyLessonEdition" e JOIN "StudyLesson" l ON l.id=e."lessonId"
        WHERE e.id=NEW."studyLessonEditionId" AND e."collectionId"=OLD."contentCollectionId"
          AND e."workKey"='fsy' AND l."sourceKey"='fsy:' || OLD.id AND l.month=OLD.month AND l."categoryKey"=OLD.category) THEN
      RAISE EXCEPTION 'FSY_STUDY_MAPPING_INVALID';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "FsyLesson_writer_guard" BEFORE INSERT OR UPDATE OR DELETE ON "FsyLesson"
  FOR EACH ROW EXECUTE FUNCTION versado_fsy_writer_guard();
COMMIT;
