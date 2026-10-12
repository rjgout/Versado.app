import { gameStartGuard } from "@/lib/gameStartGuard";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { createAlleskennerGame } from "@/lib/alleskenner/game";
import { apiError } from "@/lib/apiError";

// Maakt een lobby voor De Slimste Heilige (zie docs/ALLESKENNER.md). De maker is
// host en standaard quizmaster; spelers en toeschouwers melden zich in de
// lobby zelf aan via de socketserver (src/server/alleskenner.ts).
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const denied = await gameStartGuard(req, user.id, "alleskenner");
  if (denied) return denied;


  const game = await createAlleskennerGame(user.id);
  return NextResponse.json({ code: game.code });
}
