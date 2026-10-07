import { prisma } from "@/lib/db";
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
 * De Duo-ranking (alleen All-time) uit de reeds vastgelegde ruwe duo-resultaten;
 * de score wordt hier afgeleid (max van beide scores), er is geen redundante
 * opslag. Er is bewust geen "Vandaag": een duo bestaat uit twee mensen met
 * mogelijk verschillende tijdzones, dus er bestaat geen gezamenlijke lokale dag,
 * en tijdzones hebben hier geen enkele invloed. De uitslag komt alleen uit
 * server-side afgesloten wedstrijden.
 */
export async function getQuickMissionaryDuoLeaderboard(viewerId: string): Promise<QuickMissionaryDuoEntry[]> {
  const rows = await prisma.quickMissionaryDuoResult.findMany({
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
