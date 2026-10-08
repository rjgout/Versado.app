import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { recordOnboardingIntro } from "@/lib/kompas/store";

// Wordt zowel aangeroepen bij "overslaan" als bij het volledig doorlopen van
// de laatste stap — in beide gevallen mag de flow nooit meer automatisch
// starten (zie de !user.onboardingSeenAt-redirect in dashboard/page.tsx).
// Handmatig herstarten kan alsnog via de knop op de profielpagina, die
// simpelweg naar /onboarding linkt zonder deze route aan te roepen.
//
// De body is optioneel: { kompasSeen } meldt of de kennismaking met Versado
// (Leren, Spelen, de contentkiezer) getoond is, zodat Kompas die uitleg daarna
// niet nogmaals automatisch aanbiedt. Zonder body gedraagt de route zich als voorheen.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const body: unknown = await req.json().catch(() => null);
  const kompasSeen = body && typeof body === "object" && typeof (body as { kompasSeen?: unknown }).kompasSeen === "boolean"
    ? (body as { kompasSeen: boolean }).kompasSeen
    : null;

  await prisma.user.update({ where: { id: user.id }, data: { onboardingSeenAt: new Date() } });
  if (kompasSeen !== null) await recordOnboardingIntro(user.id, kompasSeen);

  return NextResponse.json({ ok: true });
}
