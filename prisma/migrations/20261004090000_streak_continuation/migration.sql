ALTER TYPE "StreakDayStatus" ADD VALUE 'RETURNED';
ALTER TABLE "User"
  ADD COLUMN "streakGraceDay" TEXT,
  ADD COLUMN "streakInterruptedDay" TEXT,
  ADD COLUMN "streakReturnDay" TEXT,
  ADD COLUMN "streakReturnTimeZone" TEXT,
  ADD COLUMN "streakReturnCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "streakReturnRequired" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "streakReturnSeenAt" TIMESTAMP(3),
  ADD COLUMN "streakReminderDay" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "notifyStreakReturn" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "StreakActivity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "key" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "StreakActivity_userId_key_key" ON "StreakActivity"("userId", "key");

-- Geen geschiedenis reconstrueren en geen reeksen, XP of freezes veranderen.
-- Lopende reeksen krijgen tot en met de uitroldag rust; alleen latere gemiste
-- dagen vallen onder de nieuwe regels. Dit maakt geen fictieve StreakDay aan.
UPDATE "User"
SET "streakGraceDay" = to_char(CURRENT_TIMESTAMP AT TIME ZONE COALESCE("timeZone", 'Europe/Amsterdam'), 'YYYY-MM-DD')
WHERE "currentStreak" > 0;
-- Bestaande gebruikers krijgen geen nieuwe categorie automatisch aangezet.
UPDATE "User" SET "notifyStreakReturn" = false;
