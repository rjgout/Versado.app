import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { createAuthToken } from "@/lib/authTokens";
import { isEmailConfigured, sendMail } from "@/lib/email";
import { verifyEmailTemplate } from "@/lib/emailTemplates";
import { getT } from "@/lib/i18n";
import { getBaseUrl } from "@/lib/baseUrl";
import { apiError, apiErrorText } from "@/lib/apiError";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (user.emailVerifiedAt) return NextResponse.json({ ok: true });

  if (!(await isEmailConfigured())) {
    return await apiError("apiErrors.emailNotConfigured", 503);
  }

  const rawToken = await createAuthToken(user.id, "EMAIL_VERIFY");
  const link = `${getBaseUrl(req)}/verify-email?token=${rawToken}`;
  const { subject, html, text } = verifyEmailTemplate(getT(user.uiLanguage), link);
  const result = await sendMail({ to: user.email, subject, html, text, meta: { kind: "EMAIL_VERIFY", userId: user.id } });
  if (!result.ok) return await apiErrorText(result.error, 502);

  return NextResponse.json({ ok: true });
}
