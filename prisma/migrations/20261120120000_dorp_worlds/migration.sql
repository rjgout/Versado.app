BEGIN;
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "XPReason" ADD VALUE 'VILLAGE_GIFT_SENT';
ALTER TYPE "XPReason" ADD VALUE 'VILLAGE_GIFT_RECEIVED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "shareVillageWithFriends" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ContentSwitcherSettings" ADD COLUMN     "dorpVisibleToUsers" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DorpVillage" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "groupId" TEXT,
    "phase" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DorpVillage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DorpMember" (
    "villageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DorpMember_pkey" PRIMARY KEY ("villageId","userId")
);

-- CreateTable
CREATE TABLE "DorpOwnedObject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DorpOwnedObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DorpPlacement" (
    "villageId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "u" INTEGER NOT NULL,
    "v" INTEGER NOT NULL,

    CONSTRAINT "DorpPlacement_pkey" PRIMARY KEY ("villageId","objectId")
);

-- CreateTable
CREATE TABLE "DorpPath" (
    "villageId" TEXT NOT NULL,
    "u" INTEGER NOT NULL,
    "v" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "DorpPath_pkey" PRIMARY KEY ("villageId","u","v")
);

-- CreateTable
CREATE TABLE "DorpAction" (
    "userId" TEXT NOT NULL,
    "actionId" UUID NOT NULL,
    "villageId" TEXT NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DorpAction_pkey" PRIMARY KEY ("userId","actionId")
);

-- CreateTable
CREATE TABLE "DorpMoveRequest" (
    "id" TEXT NOT NULL,
    "villageId" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DorpMoveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DorpGift" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "actionId" UUID NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DorpGift_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DorpVillage_ownerId_key" ON "DorpVillage"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "DorpVillage_groupId_key" ON "DorpVillage"("groupId");

-- CreateIndex
CREATE INDEX "DorpMember_userId_idx" ON "DorpMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DorpOwnedObject_userId_objectId_ordinal_key" ON "DorpOwnedObject"("userId", "objectId", "ordinal");

-- CreateIndex
CREATE INDEX "DorpPlacement_objectId_idx" ON "DorpPlacement"("objectId");

-- CreateIndex
CREATE INDEX "DorpPath_userId_idx" ON "DorpPath"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DorpMoveRequest_villageId_objectId_requesterId_key" ON "DorpMoveRequest"("villageId", "objectId", "requesterId");

-- CreateIndex
CREATE INDEX "DorpGift_senderId_receiverId_createdAt_idx" ON "DorpGift"("senderId", "receiverId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DorpGift_senderId_actionId_key" ON "DorpGift"("senderId", "actionId");

-- AddForeignKey
ALTER TABLE "DorpVillage" ADD CONSTRAINT "DorpVillage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpVillage" ADD CONSTRAINT "DorpVillage_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "SocialGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpMember" ADD CONSTRAINT "DorpMember_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "DorpVillage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpMember" ADD CONSTRAINT "DorpMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpOwnedObject" ADD CONSTRAINT "DorpOwnedObject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpPlacement" ADD CONSTRAINT "DorpPlacement_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "DorpVillage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpPlacement" ADD CONSTRAINT "DorpPlacement_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "DorpOwnedObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpPath" ADD CONSTRAINT "DorpPath_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "DorpVillage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpPath" ADD CONSTRAINT "DorpPath_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpAction" ADD CONSTRAINT "DorpAction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpAction" ADD CONSTRAINT "DorpAction_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "DorpVillage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpMoveRequest" ADD CONSTRAINT "DorpMoveRequest_villageId_fkey" FOREIGN KEY ("villageId") REFERENCES "DorpVillage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpMoveRequest" ADD CONSTRAINT "DorpMoveRequest_objectId_fkey" FOREIGN KEY ("objectId") REFERENCES "DorpOwnedObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpMoveRequest" ADD CONSTRAINT "DorpMoveRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpGift" ADD CONSTRAINT "DorpGift_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DorpGift" ADD CONSTRAINT "DorpGift_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Geen bestaande rij wordt bijgewerkt, gekopieerd of automatisch beschikbaar gemaakt.
ALTER TABLE "DorpVillage" ADD CONSTRAINT "DorpVillage_owner_xor_group" CHECK (("ownerId" IS NOT NULL) <> ("groupId" IS NOT NULL)), ADD CONSTRAINT "DorpVillage_bounds" CHECK ("phase" BETWEEN 0 AND 16 AND "version" >= 0);
ALTER TABLE "DorpOwnedObject" ADD CONSTRAINT "DorpOwnedObject_level" CHECK ("level" BETWEEN 1 AND 3 AND "ordinal" >= 0);
ALTER TABLE "DorpPlacement" ADD CONSTRAINT "DorpPlacement_bounds" CHECK ("u" BETWEEN -62 AND 62 AND "v" BETWEEN -62 AND 62);
ALTER TABLE "DorpPath" ADD CONSTRAINT "DorpPath_bounds" CHECK ("u" BETWEEN -62 AND 62 AND "v" BETWEEN -62 AND 62);
ALTER TABLE "DorpMoveRequest" ADD CONSTRAINT "DorpMoveRequest_status" CHECK ("status" IN ('OPEN', 'CLOSED'));
ALTER TABLE "DorpGift" ADD CONSTRAINT "DorpGift_amount" CHECK ("amount" = 5 AND "senderId" <> "receiverId");

-- Ook buiten de app geen zesde groepsdorp; volgorde User -> groep -> dorp in de service.
CREATE FUNCTION "dorp_member_limit"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "id" FROM "User" WHERE "id" = NEW."userId" FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM "DorpVillage" WHERE "id" = NEW."villageId" AND "groupId" IS NOT NULL) THEN
    RAISE EXCEPTION 'DorpMember requires a group village';
  END IF;
  IF (SELECT COUNT(*) FROM "DorpMember" WHERE "userId" = NEW."userId" AND "villageId" <> NEW."villageId") >= 5 THEN
    RAISE EXCEPTION 'DorpMember maximum exceeded';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "dorp_member_limit" BEFORE INSERT OR UPDATE ON "DorpMember" FOR EACH ROW EXECUTE FUNCTION "dorp_member_limit"();

COMMIT;
