-- Uitsluitend CFM-afbeeldingen mogen naar een geldige actuele versie wisselen.
-- Geen datamutatie, nieuwe tabel, bronpublicatie of wijziging van revisie-/tekstaudits.
BEGIN;
CREATE OR REPLACE FUNCTION "protectStudyMedia"() RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'STUDY_MEDIA_RETAINED' USING ERRCODE='55000'; END IF;
 -- Bestaande algemene overgang blijft exact gelijk.
 IF (to_jsonb(NEW)-'status')=(to_jsonb(OLD)-'status') AND OLD.status='STAGED' AND NEW.status='READY' THEN RETURN NEW; END IF;
 -- Alleen additieve diagnose van reeds bestaande, onveranderlijke CFM-bronversies.
 IF OLD.status='READY' AND NEW.status='READY'
 AND (to_jsonb(NEW)-'sourceMetadata')=(to_jsonb(OLD)-'sourceMetadata')
 AND (NEW."sourceMetadata"-'cfmPreviousChecksums')=(OLD."sourceMetadata"-'cfmPreviousChecksums')
 AND OLD."sourceMetadata"->>'adapter' IN ('cfm-2026-nl-v1','cfm-2027-nl-v1')
 AND OLD."sourceMetadata"->>'sourceKey' ~ '^https://www[.]churchofjesuschrist[.]org/imgs/[A-Za-z0-9]{40}/'
 AND jsonb_typeof(NEW."sourceMetadata"->'cfmPreviousChecksums')='array' THEN
  IF jsonb_array_length(NEW."sourceMetadata"->'cfmPreviousChecksums')<=4096
  AND COALESCE(OLD."sourceMetadata"->'cfmPreviousChecksums','[]'::jsonb) <@ (NEW."sourceMetadata"->'cfmPreviousChecksums')
  AND NOT EXISTS (
   SELECT 1 FROM jsonb_array_elements_text(NEW."sourceMetadata"->'cfmPreviousChecksums') AS h(checksum)
   WHERE h.checksum !~ '^[a-f0-9]{64}$' OR NOT EXISTS (
    SELECT 1 FROM "ContentMedia" m WHERE m.checksum=h.checksum AND m.status='READY'
    AND m."sourceMetadata"->>'sourceKey'=OLD."sourceMetadata"->>'sourceKey'
    AND m."sourceMetadata"->>'adapter' IN ('cfm-2026-nl-v1','cfm-2027-nl-v1')
    AND m."rightsMetadata"=OLD."rightsMetadata"
   )
  ) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'STUDY_MEDIA_IMMUTABLE' USING ERRCODE='55000';
END $body$;

CREATE FUNCTION "protectCfmImageBinding"() RETURNS trigger LANGUAGE plpgsql AS $body$
DECLARE previous "ContentMedia"; replacement "ContentMedia"; work_key text;
BEGIN
 IF TG_OP='UPDATE' AND NEW."revisionId"=OLD."revisionId" AND NEW."mediaKey"=OLD."mediaKey" THEN
  SELECT e."workKey" INTO work_key FROM "StudyRevision" r JOIN "StudyLessonEdition" e ON e.id=r."lessonEditionId" WHERE r.id=OLD."revisionId";
  SELECT * INTO previous FROM "ContentMedia" WHERE id=OLD."mediaId";
  SELECT * INTO replacement FROM "ContentMedia" WHERE id=NEW."mediaId";
  IF work_key IN ('cfm-old-testament-2026','cfm-new-testament-2027')
  AND previous.status='READY' AND replacement.status='READY'
  AND previous."sourceMetadata"->>'adapter' IN ('cfm-2026-nl-v1','cfm-2027-nl-v1')
  AND replacement."sourceMetadata"->>'adapter' IN ('cfm-2026-nl-v1','cfm-2027-nl-v1')
  AND previous."sourceMetadata"->>'sourceKey'=replacement."sourceMetadata"->>'sourceKey'
  AND previous."sourceMetadata"->>'sourceKey' ~ '^https://www[.]churchofjesuschrist[.]org/imgs/[A-Za-z0-9]{40}/'
  AND previous."rightsMetadata"=replacement."rightsMetadata"
  AND replacement.width>=16 AND replacement.height>=16 AND replacement.width*replacement.height<=16000000
  AND previous."volumeId"=replacement."volumeId" THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'STUDY_AUDIT_IMMUTABLE' USING ERRCODE='55000';
END $body$;
DROP TRIGGER "StudyRevisionMedia_immutable" ON "StudyRevisionMedia";
CREATE TRIGGER "StudyRevisionMedia_immutable" BEFORE UPDATE OR DELETE ON "StudyRevisionMedia" FOR EACH ROW EXECUTE FUNCTION "protectCfmImageBinding"();
COMMIT;
