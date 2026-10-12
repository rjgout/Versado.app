import { canResumeGameContent } from "@/lib/gameAvailability";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getChapterGuessGameView } from "@/lib/chapterGuess";
import { apiError } from "@/lib/apiError";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ gameId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!(await canResumeGameContent("content_bom"))) return apiError("gameAvailability.unavailable", 403);

  const { gameId } = await params;
  const view = await getChapterGuessGameView(gameId, user.id);
  if ("error" in view) return NextResponse.json(view, { status: 404 });
  return NextResponse.json(view);
}
