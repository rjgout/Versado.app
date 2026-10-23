-- CreateTable
CREATE TABLE "AudioPackage" (
    "id" TEXT NOT NULL,
    "manifestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "leaseToken" TEXT NOT NULL,
    "leaseUntil" TIMESTAMP(3) NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AudioPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioRecording" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "work" TEXT NOT NULL,
    "editionKey" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "chapterId" TEXT,
    "studyRevisionId" TEXT,
    "sourceHash" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceMetadata" JSONB NOT NULL,
    "voice" JSONB NOT NULL,
    "quality" JSONB NOT NULL,
    "segments" JSONB NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'audio/mpeg',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudioPublication" (
    "targetKey" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedBy" TEXT NOT NULL,

    CONSTRAINT "AudioPublication_pkey" PRIMARY KEY ("targetKey")
);

-- CreateIndex
CREATE INDEX "AudioPackage_status_leaseUntil_idx" ON "AudioPackage"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "AudioRecording_packageId_key" ON "AudioRecording"("packageId");

-- CreateIndex
CREATE INDEX "AudioRecording_collectionId_chapterId_idx" ON "AudioRecording"("collectionId", "chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "AudioRecording_id_targetKey_key" ON "AudioRecording"("id", "targetKey");

-- CreateIndex
CREATE UNIQUE INDEX "AudioPublication_recordingId_key" ON "AudioPublication"("recordingId");

-- CreateIndex
CREATE UNIQUE INDEX "AudioPublication_recordingId_targetKey_key" ON "AudioPublication"("recordingId", "targetKey");

-- AddForeignKey
ALTER TABLE "AudioRecording" ADD CONSTRAINT "AudioRecording_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "AudioPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioRecording" ADD CONSTRAINT "AudioRecording_collectionId_work_editionKey_language_fkey" FOREIGN KEY ("collectionId", "work", "editionKey", "language") REFERENCES "ContentCollection"("id", "work", "editionKey", "language") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AudioRecording" ADD CONSTRAINT "AudioRecording_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioRecording" ADD CONSTRAINT "AudioRecording_studyRevisionId_fkey" FOREIGN KEY ("studyRevisionId") REFERENCES "StudyRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AudioPublication" ADD CONSTRAINT "AudioPublication_recordingId_targetKey_fkey" FOREIGN KEY ("recordingId", "targetKey") REFERENCES "AudioRecording"("id", "targetKey") ON DELETE CASCADE ON UPDATE RESTRICT;

-- Exact één bestaand contentanker; studie-activatie blijft in fase 1/2 geblokkeerd.
ALTER TABLE "AudioRecording" ADD CONSTRAINT "AudioRecording_target_check" CHECK (
  ("chapterId" IS NOT NULL AND "studyRevisionId" IS NULL AND "targetKey" = 'chapter:' || "chapterId") OR
  ("chapterId" IS NULL AND "studyRevisionId" IS NOT NULL AND "targetKey" = 'revision:' || "studyRevisionId")
);
ALTER TABLE "AudioRecording" ADD CONSTRAINT "AudioRecording_media_check" CHECK (
  "sha256" ~ '^[a-f0-9]{64}$' AND "sourceHash" ~ '^[a-f0-9]{64}$' AND
  "byteSize" > 0 AND "byteSize" <= 268435456 AND "duration" > 0 AND "duration" <= 14400 AND
  "sourceKind" IN ('OFFICIAL', 'GENERATED') AND "mimeType" = 'audio/mpeg'
);
ALTER TABLE "AudioPackage" ADD CONSTRAINT "AudioPackage_status_check" CHECK ("status" IN ('PROCESSING', 'READY', 'FAILED'));
