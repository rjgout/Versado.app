import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getQuickMissionaryLeaderboard } from "@/lib/snelleZendeling/runs";
import { getQuickMissionaryDuoLeaderboard } from "@/lib/snelleZendeling/duoLeaderboard";
import { parseLeaderboardQuery } from "@/lib/snelleZendeling/leaderboardQuery";

// Ondersteund: solo + today, solo + all-time, duo + all-time. Duo heeft geen
// Vandaag (twee spelers, mogelijk twee tijdzones): die combinatie is een 400.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const query = parseLeaderboardQuery(req.nextUrl.searchParams.get("type"), req.nextUrl.searchParams.get("board"));
  if (!query.ok) return await apiError("apiErrors.invalidInput", 400);
  if (query.kind === "duo") return NextResponse.json({ board: query.board, type: "duo", entries: await getQuickMissionaryDuoLeaderboard(user.id) });
  return NextResponse.json({ board: query.board, entries: await getQuickMissionaryLeaderboard(user.id, query.board) });
}
