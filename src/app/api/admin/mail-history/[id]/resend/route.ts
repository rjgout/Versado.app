import { requestSecurityError } from "@/lib/requestSecurity";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { resendMail, MailResendError } from "@/lib/mailResend";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejected = requestSecurityError(_request.method, new URL(_request.url).pathname, _request.headers);
  if (rejected) return apiError("apiErrors.forbidden", rejected);
  const user = await getCurrentUser();
  if (!user) return apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return apiError("apiErrors.forbidden", 403);
  const { id } = await params;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return apiError("mailLog.unavailable", 404);
  try { await resendMail(id, user.id); return NextResponse.json({ ok: true }); }
  catch (error) {
    if (error instanceof MailResendError) return apiError(`mailLog.${error.reason}`, error.reason === "cooldown" ? 429 : error.reason === "unavailable" ? 409 : error.reason === "preferences" ? 409 : 502);
    return apiError("mailLog.failed", 500);
  }
}
