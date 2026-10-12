import { prisma } from "@/lib/db";
import { canStartGame, canResumeGameContent } from "@/lib/gameAvailability";
import { wordGameDayKey } from "@/lib/wordGame";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getOrCreateTodayGame } from "@/lib/wordGame";
import { apiError } from "@/lib/apiError";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const existing = await prisma.wordGame.findUnique({ where: { userId_dayKey: { userId: user.id, dayKey: wordGameDayKey(new Date(), user.timeZone ?? undefined) } }, select: { id: true } });
  if (existing ? !(await canResumeGameContent("content_bom")) : !(await canStartGame(user.id, "word-game"))) return apiError("gameAvailability.unavailable", 403);
  const view = await getOrCreateTodayGame(user.id, user.timeZone);
  return NextResponse.json(view);
}
