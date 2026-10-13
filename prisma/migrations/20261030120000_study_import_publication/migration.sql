-- Goedgekeurde fase 2B: alleen additief, één atomische DDL-eenheid.
-- Geen FSY-conversie, backfill, import of wijziging van bestaande publicatiepointers.
DO $migration$
BEGIN
 PERFORM set_config('lock_timeout','5s',true);
 PERFORM set_config('statement_timeout','60s',true);
 IF EXISTS(SELECT 1 FROM pg_tables WHERE schemaname=current_schema() AND tablename IN
 ('ContentImportRun','ContentImportItem','ContentMedia','StudyRevisionMedia','ContentReference','StudyPublicationAction'))
 OR to_regtype('"ContentImportStatus"') IS NOT NULL OR to_regtype('"ContentMediaStatus"') IS NOT NULL THEN
  RAISE EXCEPTION 'STUDY_PUBLICATION_REVIEW_REQUIRED';
 END IF;
-- CreateEnum
CREATE TYPE "ContentImportStatus" AS ENUM ('CREATED', 'RUNNING', 'DRAFT_READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ContentMediaStatus" AS ENUM ('STAGED', 'READY');

-- AlterTable
ALTER TABLE "StudyLessonEdition" ADD COLUMN     "publicationVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ContentImportRun" (
    "id" TEXT NOT NULL,
    "adapterName" TEXT NOT NULL,
    "adapterVersion" TEXT NOT NULL,
    "workKey" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "periodId" TEXT,
    "periodSourceKey" TEXT NOT NULL,
    "editionKey" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "sourceVersion" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" "ContentImportStatus" NOT NULL DEFAULT 'CREATED',
    "foundItems" INTEGER NOT NULL DEFAULT 0,
    "validatedItems" INTEGER NOT NULL DEFAULT 0,
    "processedItems" INTEGER NOT NULL DEFAULT 0,
    "diagnostics" JSONB NOT NULL DEFAULT '[]',
    "leaseHolder" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "fence" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdByKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ContentImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentImportItem" (
    "runId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "lessonEditionId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentImportItem_pkey" PRIMARY KEY ("runId","sourceKey")
);

-- CreateTable
CREATE TABLE "ContentMedia" (
    "id" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "volumeId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sourceMetadata" JSONB NOT NULL,
    "rightsMetadata" JSONB NOT NULL,
    "status" "ContentMediaStatus" NOT NULL DEFAULT 'STAGED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyRevisionMedia" (
    "revisionId" TEXT NOT NULL,
    "mediaKey" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "StudyRevisionMedia_pkey" PRIMARY KEY ("revisionId","mediaKey")
);

-- CreateTable
CREATE TABLE "ContentReference" (
    "id" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "occurrenceKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "originalTarget" JSONB NOT NULL,
    "normalizedTarget" JSONB NOT NULL,
    "externalUrl" TEXT,
    "diagnosis" TEXT NOT NULL DEFAULT 'UNRESOLVED',
    "evidenceKey" TEXT,

    CONSTRAINT "ContentReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyPublicationAction" (
    "id" TEXT NOT NULL,
    "lessonEditionId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "previousRevisionId" TEXT,
    "importRunId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorKey" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expectedVersion" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyPublicationAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentImportRun_status_leaseExpiresAt_idx" ON "ContentImportRun"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "ContentImportRun_collectionId_startedAt_idx" ON "ContentImportRun"("collectionId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentImportRun_scopeKey_sourceHash_key" ON "ContentImportRun"("scopeKey", "sourceHash");

-- CreateIndex
CREATE INDEX "ContentImportItem_revisionId_lessonEditionId_idx" ON "ContentImportItem"("revisionId", "lessonEditionId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentImportItem_runId_lessonEditionId_revisionId_key" ON "ContentImportItem"("runId", "lessonEditionId", "revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentMedia_checksum_key" ON "ContentMedia"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "ContentMedia_storageKey_key" ON "ContentMedia"("storageKey");

-- CreateIndex
CREATE INDEX "StudyRevisionMedia_mediaId_idx" ON "StudyRevisionMedia"("mediaId");

-- CreateIndex
CREATE INDEX "ContentReference_diagnosis_idx" ON "ContentReference"("diagnosis");

-- CreateIndex
CREATE UNIQUE INDEX "ContentReference_revisionId_occurrenceKey_key" ON "ContentReference"("revisionId", "occurrenceKey");

-- CreateIndex
CREATE INDEX "StudyPublicationAction_revisionId_lessonEditionId_idx" ON "StudyPublicationAction"("revisionId", "lessonEditionId");

-- CreateIndex
CREATE INDEX "StudyPublicationAction_previousRevisionId_lessonEditionId_idx" ON "StudyPublicationAction"("previousRevisionId", "lessonEditionId");

-- CreateIndex
CREATE INDEX "StudyPublicationAction_importRunId_lessonEditionId_revision_idx" ON "StudyPublicationAction"("importRunId", "lessonEditionId", "revisionId");

-- CreateIndex
CREATE UNIQUE INDEX "StudyPublicationAction_lessonEditionId_actionId_key" ON "StudyPublicationAction"("lessonEditionId", "actionId");

-- CreateIndex
CREATE UNIQUE INDEX "StudyPublicationAction_lessonEditionId_version_key" ON "StudyPublicationAction"("lessonEditionId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ContentCollection_id_work_editionKey_language_key" ON "ContentCollection"("id", "work", "editionKey", "language");

-- CreateIndex
CREATE INDEX "StudyRevision_lessonEditionId_contentHash_idx" ON "StudyRevision"("lessonEditionId", "contentHash");

-- AddForeignKey
ALTER TABLE "ContentImportRun" ADD CONSTRAINT "ContentImportRun_workKey_fkey" FOREIGN KEY ("workKey") REFERENCES "ContentWork"("key") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ContentImportRun" ADD CONSTRAINT "ContentImportRun_collectionId_workKey_editionKey_language_fkey" FOREIGN KEY ("collectionId", "workKey", "editionKey", "language") REFERENCES "ContentCollection"("id", "work", "editionKey", "language") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ContentImportRun" ADD CONSTRAINT "ContentImportRun_periodId_workKey_fkey" FOREIGN KEY ("periodId", "workKey") REFERENCES "StudyPeriod"("id", "workKey") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ContentImportRun" ADD CONSTRAINT "ContentImportRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ContentImportItem" ADD CONSTRAINT "ContentImportItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ContentImportRun"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ContentImportItem" ADD CONSTRAINT "ContentImportItem_lessonEditionId_fkey" FOREIGN KEY ("lessonEditionId") REFERENCES "StudyLessonEdition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ContentImportItem" ADD CONSTRAINT "ContentImportItem_revisionId_lessonEditionId_fkey" FOREIGN KEY ("revisionId", "lessonEditionId") REFERENCES "StudyRevision"("id", "lessonEditionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyRevisionMedia" ADD CONSTRAINT "StudyRevisionMedia_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "StudyRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyRevisionMedia" ADD CONSTRAINT "StudyRevisionMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "ContentMedia"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "ContentReference" ADD CONSTRAINT "ContentReference_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "StudyRevision"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyPublicationAction" ADD CONSTRAINT "StudyPublicationAction_lessonEditionId_fkey" FOREIGN KEY ("lessonEditionId") REFERENCES "StudyLessonEdition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyPublicationAction" ADD CONSTRAINT "StudyPublicationAction_revisionId_lessonEditionId_fkey" FOREIGN KEY ("revisionId", "lessonEditionId") REFERENCES "StudyRevision"("id", "lessonEditionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyPublicationAction" ADD CONSTRAINT "StudyPublicationAction_previousRevisionId_lessonEditionId_fkey" FOREIGN KEY ("previousRevisionId", "lessonEditionId") REFERENCES "StudyRevision"("id", "lessonEditionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyPublicationAction" ADD CONSTRAINT "StudyPublicationAction_importRunId_lessonEditionId_revisio_fkey" FOREIGN KEY ("importRunId", "lessonEditionId", "revisionId") REFERENCES "ContentImportItem"("runId", "lessonEditionId", "revisionId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "StudyPublicationAction" ADD CONSTRAINT "StudyPublicationAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE "StudyLessonEdition" ADD CONSTRAINT "StudyLessonEdition_publicationVersion_check" CHECK ("publicationVersion" >= 0);
ALTER TABLE "ContentImportRun" ADD CONSTRAINT "ContentImportRun_state_check" CHECK (
 "sourceHash" ~ '^[0-9a-f]{64}$' AND "scopeKey" ~ '^[0-9a-f]{64}$' AND fence >= 0 AND
 "foundItems" >= "validatedItems" AND "validatedItems" >= "processedItems" AND "processedItems" >= 0 AND
 jsonb_typeof(snapshot)='object' AND jsonb_typeof(diagnostics)='array' AND jsonb_array_length(diagnostics)<=20 AND
 (status<>'RUNNING' OR ("leaseHolder" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL)) AND
 (status<>'DRAFT_READY' OR ("foundItems">0 AND "processedItems"="foundItems")));
CREATE UNIQUE INDEX "ContentImportRun_one_active_scope" ON "ContentImportRun"("scopeKey") WHERE status IN ('CREATED','RUNNING');
ALTER TABLE "ContentMedia" ADD CONSTRAINT "ContentMedia_validation_check" CHECK (
 checksum ~ '^[0-9a-f]{64}$' AND "storageKey" ~ '^[0-9a-f]{64}\.(png|jpg|webp)$' AND
 "mimeType" IN ('image/png','image/jpeg','image/webp') AND "byteSize" BETWEEN 1 AND 10485760 AND
 width BETWEEN 1 AND 8192 AND height BETWEEN 1 AND 8192 AND width::bigint*height<=16000000 AND
 jsonb_typeof("sourceMetadata")='object' AND jsonb_typeof("rightsMetadata")='object');
ALTER TABLE "ContentReference" ADD CONSTRAINT "ContentReference_diagnosis_check" CHECK (
 diagnosis IN ('UNRESOLVED','EXTERNAL_VERIFIED','INTERNAL_VERIFIED') AND
 (diagnosis='UNRESOLVED' OR "evidenceKey" IS NOT NULL) AND
 (diagnosis<>'EXTERNAL_VERIFIED' OR "externalUrl" IS NOT NULL));
ALTER TABLE "StudyPublicationAction" ADD CONSTRAINT "StudyPublicationAction_version_check" CHECK (
 kind IN ('PUBLISH','ROLLBACK') AND "expectedVersion">=0 AND version="expectedVersion"+1 AND "requestHash" ~ '^[0-9a-f]{64}$');
EXECUTE $function$
CREATE FUNCTION "protectStudyImportSnapshot"() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'STUDY_IMPORT_RETAINED' USING ERRCODE='55000'; END IF;
 IF (to_jsonb(NEW)-ARRAY['status','validatedItems','processedItems','diagnostics','leaseHolder','leaseExpiresAt','fence','periodId','finishedAt','createdById']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','validatedItems','processedItems','diagnostics','leaseHolder','leaseExpiresAt','fence','periodId','finishedAt','createdById']) THEN
  RAISE EXCEPTION 'STUDY_IMPORT_SNAPSHOT_IMMUTABLE' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $body$;
$function$;
CREATE TRIGGER "ContentImportRun_snapshot" BEFORE UPDATE OR DELETE ON "ContentImportRun" FOR EACH ROW EXECUTE FUNCTION "protectStudyImportSnapshot"();
EXECUTE $function$
CREATE FUNCTION "protectStudyMedia"() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'STUDY_MEDIA_RETAINED' USING ERRCODE='55000'; END IF;
 IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR NOT (OLD.status='STAGED' AND NEW.status='READY') THEN
  RAISE EXCEPTION 'STUDY_MEDIA_IMMUTABLE' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $body$;
$function$;
CREATE TRIGGER "ContentMedia_immutable" BEFORE UPDATE OR DELETE ON "ContentMedia" FOR EACH ROW EXECUTE FUNCTION "protectStudyMedia"();
EXECUTE $function$
CREATE FUNCTION "protectStudyAudit"() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
 IF TG_TABLE_NAME='StudyPublicationAction' AND TG_OP='UPDATE' THEN
  IF NEW."actorId" IS NULL AND (to_jsonb(NEW)-'actorId')=(to_jsonb(OLD)-'actorId') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'STUDY_AUDIT_IMMUTABLE' USING ERRCODE='55000';
END $body$;
$function$;
CREATE TRIGGER "StudyPublicationAction_immutable" BEFORE UPDATE OR DELETE ON "StudyPublicationAction" FOR EACH ROW EXECUTE FUNCTION "protectStudyAudit"();
CREATE TRIGGER "ContentImportItem_immutable" BEFORE UPDATE OR DELETE ON "ContentImportItem" FOR EACH ROW EXECUTE FUNCTION "protectStudyAudit"();
CREATE TRIGGER "StudyRevisionMedia_immutable" BEFORE UPDATE OR DELETE ON "StudyRevisionMedia" FOR EACH ROW EXECUTE FUNCTION "protectStudyAudit"();

EXECUTE $function$
CREATE FUNCTION "protectStudyReference"() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['diagnosis','evidenceKey']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['diagnosis','evidenceKey']) THEN
  RAISE EXCEPTION 'STUDY_REFERENCE_IMMUTABLE' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $body$;
$function$;
CREATE TRIGGER "ContentReference_identity" BEFORE UPDATE OR DELETE ON "ContentReference" FOR EACH ROW EXECUTE FUNCTION "protectStudyReference"();
END $migration$;
