import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { chapterGuessHint } from "@/lib/chapterGuess";
import { apiError } from "@/lib/apiError";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ gameId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { gameId } = await params;
  const result = await chapterGuessHint(gameId, user.id);
  if ("error" in result) return NextResponse.json(result, { status: 400 });
  return NextResponse.json(result);
}
