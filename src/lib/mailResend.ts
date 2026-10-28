import { prisma } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { sendMail, type SendMailInput } from "@/lib/email";
import { createAuthToken } from "@/lib/authTokens";
import { verifyEmailTemplate, resetPasswordTemplate } from "@/lib/emailTemplates";
import { applicationOrigin } from "@/lib/baseUrl";
import { getT } from "@/lib/i18n";
import { resendPendingVerification } from "@/lib/registration";
import { resendNotificationMail } from "@/lib/notify";
import { NOTIFY_CATEGORIES, type NotifyCategory } from "@/lib/notifyCategories";
import { MAIL_RETENTION_MS } from "@/lib/mailHistory";
import type { MailKind } from "@/lib/mailHistoryTypes";

export class MailResendError extends Error {
  constructor(readonly reason: "unavailable" | "cooldown" | "preferences" | "failed") { super(reason); }
}

/** Geen replay van oude beveiligingslinks, geen nieuwe ontvanger en geen automatische retries bij onzekere aflevering. */
export async function resendMail(id: string, actorId: string) {
  const row = await prisma.mailMessage.findUnique({ where: { id }, include: { user: true } });
  const now = new Date();
  if (!row || row.createdAt.getTime() < now.getTime() - MAIL_RETENTION_MS || ["SENDING", "SKIPPED"].includes(row.status)) throw new MailResendError("unavailable");
  if (row.userId && (!row.user || row.user.email !== row.recipient)) throw new MailResendError("unavailable");
  const rootId = row.resendOfId ?? row.id;
  const meta = { kind: row.kind as MailKind, userId: row.userId ?? undefined, category: row.category ?? undefined, actorId, resendOfId: rootId };
  let input: SendMailInput | null = null;
  let pending: Awaited<ReturnType<typeof prisma.pendingRegistration.findFirst>> = null;
  if (row.kind === "PENDING_VERIFY") {
    if (await prisma.user.findUnique({ where: { email: row.recipient } })) throw new MailResendError("unavailable");
    pending = await prisma.pendingRegistration.findFirst({ where: { email: row.recipient, confirmedAt: null } });
    if (!pending) throw new MailResendError("unavailable");
  } else if (["PASSWORD_RESET", "EMAIL_VERIFY"].includes(row.kind)) {
    if (!row.user || (row.kind === "EMAIL_VERIFY" && row.user.emailVerifiedAt) || (row.kind === "PASSWORD_RESET" && !row.user.passwordLoginEnabled)) throw new MailResendError("unavailable");
  } else {
    if (!row.payloadEnc) throw new MailResendError("unavailable");
    try { input = JSON.parse(decryptSecret(row.payloadEnc)) as SendMailInput; } catch { throw new MailResendError("unavailable"); }
    if (!input || input.to !== row.recipient || typeof input.html !== "string" || typeof input.text !== "string" || typeof input.subject !== "string") throw new MailResendError("unavailable");
    input.meta = meta;
    if (row.kind === "NOTIFICATION" && (!row.user || !NOTIFY_CATEGORIES.includes(row.category as NotifyCategory) || !row.user.emailNotificationsEnabled)) throw new MailResendError("preferences");
  }
  const claim = await prisma.mailMessage.updateMany({ where: { id: rootId, OR: [{ lastResendAt: null }, { lastResendAt: { lt: new Date(now.getTime() - 60_000) } }] }, data: { lastResendAt: now } });
  if (!claim.count) throw new MailResendError("cooldown");
  if (pending) {
    const token = await resendPendingVerification(pending, applicationOrigin(), meta);
    if (!token) throw new MailResendError("cooldown");
    const attempt = await prisma.mailMessage.findFirst({ where: { resendOfId: rootId, actorId, createdAt: { gte: now } }, orderBy: { createdAt: "desc" } });
    if (attempt?.status !== "ACCEPTED") throw new MailResendError("failed");
    return;
  }
  if (!input && row.user) {
    const type = row.kind === "PASSWORD_RESET" ? "PASSWORD_RESET" : "EMAIL_VERIFY";
    const raw = await createAuthToken(row.user.id, type);
    const link = `${applicationOrigin()}/${type === "PASSWORD_RESET" ? "reset-password" : "verify-email"}?token=${raw}`;
    const template = type === "PASSWORD_RESET" ? resetPasswordTemplate : verifyEmailTemplate;
    input = { to: row.recipient, ...template(getT(row.user.uiLanguage), link), meta };
  }
  if (!input) throw new MailResendError("unavailable");
  const result = row.kind === "NOTIFICATION"
    ? await resendNotificationMail(input, row.userId!, row.category as NotifyCategory)
    : await sendMail(input);
  if (!result.ok) throw new MailResendError(result.error === "PREFERENCES" ? "preferences" : "failed");
}
