import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError, apiErrorText } from "@/lib/apiError";

const schema = z.object({ shareAchievements: z.boolean() });

/**
 * Slaat de ene privacykeuze uit de onboarding op in de bestaande
 * shareAchievements-instelling. De datum is alleen nodig om een onderbroken
 * nieuwe onboarding niet opnieuw dezelfde vraag te laten stellen.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiErrorText("Ongeldige privacykeuze.", 400);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      shareAchievements: parsed.data.shareAchievements,
      onboardingProfilePrivacyAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}
