BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE "WordSearchGame" ADD COLUMN "sourceContext" JSONB;
ALTER TABLE "WordSearchGame" ADD CONSTRAINT "WordSearchGame_source_context_check" CHECK (
 "sourceContext" IS NULL OR coalesce((
  jsonb_typeof("sourceContext")='object' AND
  "sourceContext"->>'collectionId'="contentCollectionId" AND
  "sourceContext"->>'editionKey'='bofm' AND
  "sourceContext"->>'language' IN ('nl','en','de','fr','es') AND
  "sourceContext"->>'poolHash' ~ '^[a-f0-9]{64}$' AND
  "sourceContext"->>'sourceCollectionId'="contentCollectionId" AND
  "sourceContext"->>'poolLanguage'="sourceContext"->>'language' AND
  "sourceContext"->>'normalizationVersion'='1' AND
  "sourceContext"->>'rulesVersion'='1' AND
  "sourceContext" ?& ARRAY['collectionId','editionKey','language','poolHash','rulesVersion','sourceCollectionId','poolLanguage','normalizationVersion']
 ),false));
CREATE FUNCTION versado_word_search_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."sourceContext" IS DISTINCT FROM OLD."sourceContext" OR NEW."contentCollectionId" IS DISTINCT FROM OLD."contentCollectionId" THEN
  RAISE EXCEPTION 'WORD_SEARCH_SOURCE_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "WordSearchGame_source_guard" BEFORE UPDATE ON "WordSearchGame" FOR EACH ROW EXECUTE FUNCTION versado_word_search_source_guard();
-- Bronverwijdering mag geen historische spellen via de bestaande cascade wissen.
-- Accountverwijdering blijft ongewijzigd: de guard geldt alleen voor de broncollectie.
CREATE FUNCTION versado_word_search_collection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM "WordSearchGame" WHERE "contentCollectionId"=OLD.id) THEN
  RAISE EXCEPTION 'WORD_SEARCH_SOURCE_IN_USE';
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER "ContentCollection_word_search_guard" BEFORE DELETE ON "ContentCollection" FOR EACH ROW EXECUTE FUNCTION versado_word_search_collection_guard();
COMMIT;
