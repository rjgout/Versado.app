-- Legpuzzel 2.0, fase 3: Samen en Tegen elkaar. Volledig additief: bestaande
-- Solo-sessies, hintvoorraden, reeksen en records blijven ongemoeid.

ALTER TYPE "PuzzleSessionMode" ADD VALUE IF NOT EXISTS 'MATCH';

CREATE TYPE "PuzzleInviteKind" AS ENUM ('COOP', 'MATCH');
CREATE TYPE "PuzzleInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');
CREATE TYPE "PuzzleMatchKind" AS ENUM ('LIVE', 'ASYNC');
CREATE TYPE "PuzzleMatchStatus" AS ENUM ('LOBBY', 'RUNNING', 'FINISHED', 'CANCELLED');
CREATE TYPE "PuzzleMatchParticipantStatus" AS ENUM ('INVITED', 'ACCEPTED', 'PLAYING', 'FINISHED', 'INVALID', 'DNF', 'DECLINED');

ALTER TABLE "PuzzleAction" ADD COLUMN "userId" TEXT;

CREATE TABLE "PuzzleMatch" (
  "id" TEXT NOT NULL,
  "organizerId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "kind" "PuzzleMatchKind" NOT NULL,
  "status" "PuzzleMatchStatus" NOT NULL DEFAULT 'LOBBY',
  "questionId" TEXT NOT NULL,
  "optionOrder" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startsAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "joinDeadline" TIMESTAMP(3) NOT NULL,
  "playDeadline" TIMESTAMP(3) NOT NULL,
  "winnerId" TEXT,
  CONSTRAINT "PuzzleMatch_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PuzzleSession" ADD COLUMN "matchId" TEXT;

CREATE TABLE "PuzzleSessionParticipant" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'MEMBER',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "includedHintsUsed" INTEGER NOT NULL DEFAULT 0,
  "activeHint" TEXT,
  "connectionsMade" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "PuzzleSessionParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PuzzleInvite" (
  "id" TEXT NOT NULL,
  "kind" "PuzzleInviteKind" NOT NULL,
  "sessionId" TEXT,
  "matchId" TEXT,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "status" "PuzzleInviteStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "PuzzleInvite_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PuzzleLock" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PuzzleLock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PuzzleMatchParticipant" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" "PuzzleMatchParticipantStatus" NOT NULL DEFAULT 'INVITED',
  "sessionId" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "elapsedMs" DOUBLE PRECISION,
  "hintsUsed" INTEGER NOT NULL DEFAULT 0,
  "extraHintsUsed" INTEGER NOT NULL DEFAULT 0,
  "answeredCorrect" BOOLEAN,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "rank" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PuzzleMatchParticipant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PuzzleMatch_status_playDeadline_idx" ON "PuzzleMatch"("status", "playDeadline");
CREATE INDEX "PuzzleMatch_organizerId_idx" ON "PuzzleMatch"("organizerId");
CREATE INDEX "PuzzleSession_matchId_idx" ON "PuzzleSession"("matchId");
CREATE UNIQUE INDEX "PuzzleSessionParticipant_sessionId_userId_key" ON "PuzzleSessionParticipant"("sessionId", "userId");
CREATE INDEX "PuzzleSessionParticipant_userId_idx" ON "PuzzleSessionParticipant"("userId");
CREATE UNIQUE INDEX "PuzzleInvite_sessionId_toUserId_key" ON "PuzzleInvite"("sessionId", "toUserId");
CREATE UNIQUE INDEX "PuzzleInvite_matchId_toUserId_key" ON "PuzzleInvite"("matchId", "toUserId");
CREATE INDEX "PuzzleInvite_toUserId_status_idx" ON "PuzzleInvite"("toUserId", "status");
CREATE INDEX "PuzzleInvite_fromUserId_status_idx" ON "PuzzleInvite"("fromUserId", "status");
CREATE UNIQUE INDEX "PuzzleLock_sessionId_groupId_key" ON "PuzzleLock"("sessionId", "groupId");
CREATE INDEX "PuzzleLock_sessionId_userId_idx" ON "PuzzleLock"("sessionId", "userId");
CREATE INDEX "PuzzleLock_expiresAt_idx" ON "PuzzleLock"("expiresAt");
CREATE UNIQUE INDEX "PuzzleMatchParticipant_sessionId_key" ON "PuzzleMatchParticipant"("sessionId");
CREATE UNIQUE INDEX "PuzzleMatchParticipant_matchId_userId_key" ON "PuzzleMatchParticipant"("matchId", "userId");
CREATE INDEX "PuzzleMatchParticipant_userId_status_idx" ON "PuzzleMatchParticipant"("userId", "status");

ALTER TABLE "PuzzleMatch" ADD CONSTRAINT "PuzzleMatch_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleMatch" ADD CONSTRAINT "PuzzleMatch_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "PuzzleVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleSession" ADD CONSTRAINT "PuzzleSession_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "PuzzleMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleSessionParticipant" ADD CONSTRAINT "PuzzleSessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PuzzleSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleSessionParticipant" ADD CONSTRAINT "PuzzleSessionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleInvite" ADD CONSTRAINT "PuzzleInvite_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PuzzleSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleInvite" ADD CONSTRAINT "PuzzleInvite_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "PuzzleMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleInvite" ADD CONSTRAINT "PuzzleInvite_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleInvite" ADD CONSTRAINT "PuzzleInvite_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleLock" ADD CONSTRAINT "PuzzleLock_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PuzzleSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleLock" ADD CONSTRAINT "PuzzleLock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleMatchParticipant" ADD CONSTRAINT "PuzzleMatchParticipant_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "PuzzleMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PuzzleMatchParticipant" ADD CONSTRAINT "PuzzleMatchParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: bestaande Solo-sessies hebben geen deelnemersrij nodig; Solo leest
-- ownerId. Geen bestaand gedrag, hintvoorraad of reeks wordt aangepast.
