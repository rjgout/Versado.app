-- M4: bestaande drie tabellen uitbreiden; geen kopie of wijziging van tekst/kleur/tijdstempels.

BEGIN;

ALTER TABLE "Bookmark"
  ALTER COLUMN "verseId" DROP NOT NULL,
  ADD COLUMN "lessonEditionId" TEXT,
  ADD COLUMN "revisionId" TEXT,
  ADD COLUMN "selector" JSONB,
  ADD COLUMN "targetKey" TEXT,
  ADD COLUMN "anchorStatus" TEXT NOT NULL DEFAULT 'EXACT',
  ADD COLUMN "mutationVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastActionId" UUID,
  ADD COLUMN "lastActionHash" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);
-- Raw SQL raakt Prisma's @updatedAt niet aan; historische Note.updatedAt blijft gelijk.
UPDATE "Bookmark" SET "targetKey" = 'verse:' || "verseId";
ALTER TABLE "Bookmark"
  DROP CONSTRAINT "Bookmark_verseId_fkey",
  ADD CONSTRAINT "Bookmark_verseId_fkey" FOREIGN KEY ("verseId") REFERENCES "Verse"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Bookmark_lessonEditionId_fkey" FOREIGN KEY ("lessonEditionId") REFERENCES "StudyLessonEdition"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Bookmark_revisionId_lessonEditionId_fkey" FOREIGN KEY ("revisionId", "lessonEditionId") REFERENCES "StudyRevision"(id, "lessonEditionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Bookmark_target_check" CHECK (
    ("verseId" IS NOT NULL AND "lessonEditionId" IS NULL AND "revisionId" IS NULL AND selector IS NULL AND ("targetKey" IS NULL OR "targetKey" = 'verse:' || "verseId"))
    OR
    ("verseId" IS NULL AND "lessonEditionId" IS NOT NULL AND "revisionId" IS NOT NULL AND selector IS NOT NULL AND "targetKey" IS NOT NULL
      AND "targetKey" ~ '^lesson:[0-9a-f]{64}$' AND jsonb_typeof(selector) = 'object'
      AND selector ?& ARRAY['originalRevisionId','normalizationVersion','ranges']
      AND jsonb_typeof(selector->'originalRevisionId') = 'string'
      AND jsonb_typeof(selector->'normalizationVersion') = 'number'
      AND selector->>'originalRevisionId' = "revisionId"
      AND selector->>'normalizationVersion' = '1'
      AND jsonb_typeof(selector->'ranges') = 'array'
      AND jsonb_array_length(selector->'ranges') BETWEEN 1 AND 32)
  ),
  ADD CONSTRAINT "Bookmark_mutation_check" CHECK (
    "mutationVersion" >= 0 AND "anchorStatus" IN ('EXACT','NEEDS_REVIEW','ORPHANED')
    AND (("lastActionId" IS NULL AND "lastActionHash" IS NULL) OR ("lastActionId" IS NOT NULL AND "lastActionHash" IS NOT NULL AND "lastActionHash" ~ '^[0-9a-f]{64}$'))
  );
CREATE UNIQUE INDEX "Bookmark_userId_targetKey_key" ON "Bookmark"("userId", "targetKey");
CREATE INDEX "Bookmark_revisionId_lessonEditionId_idx" ON "Bookmark"("revisionId", "lessonEditionId");
CREATE INDEX "Bookmark_userId_lessonEditionId_deletedAt_idx" ON "Bookmark"("userId", "lessonEditionId", "deletedAt");

ALTER TABLE "Highlight"
  ALTER COLUMN "verseId" DROP NOT NULL,
  ADD COLUMN "lessonEditionId" TEXT,
  ADD COLUMN "revisionId" TEXT,
  ADD COLUMN "selector" JSONB,
  ADD COLUMN "targetKey" TEXT,
  ADD COLUMN "anchorStatus" TEXT NOT NULL DEFAULT 'EXACT',
  ADD COLUMN "mutationVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastActionId" UUID,
  ADD COLUMN "lastActionHash" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);
