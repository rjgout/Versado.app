import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resetPasswordWithToken } from "@/lib/authTokens";
import { disconnectUserSockets } from "@/lib/realtime";
import { createSessionToken, createTwoFactorChallengeToken, hashPassword, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { apiError, apiErrorText } from "@/lib/apiError";
import { authBudget, authBudgetKey } from "@/lib/authBudget";
import { clientIp } from "@/lib/rateLimit";
import { boundedJson } from "@/lib/requestBody";

const schema = z.object({
  token: z.string().min(1).max(128),
  newPassword: z.string().min(8, "Wachtwoord moet minstens 8 tekens zijn.").max(256),
});

export async function POST(req: NextRequest) {
  const limited = await authBudget(authBudgetKey("reset-ip", clientIp(req)), 30, 15 * 60_000);
  if (limited) return limited;
  const body = await boundedJson(req);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return await apiErrorText(parsed.error.issues[0].message, 400);
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  const user = await resetPasswordWithToken(parsed.data.token, passwordHash);
  if (!user) {
    return await apiError("apiErrors.linkInvalid", 400);
  }

  const userId = user.id;
  disconnectUserSockets(userId);

  // Een wachtwoordreset mag 2FA niet omzeilen. Als het account TOTP gebruikt,
  // is het nieuwe wachtwoord wel opgeslagen, maar volgt eerst dezelfde
  // tweede stap als bij een normale login.
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
