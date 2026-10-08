-- Persoonlijke prestaties blijven standaard privé, ook voor bestaande
-- accounts. De selectie verwijst uitsluitend naar bestaande achievements;
-- voortgang of beloningen worden nooit gekopieerd of aangepast.
ALTER TABLE "User" ADD COLUMN "shareAchievements" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "FeaturedAchievement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "FeaturedAchievement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeaturedAchievement_userId_achievementId_key" ON "FeaturedAchievement"("userId", "achievementId");
CREATE UNIQUE INDEX "FeaturedAchievement_userId_position_key" ON "FeaturedAchievement"("userId", "position");
CREATE INDEX "FeaturedAchievement_achievementId_idx" ON "FeaturedAchievement"("achievementId");

ALTER TABLE "FeaturedAchievement" ADD CONSTRAINT "FeaturedAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FeaturedAchievement" ADD CONSTRAINT "FeaturedAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Expliciete veilige backfill: bestaande accounts krijgen nooit onverwacht
-- gedeelde prestaties zodra deze kolom wordt uitgerold.
UPDATE "User" SET "shareAchievements" = false WHERE "shareAchievements" IS NULL;
