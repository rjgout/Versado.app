import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { scrabbleHint } from "@/lib/scrabbleGame";
import { apiError, apiErrorText } from "@/lib/apiError";

export async function POST(_req: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { gameId } = await params;
  const result = await scrabbleHint(gameId, user.id);
  if (!result.ok) return await apiErrorText(result.error, 400);
  return NextResponse.json({ word: result.word, usedIndices: result.usedIndices, hintBalance: result.hintBalance });
}
