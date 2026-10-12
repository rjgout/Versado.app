import { canResumeGameContent } from "@/lib/gameAvailability";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { submitGuess } from "@/lib/wordGame";
import { notifyNewAchievements } from "@/lib/notify";
import { apiError } from "@/lib/apiError";

const schema = z.object({ guess: z.string().trim().min(1) });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!(await canResumeGameContent("content_bom"))) return apiError("gameAvailability.unavailable", 403);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const result = await submitGuess(user.id, parsed.data.guess, user.timeZone);
  if ("error" in result) return NextResponse.json(result, { status: 400 });

  notifyNewAchievements(user.id, result.newAchievements).catch(() => {});

  return NextResponse.json(result);
}
