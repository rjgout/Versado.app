-- Alleen nieuwe sessie-uitslagen worden gevuld; historische pogingen blijven intact.
ALTER TABLE "PuzzleSession" ADD COLUMN "answerResult" TEXT;
-- Een hervatte sessie kan ouder zijn dan de 24,8 dagen die een Int in ms
-- kan bevatten. Bewaar de exacte milliseconden zonder de antwoordflow te blokkeren.
ALTER TABLE "PuzzlePersonalRecord" ALTER COLUMN "elapsedMs" TYPE DOUBLE PRECISION USING "elapsedMs"::DOUBLE PRECISION;
