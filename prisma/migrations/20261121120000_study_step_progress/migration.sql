-- Persoonlijke studie 2.0 (CFM): voortgang per stap van de zeven-stappenindeling. Uitsluitend studievoortgang:
-- geen READ-actie, reeks, XP of beloning. Alleen nieuwe objecten; bestaande gegevens en gebruikers blijven ongemoeid.
CREATE TYPE "StudyStepStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

CREATE TABLE "StudyStepProgress" (
  "userId" TEXT NOT NULL,
  "lessonEditionId" TEXT NOT NULL,
  "stepFingerprint" VARCHAR(32) NOT NULL,
  "stepIndex" INTEGER NOT NULL,
  "revisionId" TEXT NOT NULL,
  "status" "StudyStepStatus" NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudyStepProgress_pkey" PRIMARY KEY ("userId", "lessonEditionId", "stepFingerprint"),
  CONSTRAINT "StudyStepProgress_stepIndex_check" CHECK ("stepIndex" BETWEEN 1 AND 7),
  CONSTRAINT "StudyStepProgress_completed_check" CHECK (("status" = 'COMPLETED') = ("completedAt" IS NOT NULL))
);

CREATE INDEX "StudyStepProgress_lessonEditionId_idx" ON "StudyStepProgress"("lessonEditionId");

ALTER TABLE "StudyStepProgress" ADD CONSTRAINT "StudyStepProgress_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "StudyStepProgress" ADD CONSTRAINT "StudyStepProgress_lessonEditionId_fkey"
  FOREIGN KEY ("lessonEditionId") REFERENCES "StudyLessonEdition"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
