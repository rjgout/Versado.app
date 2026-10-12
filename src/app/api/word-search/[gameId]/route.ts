import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getWordSearch } from "@/lib/wordSearch/game";

export async function GET(_: Request, { params }: { params: Promise<{ gameId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const game = await getWordSearch(user.id, (await params).gameId);
  if (!game) return await apiError("apiErrors.itemNotFound", 404);
  return NextResponse.json(game);
}
