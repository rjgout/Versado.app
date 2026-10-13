-- Spelregelversie van de wedstrijduitslag en het moment van de vraagbeantwoording.
-- Bestaande wedstrijden blijven onder de oude regels (resultRules = 1); alleen nieuwe
-- wedstrijden krijgen versie 2. Niets wordt herberekend en geen uitslag verandert.
ALTER TABLE "PuzzleMatch" ADD COLUMN "resultRules" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PuzzleMatchParticipant" ADD COLUMN "answeredAt" TIMESTAMP(3);

-- Backfill: wie onder de oude regels al antwoordde (answeredCorrect gezet), had dat moment als finishedAt.
UPDATE "PuzzleMatchParticipant" SET "answeredAt" = "finishedAt" WHERE "answeredCorrect" IS NOT NULL AND "finishedAt" IS NOT NULL;
