-- Genees als bezitbaar item: voorraad per account, aankoopadministratie en
-- de run-velden voor de gratis Genees, voorraad-Genezen en de in-game noodkoop.
-- Bestaande gebruikers beginnen met voorraad 0 en bestaande runs veranderen niet.

-- AlterEnum
ALTER TYPE "XPReason" ADD VALUE 'GENEES_PURCHASED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "geneesBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_geneesBalance_nonnegative" CHECK ("geneesBalance" >= 0);

-- AlterTable
ALTER TABLE "QuickMissionaryRun" ADD COLUMN "stockRevivesUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "inGamePurchaseUsed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "GeneesPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "priceXp" INTEGER NOT NULL,
    "stockBefore" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "runId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeneesPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeneesPurchase_userId_idempotencyKey_key" ON "GeneesPurchase"("userId", "idempotencyKey");
CREATE INDEX "GeneesPurchase_userId_createdAt_idx" ON "GeneesPurchase"("userId", "createdAt");
CREATE INDEX "GeneesPurchase_runId_idx" ON "GeneesPurchase"("runId");

-- AddForeignKey
ALTER TABLE "GeneesPurchase" ADD CONSTRAINT "GeneesPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
