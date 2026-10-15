-- Legpuzzel 2.0 fase 4: persoonlijke beste tijden en privacy voor puzzelrecords. Uitsluitend additief.
-- Geen backfill hier: bestaande gebruikers houden sharePuzzleRecords = false (standaard uit) en de
-- historische records worden door een afzonderlijke, herhaalbare backfill (scripts/puzzle/backfill-best-records.ts)
-- overgenomen. PuzzlePersonalRecord blijft ongewijzigd bestaan.
ALTER TABLE "User" ADD COLUMN "sharePuzzleRecords" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "PuzzleRecordMode" AS ENUM ('SOLO', 'MATCH');
CREATE TYPE "PuzzleHintCategory" AS ENUM ('NO_HINTS', 'WITH_HINTS');

CREATE TABLE "PuzzleBestRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "mode" "PuzzleRecordMode" NOT NULL,
    "hintCategory" "PuzzleHintCategory" NOT NULL,
    "elapsedMs" DOUBLE PRECISION NOT NULL,
    "hintsUsed" INTEGER NOT NULL,
    "extraHintsUsed" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "sessionId" TEXT NOT NULL,
    "matchParticipantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PuzzleBestRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PuzzleBestRecord_userId_variantId_mode_hintCategory_key" ON "PuzzleBestRecord"("userId", "variantId", "mode", "hintCategory");
CREATE INDEX "PuzzleBestRecord_variantId_mode_hintCategory_elapsedMs_idx" ON "PuzzleBestRecord"("variantId", "mode", "hintCategory", "elapsedMs");
CREATE INDEX "PuzzleBestRecord_userId_mode_idx" ON "PuzzleBestRecord"("userId", "mode");

ALTER TABLE "PuzzleBestRecord" ADD CONSTRAINT "PuzzleBestRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleBestRecord" ADD CONSTRAINT "PuzzleBestRecord_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PuzzleVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
