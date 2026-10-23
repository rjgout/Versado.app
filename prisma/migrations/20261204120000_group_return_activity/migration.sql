ALTER TABLE "StreakActivity" ADD COLUMN "dayKey" TEXT;
CREATE INDEX "StreakActivity_userId_dayKey_idx" ON "StreakActivity"("userId", "dayKey");
