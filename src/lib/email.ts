import { randomBytes } from "node:crypto";
import { applicationOrigin } from "@/lib/baseUrl";
import { mailPreview, trackingHash, type MailMeta } from "@/lib/mailHistory";
import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { APP_NAME } from "@/lib/brand";

export interface EmailSettingsView {
  enabled: boolean;
  trackOpens?: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  fromEmail: string;
  fromName: string;
  hasPassword: boolean;
}

async function getSettingsRow() {
  return prisma.emailSettings.findUnique({ where: { id: "singleton" } });
}

/** Instellingen zonder het wachtwoord zelf — voor de admin-UI (GET). */
export async function getEmailSettingsView(): Promise<EmailSettingsView> {
  const row = await getSettingsRow();
  return {
    enabled: row?.enabled ?? false,
    trackOpens: row?.trackOpens ?? false,
    smtpHost: row?.smtpHost ?? "",
    smtpPort: row?.smtpPort ?? 587,
    smtpSecure: row?.smtpSecure ?? false,
    smtpUsername: row?.smtpUsername ?? "",
    fromEmail: row?.fromEmail ?? "",
    fromName: row?.fromName ?? APP_NAME,
    hasPassword: Boolean(row?.smtpPasswordEnc),
  };
}

export interface EmailSettingsInput {
  enabled: boolean;
  trackOpens?: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUsername: string;
  /** Leeg laten = bestaand wachtwoord behouden. */
  smtpPassword?: string;
  fromEmail: string;
  fromName: string;
}

export async function saveEmailSettings(input: EmailSettingsInput): Promise<void> {
  await prisma.emailSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      enabled: input.enabled,
      ...(input.trackOpens !== undefined ? { trackOpens: input.trackOpens } : {}),
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
      smtpUsername: input.smtpUsername,
      smtpPasswordEnc: input.smtpPassword ? encryptSecret(input.smtpPassword) : null,
      fromEmail: input.fromEmail,
      fromName: input.fromName,
    },
    update: {
      enabled: input.enabled,
      ...(input.trackOpens !== undefined ? { trackOpens: input.trackOpens } : {}),
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      smtpSecure: input.smtpSecure,
      smtpUsername: input.smtpUsername,
      ...(input.smtpPassword ? { smtpPasswordEnc: encryptSecret(input.smtpPassword) } : {}),
      fromEmail: input.fromEmail,
      fromName: input.fromName,
    },
  });
}

export async function isEmailConfigured(): Promise<boolean> {
  const row = await getSettingsRow();
  return Boolean(row?.enabled && row.smtpHost && row.smtpUsername && row.smtpPasswordEnc && row.fromEmail);
}

async function getTransport() {
  const row = await getSettingsRow();
  if (!row?.enabled || !row.smtpHost || !row.smtpUsername || !row.smtpPasswordEnc || !row.fromEmail) {
    return null;
  }
  const password = decryptSecret(row.smtpPasswordEnc);
  const transporter = nodemailer.createTransport({
    host: row.smtpHost,
    port: row.smtpPort,
    secure: row.smtpSecure,
    auth: { user: row.smtpUsername, pass: password },
  });
  return { transporter, from: `"${row.fromName || APP_NAME}" <${row.fromEmail}>`, redact: (value: string) => mailPreview(value.replaceAll(password, "[redacted]").replaceAll(row.smtpUsername!, "[redacted]")) };
}

export interface SendMailInput {
  meta?: MailMeta;
  to: string;
  subject: string;
  html: string;
  text: string;
  // Voor bv. een bijgevoegde screenshot bij feedback (zie src/lib/feedback.ts).
  attachments?: { filename: string; content: Buffer; contentType?: string }[];
  // Extra mailheaders, bv. List-Unsubscribe voor notificatiemails (zie notify.ts).
  headers?: Record<string, string>;
}

