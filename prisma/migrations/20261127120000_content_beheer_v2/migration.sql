-- Contentbeheer V2 (docs/CONTENTBEHEER.md): RETIRED-status voor vervangen oefeningen, registratie van audio-afhankelijkheden per hoofdstuk
-- en een logboek van de beheeracties. Uitsluitend toevoegingen; bestaande gegevens en gedrag blijven ongewijzigd.

ALTER TYPE "ContentStatus" ADD VALUE IF NOT EXISTS 'RETIRED';

CREATE TYPE "AudioCheckStatus" AS ENUM ('CURRENT', 'NEEDS_REVIEW');
CREATE TYPE "ContentUpdateKind" AS ENUM ('CONTENT_UPDATE', 'SCRIPTURE_CHECK', 'SCRIPTURE_PREPARE', 'SCRIPTURE_PUBLISH');
CREATE TYPE "ContentUpdateStatus" AS ENUM ('RUNNING', 'OK', 'PARTIAL', 'FAILED');

CREATE TABLE "ChapterAudioCheck" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "status" "AudioCheckStatus" NOT NULL DEFAULT 'CURRENT',
    "textHash" TEXT NOT NULL,
    "pendingHash" TEXT,
    "detail" JSONB,
    "flaggedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChapterAudioCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChapterAudioCheck_chapterId_key" ON "ChapterAudioCheck"("chapterId");
CREATE INDEX "ChapterAudioCheck_status_idx" ON "ChapterAudioCheck"("status");
ALTER TABLE "ChapterAudioCheck" ADD CONSTRAINT "ChapterAudioCheck_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ContentUpdateRun" (
    "id" TEXT NOT NULL,
    "kind" "ContentUpdateKind" NOT NULL,
    "status" "ContentUpdateStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "plan" JSONB,
    "planHash" TEXT,
    "error" TEXT,
    "createdById" TEXT,
    CONSTRAINT "ContentUpdateRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ContentUpdateRun_kind_startedAt_idx" ON "ContentUpdateRun"("kind", "startedAt");

-- Backfill: elk hoofdstuk dat nu audio heeft, gaat als "passend" van start met de hash van zijn huidige tekst. Zo krijgt een bestaande
-- gebruiker of beheerder geen melding voor audio die vandaag gewoon klopt; alleen een latere tekstwijziging markeert het hoofdstuk.
-- De hash is md5 over de verzen in volgorde, gescheiden door een regeleinde (identiek aan src/lib/audioCheck.ts).
INSERT INTO "ChapterAudioCheck" ("id", "chapterId", "status", "textHash", "updatedAt")
SELECT 'ac_' || c."id", c."id", 'CURRENT', md5(string_agg(v."text", E'\n' ORDER BY v."number")), CURRENT_TIMESTAMP
FROM "Chapter" c
JOIN "Verse" v ON v."chapterId" = c."id"
WHERE c."audioUrl" IS NOT NULL
GROUP BY c."id"
ON CONFLICT ("chapterId") DO NOTHING;
