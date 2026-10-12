import { canResumeGameContent } from "@/lib/gameAvailability";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { forfeitChapterGuessGame } from "@/lib/chapterGuess";
import { apiError } from "@/lib/apiError";

export async function POST(_req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!(await canResumeGameContent("content_bom"))) return apiError("gameAvailability.unavailable", 403);

  const { gameId } = await params;
  const result = await forfeitChapterGuessGame(gameId, user.id);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
