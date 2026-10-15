BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='User' AND column_name='contentSelectionVersion')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname='protect_content_selection_version' AND pronamespace=current_schema()::regnamespace)
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='User_content_selection_version') THEN
    RAISE EXCEPTION 'CONTENT_SELECTION_VERSION_REVIEW_REQUIRED';
  END IF;
END $$;
ALTER TABLE "User" ADD COLUMN "contentSelectionVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_contentSelectionVersion_nonnegative" CHECK ("contentSelectionVersion" >= 0);
CREATE FUNCTION protect_content_selection_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."contentSelectionVersion" <> 0 THEN RAISE EXCEPTION 'CONTENT_SELECTION_VERSION_INVALID'; END IF;
  ELSE
    IF NEW."contentSelectionVersion" IS DISTINCT FROM OLD."contentSelectionVersion" THEN
      RAISE EXCEPTION 'CONTENT_SELECTION_VERSION_IMMUTABLE';
    END IF;
    IF ROW(NEW."activeContentCollectionId", NEW."contentLanguage") IS DISTINCT FROM ROW(OLD."activeContentCollectionId", OLD."contentLanguage") THEN
      IF OLD."contentSelectionVersion" = 2147483647 THEN RAISE EXCEPTION 'CONTENT_SELECTION_VERSION_EXHAUSTED'; END IF;
      NEW."contentSelectionVersion" := OLD."contentSelectionVersion" + 1;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "User_content_selection_version" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION protect_content_selection_version();
COMMIT;
