import { gameStartGuard } from "@/lib/gameStartGuard";
import { prisma } from "@/lib/db";
import { dayKey } from "@/lib/dates";
import { canResumeGameContent } from "@/lib/gameAvailability";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getSoloOverview, startSoloRun } from "@/lib/alleskenner/solo";
import { apiError, apiErrorText } from "@/lib/apiError";

// De Slimste Heilige alleen spelen: overzicht met klassementen, en een nieuw potje
// beginnen. Het spel zelf loopt via de socketserver (ak:solo_join).
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  return NextResponse.json(await getSoloOverview(user.id));
}

const startSchema = z.object({ mode: z.enum(["DAILY", "PRACTICE"]) }).strict();

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = startSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  if (parsed.data.mode === "DAILY") {
    const run = await prisma.alleskennerSoloRun.findFirst({ where: { userId: user.id, dayKey: dayKey(), status: "IN_PROGRESS" }, select: { id: true } });
    if (run && await canResumeGameContent("content_bom")) return NextResponse.json({ runId: run.id });
  }
  const denied = await gameStartGuard(req, user.id, "alleskenner");
  if (denied) return denied;

  const result = await startSoloRun(user.id, parsed.data.mode);
  if ("error" in result) return await apiErrorText(result.error, 409);
  return NextResponse.json(result);
}
