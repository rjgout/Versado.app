-- Het spel krijgt een eigen stabiele identiteit; de bestaande puzzel blijft
-- mystery-001a als content-ID. Bestaande instellingen en scopes blijven behouden.
ALTER TABLE "GameSettings" RENAME COLUMN "mystery001aEnabled" TO "mysteryEnabled";

UPDATE "GameContentScope"
SET "gameKey" = 'mystery'
WHERE "gameKey" = 'mystery-001a';
