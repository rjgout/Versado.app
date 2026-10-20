import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { consumeAuthToken } from "@/lib/authTokens";
import { createSessionToken, createTwoFactorChallengeToken, hashPassword, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { apiError, apiErrorText } from "@/lib/apiError";

const schema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Wachtwoord moet minstens 8 tekens zijn."),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return await apiErrorText(parsed.error.issues[0].message, 400);
  }

  const userId = await consumeAuthToken(parsed.data.token, "PASSWORD_RESET");
  if (!userId) {
    return await apiError("apiErrors.linkInvalid", 400);
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, passwordLoginEnabled: true, mustChangePassword: false, sessionVersion: { increment: 1 } },
  });

  // Een wachtwoordreset mag 2FA niet omzeilen. Als het account TOTP gebruikt,
  // is het nieuwe wachtwoord wel opgeslagen, maar volgt eerst dezelfde
  // tweede stap als bij een normale login.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { totpEnabled: true } });
  if (user?.totpEnabled) {
    const challengeToken = await createTwoFactorChallengeToken(userId);
    return NextResponse.json({ ok: true, requiresTwoFactor: true, challengeToken });
  }

  // Meteen inloggen na een geslaagde reset, dat scheelt een stap.
  const token = await createSessionToken(userId);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
