-- Afzonderlijke voorkeur voor samengevatte meldingen over reacties.
ALTER TABLE "User" ADD COLUMN "notifyActivityReactions" BOOLEAN NOT NULL DEFAULT true;

-- Reacties blijven aan hun gebruiker en activiteit gekoppeld. Een optionele
-- batchkoppeling maakt server-side bundeling idempotent per activiteit.
ALTER TABLE "ActivityFeedReaction" ADD COLUMN "notificationBatchId" TEXT;

CREATE TABLE "ActivityReactionNotificationBatch" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "firstReactionAt" TIMESTAMP(3) NOT NULL,
    "sendAfter" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityReactionNotificationBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ActivityFeedReaction_notificationBatchId_idx" ON "ActivityFeedReaction"("notificationBatchId");
CREATE INDEX "ActivityReactionNotificationBatch_sendAfter_sentAt_idx" ON "ActivityReactionNotificationBatch"("sendAfter", "sentAt");
CREATE INDEX "ActivityReactionNotificationBatch_itemId_sentAt_idx" ON "ActivityReactionNotificationBatch"("itemId", "sentAt");
CREATE INDEX "ActivityReactionNotificationBatch_recipientUserId_sentAt_idx" ON "ActivityReactionNotificationBatch"("recipientUserId", "sentAt");

ALTER TABLE "ActivityFeedReaction"
  ADD CONSTRAINT "ActivityFeedReaction_notificationBatchId_fkey"
  FOREIGN KEY ("notificationBatchId") REFERENCES "ActivityReactionNotificationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ActivityReactionNotificationBatch"
  ADD CONSTRAINT "ActivityReactionNotificationBatch_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "ActivityFeedItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "ActivityReactionNotificationBatch_recipientUserId_fkey"
  FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
