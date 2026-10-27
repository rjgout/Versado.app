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
import { authBudget, authBudgetKey } from "@/lib/authBudget";
import { clientIp } from "@/lib/rateLimit";
import { boundedJson } from "@/lib/requestBody";

const schema = z.object({
  identifier: z.string().trim().min(1, "Vul je e-mailadres of gebruikersnaam in.").max(320),
});

// Geeft altijd hetzelfde generieke antwoord terug, ongeacht of het account
// bestaat — anders kan iemand via deze route achterhalen welke
// e-mailadressen/gebruikersnamen wel/niet geregistreerd zijn.
const GENERIC_RESPONSE = {
  ok: true,
  message: "Als er een account bestaat met deze gegevens, is er een e-mail verstuurd met een resetlink.",
};

export async function POST(req: NextRequest) {
  const limited = await authBudget(authBudgetKey("forgot-ip", clientIp(req)), 30, 15 * 60_000);
  if (limited) return limited;
  const body = await boundedJson(req);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return await apiErrorText(parsed.error.issues[0].message, 400);
  }
  const { identifier } = parsed.data;
  const mailLimit = await authBudget(authBudgetKey("forgot-account", identifier.toLowerCase()), 3, 60 * 60_000);
  if (mailLimit) return mailLimit.status === 429 ? NextResponse.json(GENERIC_RESPONSE) : mailLimit;

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
    await sendMail({ to: user.email, subject, html, text, meta: { kind: "PASSWORD_RESET", userId: user.id } });
  }

  return NextResponse.json(GENERIC_RESPONSE);
}
