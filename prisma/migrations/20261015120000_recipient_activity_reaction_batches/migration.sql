-- Bestaande onverzonden item-batches worden samengevoegd per ontvanger.
-- De vroegste batch blijft bestaan; reacties van de andere batches worden
-- eraan gekoppeld zodat een deployment geen nog te verzenden reacties verliest.
-- Prisma kan losse statements van een migratie afzonderlijk committen. De
-- tijdelijke samenvoegtabel moet daarom binnen hetzelfde statement blijven;
-- anders verdwijnt zij al vóór de volgende UPDATE.
DO $migration$
BEGIN
  CREATE TEMP TABLE "_ActivityReactionBatchMerge" AS
  SELECT
    b."id",
    first_value(b."id") OVER (
      PARTITION BY b."recipientUserId"
      ORDER BY b."sendAfter", b."createdAt", b."id"
    ) AS "keepId"
  FROM "ActivityReactionNotificationBatch" b
  WHERE b."sentAt" IS NULL;

  UPDATE "ActivityFeedReaction" r
  SET "notificationBatchId" = m."keepId"
  FROM "_ActivityReactionBatchMerge" m
  WHERE r."notificationBatchId" = m."id"
    AND m."id" <> m."keepId";

  UPDATE "ActivityReactionNotificationBatch" b
  SET
    "firstReactionAt" = v."firstReactionAt",
    "sendAfter" = v."sendAfter"
  FROM (
    SELECT
      m."keepId",
      min(b."firstReactionAt") AS "firstReactionAt",
      min(b."sendAfter") AS "sendAfter"
    FROM "_ActivityReactionBatchMerge" m
    JOIN "ActivityReactionNotificationBatch" b ON b."id" = m."id"
    GROUP BY m."keepId"
  ) v
  WHERE b."id" = v."keepId";

  DELETE FROM "ActivityReactionNotificationBatch" b
  USING "_ActivityReactionBatchMerge" m
  WHERE b."id" = m."id"
    AND m."id" <> m."keepId";

  DROP TABLE "_ActivityReactionBatchMerge";
END
$migration$;

ALTER TABLE "ActivityReactionNotificationBatch"
  DROP CONSTRAINT "ActivityReactionNotificationBatch_itemId_fkey";

DROP INDEX "ActivityReactionNotificationBatch_itemId_sentAt_idx";

ALTER TABLE "ActivityReactionNotificationBatch"
  DROP COLUMN "itemId";

-- Een verzonden batch mag naast latere batches blijven bestaan; alleen één
-- nog niet verzonden batch per ontvanger is toegestaan.
CREATE UNIQUE INDEX "ActivityReactionNotificationBatch_one_open_per_recipient_idx"
  ON "ActivityReactionNotificationBatch"("recipientUserId")
  WHERE "sentAt" IS NULL;

DROP INDEX "ActivityReactionNotificationBatch_sendAfter_sentAt_idx";
CREATE INDEX "ActivityReactionNotificationBatch_sentAt_sendAfter_idx"
  ON "ActivityReactionNotificationBatch"("sentAt", "sendAfter");
