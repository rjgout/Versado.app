import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { parseTag } from "@/lib/handle";
import { createAuthToken } from "@/lib/authTokens";
import { isEmailConfigured, sendMail } from "@/lib/email";
import { resetPasswordTemplate } from "@/lib/emailTemplates";
import { getT } from "@/lib/i18n";
import { getBaseUrl } from "@/lib/baseUrl";
import { apiError, apiErrorText } from "@/lib/apiError";

const schema = z.object({
  identifier: z.string().trim().min(1, "Vul je e-mailadres of gebruikersnaam in."),
});

// Geeft altijd hetzelfde generieke antwoord terug, ongeacht of het account
// bestaat — anders kan iemand via deze route achterhalen welke
// e-mailadressen/gebruikersnamen wel/niet geregistreerd zijn.
const GENERIC_RESPONSE = {
  ok: true,
  message: "Als er een account bestaat met deze gegevens, is er een e-mail verstuurd met een resetlink.",
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return await apiErrorText(parsed.error.issues[0].message, 400);
  }
  const { identifier } = parsed.data;

  if (!(await isEmailConfigured())) {
    // Geen enumeratie-risico hier: dit is een instellingsprobleem, geen
    // account-specifiek antwoord.
    return await apiError("apiErrors.resetNotConfigured", 503);
  }

  const tag = parseTag(identifier);
  const user = tag
    ? await prisma.user.findFirst({
        where: { handle: { equals: tag.handle, mode: "insensitive" }, discriminator: tag.discriminator },
      })
    : await prisma.user.findUnique({ where: { email: identifier.toLowerCase() } });

  if (user?.passwordLoginEnabled) {
    const rawToken = await createAuthToken(user.id, "PASSWORD_RESET");
    const link = `${getBaseUrl(req)}/reset-password?token=${rawToken}`;
    const { subject, html, text } = resetPasswordTemplate(getT(user.uiLanguage), link);
    await sendMail({ to: user.email, subject, html, text });
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
