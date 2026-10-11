-- Eén statement/transactie: een fout laat geen gedeeltelijke backfill achter.
-- De productie-inventaris van 2026-10-11 heeft 21 collecties/zeven bekende werken.
-- Nieuwe/onbekende mapping vereist beoordeling; nooit op naam classificeren.
DO $migration$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  LOCK TABLE "ContentCollection" IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (SELECT 1 FROM "ContentCollection" WHERE work IS NULL OR btrim(work) = '' OR btrim("editionKey") = '' OR btrim(language) = '') THEN
    RAISE EXCEPTION 'CONTENT_WORK_REVIEW_REQUIRED: ontbrekende werk-/editie-/taalidentiteit';
  END IF;
  IF EXISTS (SELECT 1 FROM "ContentCollection" GROUP BY work, "editionKey", language HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'CONTENT_WORK_REVIEW_REQUIRED: dubbele editie-identiteit';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContentWorkKind' AND typnamespace = current_schema()::regnamespace) THEN
    CREATE TYPE "ContentWorkKind" AS ENUM ('SCRIPTURE', 'STUDY_PROGRAM', 'OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ContentPublicationState' AND typnamespace = current_schema()::regnamespace) THEN
    CREATE TYPE "ContentPublicationState" AS ENUM ('LEGACY', 'DRAFT', 'PUBLISHED');
  END IF;
  CREATE TABLE IF NOT EXISTS "ContentWork" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "kind" "ContentWorkKind" NOT NULL
  );

  -- Behoud de oorspronkelijke string als FK; geen zelfstandig workId.
  -- Heruitvoering mag een later expliciet geregistreerde OTHER-bron behouden.
  IF EXISTS (SELECT 1 FROM "ContentCollection" c LEFT JOIN "ContentWork" w ON w.key=c.work
    WHERE c.work NOT IN ('bofm','old-testament','new-testament','dc-testament','pgp','fsy','podcasts') AND w.key IS NULL) THEN
    RAISE EXCEPTION 'CONTENT_WORK_REVIEW_REQUIRED: onbekend werk zonder expliciete registratie';
  END IF;
  IF EXISTS (SELECT 1 FROM "ContentWork" w JOIN (VALUES
    ('bofm','SCRIPTURE'),('old-testament','SCRIPTURE'),('new-testament','SCRIPTURE'),
    ('dc-testament','SCRIPTURE'),('pgp','SCRIPTURE'),('fsy','STUDY_PROGRAM'),('podcasts','OTHER')
  ) expected(key,kind) ON expected.key=w.key WHERE w.kind::text <> expected.kind) THEN
    RAISE EXCEPTION 'CONTENT_WORK_REVIEW_REQUIRED: conflicterende bronsoort';
  END IF;
  INSERT INTO "ContentWork" (key,kind)
    VALUES ('bofm','SCRIPTURE'),('old-testament','SCRIPTURE'),('new-testament','SCRIPTURE'),
      ('dc-testament','SCRIPTURE'),('pgp','SCRIPTURE'),('fsy','STUDY_PROGRAM'),('podcasts','OTHER')
    ON CONFLICT (key) DO NOTHING;

  -- LEGACY geldt alleen bij de eerste toevoeging van de kolom. Een retry
  -- publiceert dus geen later aangemaakte DRAFT-collecties.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='ContentCollection' AND column_name='publicationState') THEN
    ALTER TABLE "ContentCollection" ADD COLUMN "publicationState" "ContentPublicationState" NOT NULL DEFAULT 'LEGACY';
  END IF;
  ALTER TABLE "ContentCollection" ALTER COLUMN "publicationState" SET DEFAULT 'DRAFT';
  ALTER TABLE "ContentCollection" ALTER COLUMN "visibleToUsers" SET DEFAULT false;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"ContentCollection"'::regclass AND conname='ContentCollection_work_fkey') THEN
    ALTER TABLE "ContentCollection" ADD CONSTRAINT "ContentCollection_work_fkey"
      FOREIGN KEY (work) REFERENCES "ContentWork"(key) ON DELETE RESTRICT ON UPDATE RESTRICT;
  END IF;
END
$migration$;
