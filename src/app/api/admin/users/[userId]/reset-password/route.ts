import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { hashPassword } from "@/lib/auth";
import { createAuthToken } from "@/lib/authTokens";
import { isEmailConfigured, sendMail } from "@/lib/email";
import { adminPasswordResetTemplate } from "@/lib/emailTemplates";
import { getT } from "@/lib/i18n";
import { getBaseUrl } from "@/lib/baseUrl";
import { apiError } from "@/lib/apiError";
import { disconnectUserSockets } from "@/lib/realtime";

// Leesbaar tijdelijk wachtwoord — alleen nog als noodgreep wanneer er geen
// e-mail geconfigureerd staat (zie hieronder). Met werkende e-mail (het
// normale geval) wordt dit nooit meer gegenereerd of getoond.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generateTempPassword(length = 12): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

// Een admin kan het wachtwoord van een gebruiker resetten (bv. na een
// supportverzoek). Dat maakt het huidige wachtwoord altijd meteen ongeldig.
// Is er e-mail geconfigureerd, dan gebeurt de rest net als bij de
// zelfbedieningsflow ("wachtwoord vergeten"): de gebruiker krijgt een e-mail
// met een resetlink (1 uur geldig) om zelf een nieuw wachtwoord te kiezen —
// een admin ziet of deelt dus geen wachtwoord meer. Zonder e-mailconfiguratie
// (self-hosted zonder SMTP) is er geen manier om die link te bezorgen; dan
// valt dit terug op het oude tijdelijke-wachtwoord-mechanisme dat de admin
// zelf moet doorgeven.
export async function POST(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const admin = await getCurrentUser();
  if (!admin) return await apiError("apiErrors.notLoggedIn", 401);
  if (!admin.isAdmin) return await apiError("apiErrors.forbidden", 403);

  const { userId } = await params;
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return await apiError("apiErrors.userNotFound", 404);

  if (await isEmailConfigured()) {
    const rawToken = await createAuthToken(userId, "PASSWORD_RESET");
    const link = `${getBaseUrl(req)}/reset-password?token=${rawToken}`;
    const { subject, html, text } = adminPasswordResetTemplate(getT(target.uiLanguage), link);
    const result = await sendMail({ to: target.email, subject, html, text, meta: { kind: "PASSWORD_RESET", userId: target.id, actorId: admin.id } });
    if (!result.ok) {
      return NextResponse.json({ error: result.error ?? "Kon de reset-e-mail niet versturen." }, { status: 502 });
    }

    // Pas het oude wachtwoord ongeldig maken nadat de e-mail écht is
    // verstuurd: was sendMail hierboven mislukt, dan kan de gebruiker
    // gewoon met zijn huidige wachtwoord blijven inloggen in plaats van
    // buitengesloten te raken zonder werkende link.
    const unusableHash = await hashPassword(randomBytes(32).toString("hex"));
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: unusableHash, mustChangePassword: true, sessionVersion: { increment: 1 } } });
    disconnectUserSockets(userId);

    return NextResponse.json({ emailed: true, email: target.email });
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash, passwordLoginEnabled: true, mustChangePassword: true, sessionVersion: { increment: 1 } } });
  disconnectUserSockets(userId);

  return NextResponse.json({ tempPassword });
}
