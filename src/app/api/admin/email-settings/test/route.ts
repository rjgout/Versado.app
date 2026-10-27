import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { sendTestMail } from "@/lib/email";
import { apiError } from "@/lib/apiError";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);

  const result = await sendTestMail(user.email, user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  return NextResponse.json({ ok: true });
}
