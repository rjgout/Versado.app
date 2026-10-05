-- Mysterie 001A: alleen historische voltooiing en tutorialstatus. Bestaande
-- gebruikers krijgen bewust geen rij en dus geen onverwachte voltooiing.
ALTER TABLE "GameSettings" ADD COLUMN "mystery001aEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "MysteryDifficulty" AS ENUM ('DISCOVERER', 'INVESTIGATOR', 'SCRIPTURE_SCHOLAR');

CREATE TABLE "MysteryProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mysteryId" TEXT NOT NULL,
    "difficulty" "MysteryDifficulty" NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "hintCount" INTEGER,
    "tutorialSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MysteryProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MysteryProgress_userId_mysteryId_difficulty_key"
  ON "MysteryProgress"("userId", "mysteryId", "difficulty");
CREATE INDEX "MysteryProgress_userId_completed_idx"
  ON "MysteryProgress"("userId", "completed");

ALTER TABLE "MysteryProgress" ADD CONSTRAINT "MysteryProgress_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Dit mysterie hoort alleen bij uitgaven van het Boek van Mormon. Alle nu
-- bestaande talen krijgen dezelfde handgemaakte puzzel; de readerlink wordt
-- later aan de actieve uitgave gekoppeld.
INSERT INTO "GameContentScope" ("id", "gameKey", "contentCollectionId")
SELECT 'mystery_001a_' || "id", 'mystery-001a', "id"
FROM "ContentCollection"
WHERE "work" = 'bofm'
ON CONFLICT ("gameKey", "contentCollectionId") DO NOTHING;
