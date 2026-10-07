import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getQuickMissionaryLeaderboard } from "@/lib/snelleZendeling/runs";
import { getQuickMissionaryDuoLeaderboard } from "@/lib/snelleZendeling/duoLeaderboard";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const board = z.enum(["today", "all-time"]).catch("today").parse(req.nextUrl.searchParams.get("board"));
  // Duo: de laatste twee van een gezamenlijke run, apart van de solo-ranking.
  if (req.nextUrl.searchParams.get("type") === "duo") return NextResponse.json({ board, type: "duo", entries: await getQuickMissionaryDuoLeaderboard(user.id, board) });
  return NextResponse.json({ board, entries: await getQuickMissionaryLeaderboard(user.id, board) });
}
