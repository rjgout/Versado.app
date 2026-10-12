import { gameStartGuard } from "@/lib/gameStartGuard";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { startQuickMissionaryRun } from "@/lib/snelleZendeling/runs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const denied = await gameStartGuard(req, user.id, "quick-missionary");
  if (denied) return denied;
  try { return NextResponse.json(await startQuickMissionaryRun(user.id)); }
  catch { return await apiError("gameAvailability.unavailable", 403); }
}
