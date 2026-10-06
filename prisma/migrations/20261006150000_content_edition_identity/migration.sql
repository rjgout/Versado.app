-- Geef contentcollecties een generieke vertaling-/uitgavefamilie naast werk en taal.
-- Bestaande collecties krijgen per werk één familie, zodat bestaand gedrag gelijk blijft.

ALTER TABLE "ContentCollection"
  ADD COLUMN "editionKey" TEXT NOT NULL DEFAULT 'default',
  ADD COLUMN "sourceName" TEXT,
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "licenseName" TEXT,
  ADD COLUMN "licenseUrl" TEXT;

-- Voor werkgebonden collecties is het werk de veilige bestaande familie.
-- Collecties zonder werk krijgen een eigen stabiele familie en blijven daarmee
-- bewust los van andere niet-schriftelijke content.
UPDATE "ContentCollection"
SET "editionKey" = COALESCE("work", "id");

CREATE UNIQUE INDEX "ContentCollection_work_editionKey_language_key"
  ON "ContentCollection"("work", "editionKey", "language");
