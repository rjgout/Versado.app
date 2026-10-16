// Server-side beschikbaarheid; gescheiden van de lokale audio-/herkenningsengine.
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { hymnsPocAccess, type PocAccess } from "@/lib/hymns/access";

export function hymnsTechnicallyAvailable() {
  return process.env.HYMNS_POC !== "0";
}

/** Actor uitsluitend uit serverauthenticatie. Geen cache van rechten of loginstatus. */
export async function getHymnsAccess(
  actor: { isAdmin: boolean } | null,
  db: Pick<Prisma.TransactionClient, "contentSwitcherSettings"> = prisma,
  knownSettings?: { hymnsVisibleToUsers: boolean },
): Promise<PocAccess> {
  const base = { flag: process.env.HYMNS_POC, loggedIn: Boolean(actor), isAdmin: Boolean(actor?.isAdmin) };
  if (!hymnsTechnicallyAvailable() || !actor || actor.isAdmin)
    return hymnsPocAccess({ ...base, visibleToUsers: false });
  const settings = knownSettings ?? await db.contentSwitcherSettings.findUnique({
    where: { id: "singleton" }, select: { hymnsVisibleToUsers: true },
  });
  return hymnsPocAccess({ ...base, visibleToUsers: settings?.hymnsVisibleToUsers === true });
}
