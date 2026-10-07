-- Samen spelen met Vliegende {gids}: gezamenlijke runs en de laatste-twee-resultaten.
-- Solo-runs en bestaande gegevens veranderen niet: matchId is leeg voor alles wat er al is.

-- AlterEnum
ALTER TYPE "LiveGameMode" ADD VALUE 'QUICK_MISSIONARY';

-- CreateEnum
CREATE TYPE "QuickMissionaryMatchStatus" AS ENUM ('RUNNING', 'ENDED');

-- AlterTable
ALTER TABLE "QuickMissionaryRun" ADD COLUMN "matchId" TEXT,
ADD COLUMN "eliminatedSeq" INTEGER,
ADD COLUMN "eliminatedHow" TEXT,
ADD COLUMN "lastSeenAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "QuickMissionaryMatch" (
    "id" TEXT NOT NULL,
    "liveGameId" TEXT NOT NULL,
    "seed" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "status" "QuickMissionaryMatchStatus" NOT NULL DEFAULT 'RUNNING',
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "eliminationCount" INTEGER NOT NULL DEFAULT 0,
    "participantCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuickMissionaryMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickMissionaryDuoResult" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "scoreA" INTEGER NOT NULL,
    "scoreB" INTEGER NOT NULL,
    "participantCount" INTEGER NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "dayKey" TEXT NOT NULL,

    CONSTRAINT "QuickMissionaryDuoResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuickMissionaryMatch_liveGameId_key" ON "QuickMissionaryMatch"("liveGameId");
CREATE INDEX "QuickMissionaryMatch_status_idx" ON "QuickMissionaryMatch"("status");
CREATE UNIQUE INDEX "QuickMissionaryDuoResult_matchId_key" ON "QuickMissionaryDuoResult"("matchId");
CREATE INDEX "QuickMissionaryDuoResult_userAId_idx" ON "QuickMissionaryDuoResult"("userAId");
CREATE INDEX "QuickMissionaryDuoResult_userBId_idx" ON "QuickMissionaryDuoResult"("userBId");
CREATE INDEX "QuickMissionaryDuoResult_dayKey_idx" ON "QuickMissionaryDuoResult"("dayKey");
CREATE INDEX "QuickMissionaryRun_matchId_status_idx" ON "QuickMissionaryRun"("matchId", "status");

-- AddForeignKey
ALTER TABLE "QuickMissionaryRun" ADD CONSTRAINT "QuickMissionaryRun_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "QuickMissionaryMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickMissionaryMatch" ADD CONSTRAINT "QuickMissionaryMatch_liveGameId_fkey" FOREIGN KEY ("liveGameId") REFERENCES "LiveGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickMissionaryDuoResult" ADD CONSTRAINT "QuickMissionaryDuoResult_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "QuickMissionaryMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickMissionaryDuoResult" ADD CONSTRAINT "QuickMissionaryDuoResult_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QuickMissionaryDuoResult" ADD CONSTRAINT "QuickMissionaryDuoResult_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
