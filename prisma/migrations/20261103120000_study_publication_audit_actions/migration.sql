-- Uitbreiding van de bestaande immutable publicatieaudit; geen data-, pointer- of vlagwijzigingen.
-- Eén atomische ALTER: bestaande PUBLISH/ROLLBACK-rijen blijven geldig en behouden.
ALTER TABLE "StudyPublicationAction"
  DROP CONSTRAINT "StudyPublicationAction_version_check",
  ADD CONSTRAINT "StudyPublicationAction_version_check" CHECK (
    kind IN ('PUBLISH', 'ROLLBACK', 'PUBLISH_DISPLAY_ONLY', 'RELEASE_COLLECTION')
    AND "expectedVersion" >= 0
    AND version = "expectedVersion" + 1
    AND "requestHash" ~ '^[0-9a-f]{64}$'
  );
