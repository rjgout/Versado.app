import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";

export const MAIL_RETENTION_MS = 90 * 86400_000;
export { MAIL_KINDS, MAIL_STATUSES } from "./mailHistoryTypes";
import type { MailKind } from "./mailHistoryTypes";
export interface MailMeta {
  kind?: MailKind;
  userId?: string;
  category?: string;
  resendOfId?: string;
  actorId?: string;
  skipReason?: "CONFIGURATION" | "PREFERENCES" | "ONLINE";
}

/** Ook in foutmeldingen en previews mogen geen werkende links of ruwe bewijzen terechtkomen. */
export function mailPreview(value: string): string {
  return value.replace(/https?:\/\/[^\s<>"']+/gi, "[link]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]").slice(0, 20_000);
}
export function trackingHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function cleanupMailHistory(now = new Date()) {
  await prisma.mailMessage.updateMany({ where: { status: "SENDING", createdAt: { lt: new Date(now.getTime() - 10 * 60_000) } }, data: { status: "UNKNOWN", error: "INTERRUPTED" } });
  return prisma.mailMessage.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - MAIL_RETENTION_MS) } } });
}

/** Geen IP, user-agent of ontvanger in de URL; atomaire teller, ook bij gelijktijdige ophalingen. */
export async function recordMailOpen(token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  await prisma.$executeRaw`
    UPDATE "MailMessage" SET "firstOpenedAt" = COALESCE("firstOpenedAt", ${now}),
      "lastOpenedAt" = GREATEST(COALESCE("lastOpenedAt", ${now}), ${now}), "openCount" = "openCount" + 1
    WHERE "trackingHash" = ${trackingHash(token)} AND "status" IN ('SENDING','ACCEPTED','UNKNOWN')
      AND "createdAt" >= ${new Date(now.getTime() - MAIL_RETENTION_MS)} AND "openCount" < 1000000
      AND EXISTS (SELECT 1 FROM "EmailSettings" WHERE "id"='singleton' AND "trackOpens"=true)`;
}
