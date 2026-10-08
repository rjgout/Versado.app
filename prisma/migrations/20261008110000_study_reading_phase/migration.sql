-- Een gekozen Samen-studeren-stap begint voortaan met een persistente
-- leesfase. Bestaande ronden waren altijd al vraagronden; de backfill houdt
-- hun gedrag daarom exact gelijk.

CREATE TYPE "StudyRoundPhase" AS ENUM ('READING', 'QUESTIONS');

ALTER TABLE "StudyRound"
  ADD COLUMN "phase" "StudyRoundPhase" NOT NULL DEFAULT 'READING',
  ALTER COLUMN "startedAt" DROP NOT NULL;

UPDATE "StudyRound"
SET "phase" = 'QUESTIONS'
WHERE "startedAt" IS NOT NULL;
