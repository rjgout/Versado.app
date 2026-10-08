-- Versado Kompas: gebruikersstatus van uitleg en rondleidingen, en de schakelaar
-- voor uitnodigingen. Bestaande accounts krijgen kompasOffersEnabled = false,
-- zodat zij niet met terugwerkende kracht uitnodigingen te zien krijgen;
-- nieuwe accounts beginnen met true. De uitleg zelf blijft voor iedereen
-- bereikbaar via "Ontdek Versado".

-- CreateEnum
CREATE TYPE "KompasItemKind" AS ENUM ('GUIDE', 'TOUR');
CREATE TYPE "KompasStatus" AS ENUM ('VIEWED', 'SKIPPED', 'COMPLETED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "kompasOffersEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "KompasProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT '',
    "kind" "KompasItemKind" NOT NULL,
    "status" "KompasStatus" NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KompasProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KompasProgress_userId_topicId_scope_kind_key" ON "KompasProgress"("userId", "topicId", "scope", "kind");
CREATE INDEX "KompasProgress_userId_idx" ON "KompasProgress"("userId");

-- AddForeignKey
ALTER TABLE "KompasProgress" ADD CONSTRAINT "KompasProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: bestaande accounts krijgen geen automatische uitnodigingen.
UPDATE "User" SET "kompasOffersEnabled" = false;
