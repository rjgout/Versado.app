import { gameStartGuard } from "@/lib/gameStartGuard";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { createQuickMissionaryLobby } from "@/lib/snelleZendeling/lobby";

// Maakt een lobby voor Samen spelen met Vliegende {gids}: een LiveGame (mode
// QUICK_MISSIONARY) met de maker als host. Uitnodigen en starten gaan daarna via
// de socketserver (src/server/quickMissionary.ts); de run zelf pas bij de start.
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const denied = await gameStartGuard(req, user.id, "quick-missionary");
  if (denied) return denied;
  try { return NextResponse.json(await createQuickMissionaryLobby(user.id)); }
  catch { return await apiError("gameAvailability.unavailable", 403); }
}
