ALTER TABLE "StreakDay" ADD COLUMN "celebrationShownAt" TIMESTAMP(3);

-- Bestaande dagen zijn al eerder verdiend; de nieuwe viering mag niet bij
-- bestaande gebruikers onverwacht historisch alsnog verschijnen.
UPDATE "StreakDay" SET "celebrationShownAt" = "createdAt" WHERE "celebrationShownAt" IS NULL;
