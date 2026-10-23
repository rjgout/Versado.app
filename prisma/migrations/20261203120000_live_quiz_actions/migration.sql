BEGIN;

-- CreateEnum
CREATE TYPE "LiveQuizActionKind" AS ENUM ('ANSWER', 'HINT_USE');

-- AlterTable
ALTER TABLE "LiveGame" ADD COLUMN     "quizIndex" INTEGER;

-- CreateTable
CREATE TABLE "LiveQuizQuestion" (
    "gameId" TEXT NOT NULL,
    "questionIndex" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "revealedAt" TIMESTAMP(3),

    CONSTRAINT "LiveQuizQuestion_pkey" PRIMARY KEY ("gameId","questionIndex")
);

-- CreateTable
CREATE TABLE "LiveQuizAction" (
    "gameId" TEXT NOT NULL,
    "questionIndex" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "actionKind" "LiveQuizActionKind" NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LiveQuizAction_pkey" PRIMARY KEY ("gameId","questionIndex","userId","actionKind")
);

-- CreateIndex
CREATE INDEX "LiveQuizAction_gameId_userId_idx" ON "LiveQuizAction"("gameId", "userId");

-- AddForeignKey
ALTER TABLE "LiveQuizQuestion" ADD CONSTRAINT "LiveQuizQuestion_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "LiveGame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveQuizAction" ADD CONSTRAINT "LiveQuizAction_gameId_questionIndex_fkey" FOREIGN KEY ("gameId", "questionIndex") REFERENCES "LiveQuizQuestion"("gameId", "questionIndex") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveQuizAction" ADD CONSTRAINT "LiveQuizAction_gameId_userId_fkey" FOREIGN KEY ("gameId", "userId") REFERENCES "LiveGamePlayer"("gameId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Ook de klok loopt tijdens COMMIT door. Deze deferred guard toetst de echte
-- DB-tijd tijdens de deferred commitafhandeling, na de domeinwrites.
-- NativeSession blijft de enige sessiebron; de GUC is uitsluitend transactielokaal.
CREATE FUNCTION native_socket_commit_valid(expected_user_id text DEFAULT NULL) RETURNS boolean
LANGUAGE sql AS $$
  SELECT NULLIF(current_setting('versado.native_session_id', true), '') IS NULL OR EXISTS (
    SELECT 1 FROM "NativeSession" s JOIN "User" u ON u.id = s."userId"
    WHERE s.id = NULLIF(current_setting('versado.native_session_id', true), '')::uuid
      AND (expected_user_id IS NULL OR s."userId" = expected_user_id) AND s."revokedAt" IS NULL
      AND s."expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')
      AND s."sessionVersion" = NULLIF(current_setting('versado.native_session_version', true), '')::integer
      AND u."sessionVersion" = s."sessionVersion" AND NOT u."mustChangePassword"
      AND (NOT u."isAdmin" OR u."totpEnabled")
  );
$$;

CREATE FUNCTION enforce_live_quiz_action_commit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "LiveGame" g JOIN "LiveQuizQuestion" q ON q."gameId" = g.id
    WHERE g.id = NEW."gameId" AND g.status = 'IN_PROGRESS'
      AND g."quizIndex" = NEW."questionIndex" AND q."questionIndex" = NEW."questionIndex"
      AND q."startedAt" IS NOT NULL AND q."revealedAt" IS NULL
      AND q.deadline > (clock_timestamp() AT TIME ZONE 'UTC')
  ) THEN RAISE EXCEPTION 'Live quiz question closed before commit' USING ERRCODE = '23514'; END IF;
  IF NOT native_socket_commit_valid(NEW."userId") THEN
    RAISE EXCEPTION 'Native session expired before live quiz commit' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "LiveQuizAction_commit_guard"
AFTER INSERT ON "LiveQuizAction" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_live_quiz_action_commit();

-- Start/deelname/vertrek/opgeven gebruiken dezelfde native commitgrens. Alleen
-- de twee quizmodi vallen hieronder; andere spelengines krijgen geen extra claim.
CREATE FUNCTION enforce_native_quiz_state_commit() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'LiveGame' THEN
    IF COALESCE(NEW.mode, OLD.mode) NOT IN ('EXERCISES', 'CHAPTER_GUESS') THEN RETURN NULL; END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM "LiveGame" WHERE id = COALESCE(NEW."gameId", OLD."gameId") AND mode IN ('EXERCISES', 'CHAPTER_GUESS')) THEN
    RETURN NULL;
  END IF;
  IF NOT native_socket_commit_valid() THEN
    RAISE EXCEPTION 'Native session expired before live quiz state commit' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "LiveGame_native_quiz_commit_guard"
AFTER INSERT OR UPDATE OR DELETE ON "LiveGame" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_native_quiz_state_commit();
CREATE CONSTRAINT TRIGGER "LiveGamePlayer_native_quiz_commit_guard"
AFTER INSERT OR UPDATE OR DELETE ON "LiveGamePlayer" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_native_quiz_state_commit();

COMMIT;