-- Raw SQL raakt Prisma's @updatedAt niet aan; historische Note.updatedAt blijft gelijk.
UPDATE "Highlight" SET "targetKey" = 'verse:' || "verseId";
ALTER TABLE "Highlight"
  DROP CONSTRAINT "Highlight_verseId_fkey",
  ADD CONSTRAINT "Highlight_verseId_fkey" FOREIGN KEY ("verseId") REFERENCES "Verse"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Highlight_lessonEditionId_fkey" FOREIGN KEY ("lessonEditionId") REFERENCES "StudyLessonEdition"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Highlight_revisionId_lessonEditionId_fkey" FOREIGN KEY ("revisionId", "lessonEditionId") REFERENCES "StudyRevision"(id, "lessonEditionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Highlight_target_check" CHECK (
    ("verseId" IS NOT NULL AND "lessonEditionId" IS NULL AND "revisionId" IS NULL AND selector IS NULL AND ("targetKey" IS NULL OR "targetKey" = 'verse:' || "verseId"))
    OR
    ("verseId" IS NULL AND "lessonEditionId" IS NOT NULL AND "revisionId" IS NOT NULL AND selector IS NOT NULL AND "targetKey" IS NOT NULL
      AND "targetKey" ~ '^lesson:[0-9a-f]{64}$' AND jsonb_typeof(selector) = 'object'
      AND selector ?& ARRAY['originalRevisionId','normalizationVersion','ranges']
      AND jsonb_typeof(selector->'originalRevisionId') = 'string'
      AND jsonb_typeof(selector->'normalizationVersion') = 'number'
      AND selector->>'originalRevisionId' = "revisionId"
      AND selector->>'normalizationVersion' = '1'
      AND jsonb_typeof(selector->'ranges') = 'array'
      AND jsonb_array_length(selector->'ranges') BETWEEN 1 AND 32)
  ),
  ADD CONSTRAINT "Highlight_mutation_check" CHECK (
    "mutationVersion" >= 0 AND "anchorStatus" IN ('EXACT','NEEDS_REVIEW','ORPHANED')
    AND (("lastActionId" IS NULL AND "lastActionHash" IS NULL) OR ("lastActionId" IS NOT NULL AND "lastActionHash" IS NOT NULL AND "lastActionHash" ~ '^[0-9a-f]{64}$'))
  );
CREATE UNIQUE INDEX "Highlight_userId_targetKey_key" ON "Highlight"("userId", "targetKey");
CREATE INDEX "Highlight_revisionId_lessonEditionId_idx" ON "Highlight"("revisionId", "lessonEditionId");
CREATE INDEX "Highlight_userId_lessonEditionId_deletedAt_idx" ON "Highlight"("userId", "lessonEditionId", "deletedAt");

ALTER TABLE "Note"
  ALTER COLUMN "verseId" DROP NOT NULL,
  ADD COLUMN "lessonEditionId" TEXT,
  ADD COLUMN "revisionId" TEXT,
  ADD COLUMN "selector" JSONB,
  ADD COLUMN "targetKey" TEXT,
  ADD COLUMN "anchorStatus" TEXT NOT NULL DEFAULT 'EXACT',
  ADD COLUMN "mutationVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastActionId" UUID,
  ADD COLUMN "lastActionHash" TEXT,
  ADD COLUMN "deletedAt" TIMESTAMP(3);
-- Raw SQL raakt Prisma's @updatedAt niet aan; historische Note.updatedAt blijft gelijk.
UPDATE "Note" SET "targetKey" = 'verse:' || "verseId";
ALTER TABLE "Note"
  DROP CONSTRAINT "Note_verseId_fkey",
  ADD CONSTRAINT "Note_verseId_fkey" FOREIGN KEY ("verseId") REFERENCES "Verse"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Note_lessonEditionId_fkey" FOREIGN KEY ("lessonEditionId") REFERENCES "StudyLessonEdition"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Note_revisionId_lessonEditionId_fkey" FOREIGN KEY ("revisionId", "lessonEditionId") REFERENCES "StudyRevision"(id, "lessonEditionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Note_target_check" CHECK (
    ("verseId" IS NOT NULL AND "lessonEditionId" IS NULL AND "revisionId" IS NULL AND selector IS NULL AND ("targetKey" IS NULL OR "targetKey" = 'verse:' || "verseId"))
    OR
    ("verseId" IS NULL AND "lessonEditionId" IS NOT NULL AND "revisionId" IS NOT NULL AND selector IS NOT NULL AND "targetKey" IS NOT NULL
      AND "targetKey" ~ '^lesson:[0-9a-f]{64}$' AND jsonb_typeof(selector) = 'object'
      AND selector ?& ARRAY['originalRevisionId','normalizationVersion','ranges']
      AND jsonb_typeof(selector->'originalRevisionId') = 'string'
      AND jsonb_typeof(selector->'normalizationVersion') = 'number'
      AND selector->>'originalRevisionId' = "revisionId"
      AND selector->>'normalizationVersion' = '1'
      AND jsonb_typeof(selector->'ranges') = 'array'
      AND jsonb_array_length(selector->'ranges') BETWEEN 1 AND 32)
  ),
  ADD CONSTRAINT "Note_mutation_check" CHECK (
    "mutationVersion" >= 0 AND "anchorStatus" IN ('EXACT','NEEDS_REVIEW','ORPHANED')
    AND (("lastActionId" IS NULL AND "lastActionHash" IS NULL) OR ("lastActionId" IS NOT NULL AND "lastActionHash" IS NOT NULL AND "lastActionHash" ~ '^[0-9a-f]{64}$'))
  );
CREATE UNIQUE INDEX "Note_userId_targetKey_key" ON "Note"("userId", "targetKey");
CREATE INDEX "Note_revisionId_lessonEditionId_idx" ON "Note"("revisionId", "lessonEditionId");
CREATE INDEX "Note_userId_lessonEditionId_deletedAt_idx" ON "Note"("userId", "lessonEditionId", "deletedAt");

COMMIT;
