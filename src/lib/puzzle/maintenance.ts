import { prisma } from "@/lib/db";
import { settleExpiredMatches } from "@/lib/puzzle/match";

// Onderhoud voor gezamenlijk puzzelen. Het draait op elke instance, maar alles is
// idempotent en rij-vergrendeld, dus twee instances die tegelijk lopen schaden niet.
// Een vergeten lock blokkeert een groep sowieso nooit langer dan zijn lease (locks
// worden bij het pakken lui opgeruimd); dit ruimt de rest op.
export async function runPuzzleMaintenance(now: Date = new Date()) {
  const matches = await settleExpiredMatches(now);
  const invites = await prisma.puzzleInvite.updateMany({ where: { status: "PENDING", expiresAt: { lte: now } }, data: { status: "EXPIRED", respondedAt: now } });
  const locks = await prisma.puzzleLock.deleteMany({ where: { expiresAt: { lte: new Date(now.getTime() - 60_000) } } });
  return { matches, invites: invites.count, locks: locks.count };
}
