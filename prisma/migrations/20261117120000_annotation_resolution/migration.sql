-- Fase 4D: additieve resolutiemetadata. De oorspronkelijke revisionId/selector/targetKey blijven ongemoeid;
-- een door de gebruiker bevestigde nieuwe locatie staat apart. Geen backfill, geen kopie, geen wijziging van bestaande rijen
-- (Note.updatedAt blijft gelijk: alleen ADD COLUMN, geen UPDATE).

BEGIN;

ALTER TABLE "Bookmark"
  ADD COLUMN "resolvedRevisionId" TEXT,
  ADD COLUMN "resolvedSelector" JSONB,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD CONSTRAINT "Bookmark_resolvedRevisionId_lessonEditionId_fkey" FOREIGN KEY ("resolvedRevisionId", "lessonEditionId") REFERENCES "StudyRevision"(id, "lessonEditionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Bookmark_resolution_check" CHECK (
    ("resolvedRevisionId" IS NULL AND "resolvedSelector" IS NULL AND "resolvedAt" IS NULL)
    OR
    ("resolvedRevisionId" IS NOT NULL AND "resolvedSelector" IS NOT NULL AND "resolvedAt" IS NOT NULL
      AND "lessonEditionId" IS NOT NULL AND "verseId" IS NULL
      AND jsonb_typeof("resolvedSelector") = 'object'
      AND "resolvedSelector" ?& ARRAY['originalRevisionId','normalizationVersion','ranges']
      AND "resolvedSelector"->>'originalRevisionId' = "resolvedRevisionId"
      AND "resolvedSelector"->>'normalizationVersion' = '1'
      AND jsonb_typeof("resolvedSelector"->'ranges') = 'array'
      AND jsonb_array_length("resolvedSelector"->'ranges') BETWEEN 1 AND 32)
  );
CREATE INDEX "Bookmark_resolvedRevisionId_lessonEditionId_idx" ON "Bookmark"("resolvedRevisionId", "lessonEditionId");

ALTER TABLE "Highlight"
  ADD COLUMN "resolvedRevisionId" TEXT,
  ADD COLUMN "resolvedSelector" JSONB,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD CONSTRAINT "Highlight_resolvedRevisionId_lessonEditionId_fkey" FOREIGN KEY ("resolvedRevisionId", "lessonEditionId") REFERENCES "StudyRevision"(id, "lessonEditionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Highlight_resolution_check" CHECK (
    ("resolvedRevisionId" IS NULL AND "resolvedSelector" IS NULL AND "resolvedAt" IS NULL)
    OR
    ("resolvedRevisionId" IS NOT NULL AND "resolvedSelector" IS NOT NULL AND "resolvedAt" IS NOT NULL
      AND "lessonEditionId" IS NOT NULL AND "verseId" IS NULL
      AND jsonb_typeof("resolvedSelector") = 'object'
      AND "resolvedSelector" ?& ARRAY['originalRevisionId','normalizationVersion','ranges']
      AND "resolvedSelector"->>'originalRevisionId' = "resolvedRevisionId"
      AND "resolvedSelector"->>'normalizationVersion' = '1'
      AND jsonb_typeof("resolvedSelector"->'ranges') = 'array'
      AND jsonb_array_length("resolvedSelector"->'ranges') BETWEEN 1 AND 32)
  );
CREATE INDEX "Highlight_resolvedRevisionId_lessonEditionId_idx" ON "Highlight"("resolvedRevisionId", "lessonEditionId");

ALTER TABLE "Note"
  ADD COLUMN "resolvedRevisionId" TEXT,
  ADD COLUMN "resolvedSelector" JSONB,
  ADD COLUMN "resolvedAt" TIMESTAMP(3),
  ADD CONSTRAINT "Note_resolvedRevisionId_lessonEditionId_fkey" FOREIGN KEY ("resolvedRevisionId", "lessonEditionId") REFERENCES "StudyRevision"(id, "lessonEditionId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT "Note_resolution_check" CHECK (
    ("resolvedRevisionId" IS NULL AND "resolvedSelector" IS NULL AND "resolvedAt" IS NULL)
    OR
    ("resolvedRevisionId" IS NOT NULL AND "resolvedSelector" IS NOT NULL AND "resolvedAt" IS NOT NULL
      AND "lessonEditionId" IS NOT NULL AND "verseId" IS NULL
      AND jsonb_typeof("resolvedSelector") = 'object'
      AND "resolvedSelector" ?& ARRAY['originalRevisionId','normalizationVersion','ranges']
      AND "resolvedSelector"->>'originalRevisionId' = "resolvedRevisionId"
      AND "resolvedSelector"->>'normalizationVersion' = '1'
      AND jsonb_typeof("resolvedSelector"->'ranges') = 'array'
      AND jsonb_array_length("resolvedSelector"->'ranges') BETWEEN 1 AND 32)
  );
CREATE INDEX "Note_resolvedRevisionId_lessonEditionId_idx" ON "Note"("resolvedRevisionId", "lessonEditionId");

COMMIT;
