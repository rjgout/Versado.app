ALTER TABLE "EmailSettings" ADD COLUMN "trackOpens" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "MailMessage" (
 "id" TEXT NOT NULL PRIMARY KEY, "recipient" TEXT NOT NULL, "userId" TEXT, "kind" TEXT NOT NULL,
 "category" TEXT, "subject" TEXT NOT NULL, "previewText" TEXT NOT NULL, "payloadEnc" TEXT,
 "status" TEXT NOT NULL, "error" TEXT, "smtpMessageId" TEXT, "smtpResponse" TEXT, "trackingHash" TEXT,
 "firstOpenedAt" TIMESTAMP(3), "lastOpenedAt" TIMESTAMP(3), "openCount" INTEGER NOT NULL DEFAULT 0,
 "resendOfId" TEXT, "actorId" TEXT, "lastResendAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3),
 CONSTRAINT "MailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "MailMessage_resendOfId_fkey" FOREIGN KEY ("resendOfId") REFERENCES "MailMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MailMessage_trackingHash_key" ON "MailMessage"("trackingHash");
CREATE INDEX "MailMessage_createdAt_idx" ON "MailMessage"("createdAt");
CREATE INDEX "MailMessage_recipient_createdAt_idx" ON "MailMessage"("recipient", "createdAt");
CREATE INDEX "MailMessage_status_createdAt_idx" ON "MailMessage"("status", "createdAt");
