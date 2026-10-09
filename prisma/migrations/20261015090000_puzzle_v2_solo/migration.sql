CREATE TYPE "PuzzleSessionMode" AS ENUM ('SOLO', 'COOP');
CREATE TYPE "PuzzleSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ANSWERED', 'ABANDONED');

CREATE TABLE "PuzzleDefinition" (
  "id" TEXT NOT NULL, "contentKey" TEXT NOT NULL, "imageUrl" TEXT NOT NULL,
  "storyNumber" INTEGER NOT NULL, "aspectRatio" DOUBLE PRECISION NOT NULL,
  "geometryVersion" INTEGER NOT NULL, "seed" TEXT NOT NULL, "definitionHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PuzzleDefinition_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PuzzleDefinition_contentKey_key" ON "PuzzleDefinition"("contentKey");

CREATE TABLE "PuzzleVariant" (
  "id" TEXT NOT NULL, "definitionId" TEXT NOT NULL, "pieceCount" INTEGER NOT NULL,
  "difficulty" TEXT NOT NULL, "rulesVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PuzzleVariant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PuzzleVariant_definitionId_pieceCount_difficulty_rulesVersion_key" ON "PuzzleVariant"("definitionId", "pieceCount", "difficulty", "rulesVersion");

CREATE TABLE "PuzzleSession" (
  "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "variantId" TEXT NOT NULL,
  "mode" "PuzzleSessionMode" NOT NULL DEFAULT 'SOLO', "status" "PuzzleSessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "snapshot" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "questionId" TEXT,
  "optionOrder" TEXT, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3), "answeredAt" TIMESTAMP(3), "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PuzzleSession_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PuzzleSession_ownerId_status_lastActivityAt_idx" ON "PuzzleSession"("ownerId", "status", "lastActivityAt");

CREATE TABLE "PuzzleAction" (
  "id" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "actionId" TEXT NOT NULL,
  "type" TEXT NOT NULL, "payload" TEXT NOT NULL, "version" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PuzzleAction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PuzzleAction_sessionId_actionId_key" ON "PuzzleAction"("sessionId", "actionId");
CREATE INDEX "PuzzleAction_sessionId_version_idx" ON "PuzzleAction"("sessionId", "version");

CREATE TABLE "PuzzlePersonalRecord" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "variantId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL, "elapsedMs" INTEGER NOT NULL, "hintsUsed" INTEGER NOT NULL,
  "extraHintsUsed" INTEGER NOT NULL, "completedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PuzzlePersonalRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PuzzlePersonalRecord_sessionId_key" ON "PuzzlePersonalRecord"("sessionId");
CREATE UNIQUE INDEX "PuzzlePersonalRecord_userId_variantId_key" ON "PuzzlePersonalRecord"("userId", "variantId");
CREATE INDEX "PuzzlePersonalRecord_variantId_elapsedMs_idx" ON "PuzzlePersonalRecord"("variantId", "elapsedMs");

ALTER TABLE "PuzzleVariant" ADD CONSTRAINT "PuzzleVariant_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "PuzzleDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleSession" ADD CONSTRAINT "PuzzleSession_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleSession" ADD CONSTRAINT "PuzzleSession_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PuzzleVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleAction" ADD CONSTRAINT "PuzzleAction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PuzzleSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzlePersonalRecord" ADD CONSTRAINT "PuzzlePersonalRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzlePersonalRecord" ADD CONSTRAINT "PuzzlePersonalRecord_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PuzzleVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
