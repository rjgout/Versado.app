-- Alleen vier nieuwe lestabellen en één aanvullende unieke collectie-index.
-- Eén atomische DDL-eenheid; geen backfill, FSY-sync of wijziging van bestaande records.
DO $migration$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '60s', true);
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname=current_schema() AND tablename IN ('StudyPeriod','StudyLesson','StudyLessonEdition','StudyRevision'))
     OR to_regprocedure('"rejectStudyRevisionMutation"()') IS NOT NULL THEN
    RAISE EXCEPTION 'STUDY_IDENTITY_REVIEW_REQUIRED';
  END IF;
-- CreateTable
CREATE TABLE "StudyPeriod" (
    "id" TEXT NOT NULL,
    "workKey" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "year" INTEGER,
    "metadata" JSONB,

    CONSTRAINT "StudyPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyLesson" (
    "id" TEXT NOT NULL,
    "workKey" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "categoryKey" TEXT,
    "month" INTEGER,
    "startsOn" DATE,
    "endsOnExclusive" DATE,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "StudyLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyLessonEdition" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "workKey" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "publishedRevisionId" TEXT,
    "draftRevisionId" TEXT,

    CONSTRAINT "StudyLessonEdition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyRevision" (
    "id" TEXT NOT NULL,
    "lessonEditionId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB NOT NULL,
    "sourceMetadata" JSONB NOT NULL,
    "rightsMetadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudyPeriod_workKey_sourceKey_key" ON "StudyPeriod"("workKey", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "StudyPeriod_id_workKey_key" ON "StudyPeriod"("id", "workKey");

-- CreateIndex
CREATE INDEX "StudyLesson_periodId_order_id_idx" ON "StudyLesson"("periodId", "order", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StudyLesson_workKey_periodId_sourceKey_key" ON "StudyLesson"("workKey", "periodId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "StudyLesson_id_workKey_key" ON "StudyLesson"("id", "workKey");

-- CreateIndex
CREATE INDEX "StudyLessonEdition_publishedRevisionId_id_idx" ON "StudyLessonEdition"("publishedRevisionId", "id");

-- CreateIndex
CREATE INDEX "StudyLessonEdition_draftRevisionId_id_idx" ON "StudyLessonEdition"("draftRevisionId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StudyLessonEdition_lessonId_collectionId_key" ON "StudyLessonEdition"("lessonId", "collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "StudyLessonEdition_collectionId_slug_key" ON "StudyLessonEdition"("collectionId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "StudyRevision_lessonEditionId_revisionNumber_key" ON "StudyRevision"("lessonEditionId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StudyRevision_id_lessonEditionId_key" ON "StudyRevision"("id", "lessonEditionId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentCollection_id_work_key" ON "ContentCollection"("id", "work");

-- AddForeignKey
ALTER TABLE "StudyPeriod" ADD CONSTRAINT "StudyPeriod_workKey_fkey" FOREIGN KEY ("workKey") REFERENCES "ContentWork"("key") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyLesson" ADD CONSTRAINT "StudyLesson_workKey_fkey" FOREIGN KEY ("workKey") REFERENCES "ContentWork"("key") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyLesson" ADD CONSTRAINT "StudyLesson_periodId_workKey_fkey" FOREIGN KEY ("periodId", "workKey") REFERENCES "StudyPeriod"("id", "workKey") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyLessonEdition" ADD CONSTRAINT "StudyLessonEdition_lessonId_workKey_fkey" FOREIGN KEY ("lessonId", "workKey") REFERENCES "StudyLesson"("id", "workKey") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyLessonEdition" ADD CONSTRAINT "StudyLessonEdition_collectionId_workKey_fkey" FOREIGN KEY ("collectionId", "workKey") REFERENCES "ContentCollection"("id", "work") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyLessonEdition" ADD CONSTRAINT "StudyLessonEdition_publishedRevisionId_id_fkey" FOREIGN KEY ("publishedRevisionId", "id") REFERENCES "StudyRevision"("id", "lessonEditionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyLessonEdition" ADD CONSTRAINT "StudyLessonEdition_draftRevisionId_id_fkey" FOREIGN KEY ("draftRevisionId", "id") REFERENCES "StudyRevision"("id", "lessonEditionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyRevision" ADD CONSTRAINT "StudyRevision_lessonEditionId_fkey" FOREIGN KEY ("lessonEditionId") REFERENCES "StudyLessonEdition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "StudyPeriod" ADD CONSTRAINT "StudyPeriod_source_fields_check" CHECK (length(btrim("sourceKey")) BETWEEN 1 AND 512 AND length(btrim(label)) BETWEEN 1 AND 500);
ALTER TABLE "StudyLesson" ADD CONSTRAINT "StudyLesson_source_calendar_check" CHECK (length(btrim("sourceKey")) BETWEEN 1 AND 512 AND "order" >= 0 AND (month IS NULL OR month BETWEEN 1 AND 12) AND ("startsOn" IS NULL OR "endsOnExclusive" IS NULL OR "startsOn" < "endsOnExclusive"));
ALTER TABLE "StudyLessonEdition" ADD CONSTRAINT "StudyLessonEdition_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 256);
ALTER TABLE "StudyRevision" ADD CONSTRAINT "StudyRevision_content_check" CHECK ("revisionNumber" > 0 AND "schemaVersion" > 0 AND "contentHash" ~ '^[0-9a-f]{64}$' AND length(btrim(title)) BETWEEN 1 AND 500 AND jsonb_typeof(body) = 'object' AND body->>'schemaVersion' IS NOT NULL AND body->>'schemaVersion' = "schemaVersion"::text AND jsonb_typeof("sourceMetadata") = 'object' AND jsonb_typeof("rightsMetadata") = 'object');
EXECUTE $function$
CREATE FUNCTION "rejectStudyRevisionMutation"() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  RAISE EXCEPTION 'STUDY_REVISION_IMMUTABLE' USING ERRCODE='55000';
END
$body$;
$function$;
CREATE TRIGGER "StudyRevision_immutable" BEFORE UPDATE OR DELETE ON "StudyRevision" FOR EACH ROW EXECUTE FUNCTION "rejectStudyRevisionMutation"();

END $migration$;
