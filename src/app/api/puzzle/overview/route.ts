import { NextResponse } from "next/server";
import { listCoopOverview } from "@/lib/puzzle/coop";
import { listMatchOverview } from "@/lib/puzzle/match";
import { hasFinishedPuzzles, listRecentFinishedForHub } from "@/lib/puzzle/history";
import { puzzleRouteUser } from "@/lib/puzzle/routeGuard";

// Eén overzicht voor de Legpuzzel-hub: uitnodigingen, lopende gezamenlijke puzzels en wedstrijden, plus de drie laatst afgeronde
// (zie history.ts; de volledige lijst staat achter /api/puzzle/history).
export async function GET() {
  const guard = await puzzleRouteUser(); if ("response" in guard) return guard.response;
  const { user } = guard;
  const [coop, matches, recent, hasHistory] = await Promise.all([listCoopOverview(user.id), listMatchOverview(user.id), listRecentFinishedForHub(user.id), hasFinishedPuzzles(user.id)]);
  return NextResponse.json({
    meId: user.id,
    invites: coop.invites.map((item) => ({ id: item.id, sessionId: item.sessionId, from: item.from.handle, pieceCount: item.session?.variant.pieceCount ?? 0 })),
    sent: coop.sent.map((item) => ({ id: item.id, sessionId: item.sessionId, to: item.to.handle, toId: item.toUserId })),
    sessions: coop.sessions.filter((item) => item.status === "ACTIVE").map((item) => ({ id: item.id, status: item.status, pieceCount: item.variant.pieceCount, players: item.participants.map((p) => p.user.handle), max: 4 })),
    matches: matches.filter((row) => row.match.status !== "FINISHED").map((row) => ({
      id: row.match.id, kind: row.match.kind, status: row.match.status, me: row.status, resultRules: row.match.resultRules, questionOpen: row.match.resultRules >= 2 && row.status === "FINISHED" && row.answeredAt === null, organizer: row.match.organizer.handle, organizerId: row.match.organizer.id,
      pieceCount: row.match.variant.pieceCount, players: row.match.participants.filter((p) => p.status !== "DECLINED").map((p) => p.user.handle),
    })),
    finished: recent.items,
    hasHistory,
  });
}