/** Geeft {ok:false} terug (i.p.v. te gooien) als er geen werkende configuratie is — de aanroeper beslist dan zelf hoe daarmee om te gaan. */
export async function sendMail(input: SendMailInput): Promise<{ ok: boolean; error?: string }> {
  const meta = input.meta ?? {};
  const authLink = /\/(?:reset-password|verify-email)\?/i.test(input.text + input.html);
  const kind = meta.kind ?? "OTHER";
  const sensitive = authLink || ["PASSWORD_RESET", "EMAIL_VERIFY", "PENDING_VERIFY"].includes(kind);
  const token = randomBytes(32).toString("base64url");
  let message;
  let html = input.html;
  try {
    const settings = await getSettingsRow();
    const track = Boolean(settings?.trackOpens && !meta.skipReason);
    // Authenticatiebewijzen worden nooit bewaard, ook niet versleuteld.
    const payload = !sensitive && !input.attachments?.length && !meta.skipReason && Buffer.byteLength(input.html + input.text) <= 256_000
      ? encryptSecret(JSON.stringify({ to: input.to, subject: input.subject, html: input.html, text: input.text, headers: input.headers })) : null;
    message = await prisma.mailMessage.create({ data: {
      recipient: input.to, userId: meta.userId, kind, category: meta.category,
      subject: mailPreview(input.subject).slice(0, 500), previewText: mailPreview(input.text), payloadEnc: payload,
      status: meta.skipReason ? "SKIPPED" : "SENDING", error: meta.skipReason,
      trackingHash: track ? trackingHash(token) : null, resendOfId: meta.resendOfId, actorId: meta.actorId,
    } });
    if (meta.skipReason) return { ok: false, error: "E-mail overgeslagen." };
    if (track) html += `<img src="${applicationOrigin()}/api/mail/open/${token}" width="1" height="1" alt="" />`;
  } catch {
    return { ok: false, error: "De e-mail kon niet veilig worden geregistreerd." };
  }
  let redact = mailPreview;
  let outcome: { ok: boolean; error?: string };
  let status = "FAILED", error: string | null = null, smtpMessageId: string | null = null, smtpResponse: string | null = null;
  try {
    const transport = await getTransport();
    if (!transport) {
      status = "SKIPPED"; error = "CONFIGURATION";
      outcome = { ok: false, error: "E-mail is niet (volledig) geconfigureerd." };
    } else {
      redact = transport.redact;
      const info = await transport.transporter.sendMail({ from: transport.from, to: input.to, subject: input.subject,
        html, text: input.text, attachments: input.attachments, headers: input.headers });
      smtpMessageId = typeof info.messageId === "string" ? redact(info.messageId).slice(0, 500) : null;
      smtpResponse = typeof info.response === "string" ? redact(info.response).slice(0, 1000) : null;
      const accepted = Array.isArray(info.accepted) && info.accepted.length > 0 && (!Array.isArray(info.rejected) || info.rejected.length === 0);
      status = accepted ? "ACCEPTED" : "FAILED";
      error = accepted ? null : "SMTP_REJECTED";
      outcome = accepted ? { ok: true } : { ok: false, error: "De mailserver heeft de ontvanger niet geaccepteerd." };
    }
  } catch (e) {
    const code = typeof e === "object" && e && "code" in e ? String(e.code) : "";
    status = ["ETIMEDOUT", "ECONNRESET", "ESOCKET", "ECONNECTION"].includes(code) ? "UNKNOWN" : "FAILED";
    error = redact(e instanceof Error ? e.message : "SMTP_ERROR").slice(0, 1000);
    outcome = { ok: false, error: "Het versturen van de e-mail is mislukt of kon niet worden bevestigd." };
  }
  // Na SMTP-acceptatie nooit een tweede verzendpoging suggereren door een logfout.
  await prisma.mailMessage.update({ where: { id: message.id }, data: { status, error, smtpMessageId, smtpResponse, completedAt: new Date() } }).catch(() => {});
  return outcome;
}

export async function sendTestMail(to: string, userId?: string): Promise<{ ok: boolean; error?: string }> {
  return sendMail({
    to,
    meta: { kind: "TEST", userId },
    subject: `${APP_NAME} — testmail`,
    text: `Dit is een testmail vanuit ${APP_NAME}. Als je dit ontvangt, werkt je e-mailconfiguratie.`,
    html: `<p>Dit is een testmail vanuit <strong>${APP_NAME}</strong>. Als je dit ontvangt, werkt je e-mailconfiguratie.</p>`,
  });
}
