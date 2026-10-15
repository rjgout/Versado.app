-- Alleen additief, geen backfill. Eén atomische DDL-eenheid.
DO $migration$
BEGIN
  PERFORM set_config('lock_timeout','5s',true);
  PERFORM set_config('statement_timeout','60s',true);
  IF to_regclass('"ReadingPosition"') IS NOT NULL
     OR to_regclass('"ReadingPosition_lessonEditionId_idx"') IS NOT NULL
     OR to_regclass('"ReadingPosition_revisionId_lessonEditionId_idx"') IS NOT NULL
     OR to_regprocedure('validate_reading_position_anchor()') IS NOT NULL THEN
    RAISE EXCEPTION 'READING_POSITION_REVIEW_REQUIRED';
  END IF;
  CREATE TABLE "ReadingPosition" (
    "userId" TEXT NOT NULL,
    "lessonEditionId" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "sectionAnchor" VARCHAR(128) NOT NULL,
    "blockAnchor" VARCHAR(128) NOT NULL,
    "sectionFraction" DOUBLE PRECISION NOT NULL,
    "quoteContext" VARCHAR(240),
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastActionId" UUID NOT NULL,
    "lastActionHash" CHAR(64) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReadingPosition_pkey" PRIMARY KEY ("userId","lessonEditionId"),
    CONSTRAINT "ReadingPosition_fraction_check" CHECK ("sectionFraction">=0 AND "sectionFraction"<=1),
    CONSTRAINT "ReadingPosition_version_check" CHECK ("version">=1),
    CONSTRAINT "ReadingPosition_anchor_check" CHECK (
      "sectionAnchor" ~ '^[A-Za-z][A-Za-z0-9._:-]*$' AND "blockAnchor" ~ '^[A-Za-z][A-Za-z0-9._:-]*$'),
    CONSTRAINT "ReadingPosition_hash_check" CHECK ("lastActionHash" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "ReadingPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE RESTRICT,
    CONSTRAINT "ReadingPosition_lessonEditionId_fkey" FOREIGN KEY ("lessonEditionId") REFERENCES "StudyLessonEdition"(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT "ReadingPosition_revisionId_lessonEditionId_fkey" FOREIGN KEY ("revisionId","lessonEditionId") REFERENCES "StudyRevision"(id,"lessonEditionId") ON DELETE RESTRICT ON UPDATE RESTRICT
  );
  CREATE INDEX "ReadingPosition_lessonEditionId_idx" ON "ReadingPosition"("lessonEditionId");
  CREATE INDEX "ReadingPosition_revisionId_lessonEditionId_idx" ON "ReadingPosition"("revisionId","lessonEditionId");
  EXECUTE $function$
    CREATE FUNCTION validate_reading_position_anchor() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM "StudyRevision" r,
          LATERAL jsonb_array_elements(r.body->'sections') s,
          LATERAL jsonb_array_elements(s->'blocks') b
        WHERE r.id=NEW."revisionId" AND r."lessonEditionId"=NEW."lessonEditionId"
          AND s->>'id'=NEW."sectionAnchor" AND b->>'id'=NEW."blockAnchor"
      ) THEN RAISE EXCEPTION 'READING_POSITION_INVALID_ANCHOR'; END IF;
      RETURN NEW;
    END $body$
  $function$;
  CREATE TRIGGER "ReadingPosition_anchor_guard" BEFORE INSERT OR UPDATE ON "ReadingPosition"
    FOR EACH ROW EXECUTE FUNCTION validate_reading_position_anchor();
END $migration$;
