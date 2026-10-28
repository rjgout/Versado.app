import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getEmailSettingsView, saveEmailSettings } from "@/lib/email";
import { apiError } from "@/lib/apiError";

const schema = z.object({
  enabled: z.boolean(),
  trackOpens: z.boolean().optional(),
  smtpHost: z.string().trim(),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  smtpUsername: z.string().trim(),
  smtpPassword: z.string().optional(),
  fromEmail: z.string().trim().email("Vul een geldig afzender-e-mailadres in.").or(z.literal("")),
  fromName: z.string().trim(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);

  return NextResponse.json(await getEmailSettingsView());
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  await saveEmailSettings({
    ...parsed.data,
    smtpPassword: parsed.data.smtpPassword?.trim() ? parsed.data.smtpPassword : undefined,
  });

  return NextResponse.json({ ok: true });
}
