import { prisma } from "@/lib/db";
import { dayKeyInZone, resolveTimeZone } from "@/lib/timeZone";
import { rankDuos } from "./duoRanking";

const TOP_SIZE = 50;

export interface QuickMissionaryDuoEntry {
  rank: number;
  key: string;
  score: number;
  finishedAt: string;
  /** De viewer zit zelf in dit duo. */
  mine: boolean;
  players: [DuoPlayer, DuoPlayer];
}

export interface DuoPlayer {
  userId: string;
  handle: string;
  discriminator: string;
}

/**
 * De Duo-ranking uit de reeds vastgelegde ruwe duo-resultaten; de score wordt
 * hier afgeleid (max van beide scores), er is geen redundante opslag. Een duo is
 * van twee mensen met mogelijk verschillende tijdzones: "Vandaag" gebruikt de
 * vaste, gedeelde dagGrens waarmee het resultaat is vastgelegd (zie docs/TIJD.md).
 * De uitslag komt alleen uit server-side afgesloten wedstrijden.
 */
export async function getQuickMissionaryDuoLeaderboard(viewerId: string, board: "today" | "all-time", at: Date = new Date()): Promise<QuickMissionaryDuoEntry[]> {
  const dayKey = dayKeyInZone(at, resolveTimeZone(null));
  const rows = await prisma.quickMissionaryDuoResult.findMany({
    where: board === "today" ? { dayKey } : {},
    select: { matchId: true, userAId: true, userBId: true, scoreA: true, scoreB: true, finishedAt: true },
  });
  const ranked = rankDuos(rows);
  const visible = ranked.slice(0, TOP_SIZE);
  const mineOutside = ranked.find((duo) => (duo.userAId === viewerId || duo.userBId === viewerId) && !visible.includes(duo));
  if (mineOutside) visible.push(mineOutside);
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(visible.flatMap((duo) => [duo.userAId, duo.userBId]))] } },
    select: { id: true, handle: true, discriminator: true },
  });
  const byId = new Map(users.map((user) => [user.id, { userId: user.id, handle: user.handle, discriminator: user.discriminator }]));
  return visible.flatMap((duo) => {
    const a = byId.get(duo.userAId);
    const b = byId.get(duo.userBId);
    if (!a || !b) return [];
    return [{ rank: ranked.indexOf(duo) + 1, key: duo.key, score: duo.score, finishedAt: duo.finishedAt.toISOString(), mine: duo.userAId === viewerId || duo.userBId === viewerId, players: [a, b] as [DuoPlayer, DuoPlayer] }];
  });
}
