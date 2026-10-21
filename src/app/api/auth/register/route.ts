import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { anonymousLanguage } from "@/lib/requestLanguage";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { HANDLE_REGEX, HANDLE_MIN_LENGTH, HANDLE_MAX_LENGTH, containsForbiddenEmoji } from "@/lib/handle";
import { isEmailConfigured, sendMail } from "@/lib/email";
import { registrationAttemptTemplate } from "@/lib/emailTemplates";
import { getT } from "@/lib/i18n";
import { getBaseUrl } from "@/lib/baseUrl";
import { BOFM_WORK, resolveEditionId } from "@/lib/contentCollections";
import { createAccount, startPendingRegistration } from "@/lib/registration";
import { safeReturnPath } from "@/lib/returnTo";
import { apiError, apiErrorText } from "@/lib/apiError";
import { authBudget, authBudgetKey } from "@/lib/authBudget";
import { clientIp } from "@/lib/rateLimit";
import { boundedJson } from "@/lib/requestBody";

const schema = z.object({
  email: z.string().trim().toLowerCase().email("Vul een geldig e-mailadres in.").max(320),
  handle: z
    .string()
    .trim()
    .min(HANDLE_MIN_LENGTH, `Gebruikersnaam moet minstens ${HANDLE_MIN_LENGTH} tekens zijn.`)
    .max(HANDLE_MAX_LENGTH, `Gebruikersnaam mag maximaal ${HANDLE_MAX_LENGTH} tekens zijn.`)
    .regex(HANDLE_REGEX, "Alleen letters, cijfers, spaties, -, _ en emoji toegestaan.")
    .refine((v) => !containsForbiddenEmoji(v), "Deze emoji is niet toegestaan in een gebruikersnaam."),
  password: z.string().min(8, "Wachtwoord moet minstens 8 tekens zijn.").max(256),
  // Code uit een uitnodigingslink (zie src/lib/friendInvite.ts), optioneel.
  inviteCode: z.string().trim().max(32).optional(),
  // Waar iemand na bevestiging heen wil (bv. een groepslink), zie src/lib/returnTo.ts.
  next: z.string().max(512).optional(),
});

const REGISTRATION_NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;
const noticeSentAt = new Map<string, number>();

// Bewust zonder tekst: het registratiescherm toont zelf de (vertaalde)
// melding, en een vaste Nederlandse zin hier liep buiten de vertalingen om.
const GENERIC_RESPONSE = { ok: true };

function noticeKey(email: string): string {
  // Het e-mailadres mag niet in de rate-limit-sleutel blijven staan als deze
  // map tijdens de levensduur van het proces wordt geïnspecteerd.
  return createHash("sha256").update(email).digest("hex");
}

function maySendRegistrationNotice(email: string): boolean {
  const key = noticeKey(email);
  const now = Date.now();
  const lastSent = noticeSentAt.get(key);
  if (lastSent && now - lastSent < REGISTRATION_NOTICE_WINDOW_MS) return false;
  noticeSentAt.set(key, now);
  if (noticeSentAt.size > 5000) {
    for (const [storedKey, sentAt] of noticeSentAt) {
      if (now - sentAt >= REGISTRATION_NOTICE_WINDOW_MS) noticeSentAt.delete(storedKey);
    }
  }
  return true;
}

export async function POST(req: NextRequest) {
  const limited = await authBudget(authBudgetKey("register-ip", clientIp(req)), 30, 15 * 60_000);
  if (limited) return limited;
  const body = await boundedJson(req);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return await apiErrorText(parsed.error.issues[0].message, 400);
  }
  const { email, handle, password, inviteCode, next } = parsed.data;

  const existingEmail = await prisma.user.findUnique({ where: { email } });
  if (existingEmail) {
    // Geef geen account-specifieke respons en maak geen tweede account aan.
    // De melding is bewust beperkt tot maximaal één keer per dag: anders kan
    // dit eindpunt worden misbruikt om iemand met e-mails lastig te vallen.
    if (await isEmailConfigured() && maySendRegistrationNotice(email)) {
      const { subject, html, text } = registrationAttemptTemplate(getT(existingEmail.uiLanguage));
      await sendMail({ to: existingEmail.email, subject, html, text });
    }
    return NextResponse.json(GENERIC_RESPONSE);
  }

  const passwordHash = await hashPassword(password);

  // Taal van het apparaat (zie requestLanguage): bepaalt de taal van de app
  // en welke uitgave iemand leest.
  const uiLanguage = await anonymousLanguage();
  const editionId = await resolveEditionId(BOFM_WORK, uiLanguage);
  const edition = editionId
    ? await prisma.contentCollection.findUnique({ where: { id: editionId }, select: { language: true } })
    : null;
  const contentLanguage = edition?.language ?? "nl";

  // Met e-mail: nog geen account, alleen een aanmelding die pas bij het
  // klikken op de link een account wordt (src/lib/registration.ts). Het
  // antwoord is gelijk aan dat voor een bestaand adres, en er komt geen
  // sessie: niets verraadt of een adres al een account heeft.
  if (await isEmailConfigured()) {
    await startPendingRegistration(
      { email, handle, passwordHash, uiLanguage, contentLanguage, inviteCode, returnTo: safeReturnPath(next) },
      getBaseUrl(req)
    );
    return NextResponse.json(GENERIC_RESPONSE);
  }

  try {
    await createAccount({ email, handle, passwordHash, uiLanguage, contentLanguage, inviteCode, emailVerifiedAt: null });
  } catch (e) {
    console.error("Account aanmaken mislukt:", e);
    return await apiError("apiErrors.uniqueHandleFailed", 409);
  }
  // Geen id, tag, uitnodiger of sessie teruggeven: zie hierboven.
  return NextResponse.json(GENERIC_RESPONSE);
}
