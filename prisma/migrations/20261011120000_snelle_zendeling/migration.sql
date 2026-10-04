-- Snelle Zendeling: serverstatus van arcade-runs en beheerschakelaar.
ALTER TABLE "GameSettings" ADD COLUMN "quickMissionaryEnabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "QuickMissionaryRunStatus" AS ENUM ('IN_PROGRESS', 'DEAD_AWAITING_REVIVE', 'REVIVE_READY', 'FINISHED');

CREATE TABLE "QuickMissionaryRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "dayKey" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" "QuickMissionaryRunStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "reviveUsed" BOOLEAN NOT NULL DEFAULT false,
    "reviveExerciseId" TEXT,
    "reviveOptionIds" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickMissionaryRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "QuickMissionaryRun_userId_status_idx" ON "QuickMissionaryRun"("userId", "status");
CREATE INDEX "QuickMissionaryRun_userId_score_idx" ON "QuickMissionaryRun"("userId", "score");
CREATE INDEX "QuickMissionaryRun_dayKey_status_score_idx" ON "QuickMissionaryRun"("dayKey", "status", "score");

ALTER TABLE "QuickMissionaryRun" ADD CONSTRAINT "QuickMissionaryRun_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- De nieuwe game is beschikbaar bij bestaande schriftuitgaven, maar blijft
-- voor gewone gebruikers uit tot de globale admin-toggle wordt aangezet.
INSERT INTO "GameContentScope" ("id", "gameKey", "contentCollectionId")
SELECT 'quick_missionary_' || "id", 'quick-missionary', "id"
FROM "ContentCollection"
WHERE "work" IN ('bofm', 'dc-testament', 'pgp')
ON CONFLICT ("gameKey", "contentCollectionId") DO NOTHING;
