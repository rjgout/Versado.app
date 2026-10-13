-- Additief, één atomisch statement; geen bestaande records of voortgang wijzigen.
DO $$
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  PERFORM set_config('statement_timeout', '60s', true);
  IF to_regclass('"MysteryAttempt"') IS NOT NULL THEN
    RAISE EXCEPTION 'MYSTERY_ATTEMPT_REVIEW_REQUIRED';
  END IF;
  CREATE TYPE "MysteryAttemptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');
  CREATE TABLE "MysteryAttempt" (
    "id" TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "mysteryId" TEXT NOT NULL,
    "difficulty" "MysteryDifficulty" NOT NULL,
    "contentCollectionId" TEXT NOT NULL REFERENCES "ContentCollection"("id") ON DELETE RESTRICT ON UPDATE RESTRICT,
    "definitionVersion" TEXT NOT NULL,
    "placements" JSONB NOT NULL,
    "clueNotes" JSONB NOT NULL,
    "hintUses" JSONB NOT NULL DEFAULT '[]',
    "status" "MysteryAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
    "startActionId" TEXT NOT NULL,
    "lastActionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
  );
  CREATE UNIQUE INDEX "MysteryAttempt_userId_startActionId_key" ON "MysteryAttempt"("userId", "startActionId");
  CREATE UNIQUE INDEX "MysteryAttempt_one_active_variant" ON "MysteryAttempt"("userId", "mysteryId", "difficulty") WHERE "active";
  CREATE INDEX "MysteryAttempt_userId_mysteryId_difficulty_active_idx" ON "MysteryAttempt"("userId", "mysteryId", "difficulty", "active");
  CREATE INDEX "MysteryAttempt_contentCollectionId_idx" ON "MysteryAttempt"("contentCollectionId");
END $$;
