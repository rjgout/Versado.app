import { canResumeGameContent } from "@/lib/gameAvailability";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { submitChapterGuessAnswer } from "@/lib/chapterGuess";
import { notifyNewAchievements } from "@/lib/notify";
import { apiError } from "@/lib/apiError";

const schema = z.object({ chapterId: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ gameId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!(await canResumeGameContent("content_bom"))) return apiError("gameAvailability.unavailable", 403);

  const { gameId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const result = await submitChapterGuessAnswer(gameId, user.id, parsed.data.chapterId);
  if ("error" in result) return NextResponse.json(result, { status: 400 });

  if (result.summary) notifyNewAchievements(user.id, result.summary.newAchievements).catch(() => {});

  return NextResponse.json(result);
}
