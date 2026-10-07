-- CreateEnum
CREATE TYPE "QuickMissionaryReviveOutcome" AS ENUM ('SHOWN', 'CORRECT', 'WRONG');

-- CreateTable
CREATE TABLE "QuickMissionaryReviveQuestion" (
    "id" TEXT NOT NULL,
    "contentKey" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "variant" INTEGER NOT NULL DEFAULT 1,
    "prompt" TEXT NOT NULL,
    "status" "ContentStatus" NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickMissionaryReviveQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickMissionaryReviveOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuickMissionaryReviveOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickMissionaryReviveProgress" (
    "userId" TEXT NOT NULL,
    "contentCollectionId" TEXT NOT NULL,
    "cursorBookOrder" INTEGER NOT NULL DEFAULT 0,
    "cursorChapterOrder" INTEGER NOT NULL DEFAULT 0,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickMissionaryReviveProgress_pkey" PRIMARY KEY ("userId","contentCollectionId")
);

-- CreateTable
CREATE TABLE "QuickMissionaryReviveSeen" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL,
    "runId" TEXT,
    "outcome" "QuickMissionaryReviveOutcome" NOT NULL DEFAULT 'SHOWN',
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "QuickMissionaryReviveSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuickMissionaryReviveQuestion_contentKey_key" ON "QuickMissionaryReviveQuestion"("contentKey");

-- CreateIndex
CREATE INDEX "QuickMissionaryReviveQuestion_chapterId_status_idx" ON "QuickMissionaryReviveQuestion"("chapterId", "status");

-- CreateIndex
CREATE INDEX "QuickMissionaryReviveOption_questionId_idx" ON "QuickMissionaryReviveOption"("questionId");

-- CreateIndex
CREATE INDEX "QuickMissionaryReviveSeen_userId_cycle_idx" ON "QuickMissionaryReviveSeen"("userId", "cycle");

-- CreateIndex
CREATE INDEX "QuickMissionaryReviveSeen_runId_idx" ON "QuickMissionaryReviveSeen"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "QuickMissionaryReviveSeen_userId_questionId_cycle_key" ON "QuickMissionaryReviveSeen"("userId", "questionId", "cycle");

-- AddForeignKey
ALTER TABLE "QuickMissionaryReviveQuestion" ADD CONSTRAINT "QuickMissionaryReviveQuestion_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickMissionaryReviveOption" ADD CONSTRAINT "QuickMissionaryReviveOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuickMissionaryReviveQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickMissionaryReviveProgress" ADD CONSTRAINT "QuickMissionaryReviveProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickMissionaryReviveProgress" ADD CONSTRAINT "QuickMissionaryReviveProgress_contentCollectionId_fkey" FOREIGN KEY ("contentCollectionId") REFERENCES "ContentCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickMissionaryReviveSeen" ADD CONSTRAINT "QuickMissionaryReviveSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuickMissionaryReviveSeen" ADD CONSTRAINT "QuickMissionaryReviveSeen_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "QuickMissionaryReviveQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (migratiebeleid: bestaand gedrag verandert niet).
-- Genees las tot nu toe goedgekeurde meerkeuzevragen uit Exercise; dat waren
-- in de praktijk de handgeschreven begrijpend-lezen-vragen. Die gaan met
-- dezelfde id's (vraag én antwoordopties) naar de eigen vragenbank, zodat een
-- run die tijdens de uitrol midden in Genees zit gewoon doorloopt: de run
-- verwijst met reviveExerciseId/reviveOptionIds naar deze id's. De Exercise-
-- rijen blijven ongemoeid en blijven in de lessen staan. Niemand krijgt
-- voortgang of geschiedenis: iedereen begint bij het eerste hoofdstuk.
INSERT INTO "QuickMissionaryReviveQuestion" ("id", "contentKey", "chapterId", "variant", "prompt", "status", "updatedAt")
SELECT e."id", 'legacy:' || e."id", e."chapterId", 1000 + e."order", e."prompt", 'APPROVED', CURRENT_TIMESTAMP
FROM "Exercise" e
WHERE e."type" = 'MULTIPLE_CHOICE'
  AND e."status" = 'APPROVED'
  AND (SELECT count(*) FROM "QuestionOption" o WHERE o."exerciseId" = e."id") >= 3
  AND (SELECT count(*) FROM "QuestionOption" o WHERE o."exerciseId" = e."id" AND o."isCorrect") = 1
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "QuickMissionaryReviveOption" ("id", "questionId", "label", "isCorrect", "order")
SELECT o."id", o."exerciseId", o."label", o."isCorrect", o."order"
FROM "QuestionOption" o
JOIN "QuickMissionaryReviveQuestion" q ON q."id" = o."exerciseId" AND q."contentKey" LIKE 'legacy:%'
ON CONFLICT ("id") DO NOTHING;
