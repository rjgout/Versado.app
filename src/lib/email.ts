import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { APP_NAME } from "@/lib/brand";

export interface EmailSettingsView {
  enabled: boolean;
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
  const transporter = nodemailer.createTransport({
    host: row.smtpHost,
    port: row.smtpPort,
    secure: row.smtpSecure,
    auth: { user: row.smtpUsername, pass: decryptSecret(row.smtpPasswordEnc) },
  });
  return { transporter, from: `"${row.fromName || APP_NAME}" <${row.fromEmail}>` };
}

interface SendMailInput {
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
  const transport = await getTransport();
  if (!transport) return { ok: false, error: "E-mail is niet (volledig) geconfigureerd." };

  try {
    await transport.transporter.sendMail({
      from: transport.from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: input.attachments,
      headers: input.headers,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Onbekende fout bij het versturen." };
  }
}

export async function sendTestMail(to: string): Promise<{ ok: boolean; error?: string }> {
  return sendMail({
    to,
    subject: `${APP_NAME} — testmail`,
    text: `Dit is een testmail vanuit ${APP_NAME}. Als je dit ontvangt, werkt je e-mailconfiguratie.`,
    html: `<p>Dit is een testmail vanuit <strong>${APP_NAME}</strong>. Als je dit ontvangt, werkt je e-mailconfiguratie.</p>`,
  });
}
