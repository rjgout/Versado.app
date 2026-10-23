import { prisma } from "./db";
import { leaveAllGroups } from "./social/groups";
import { disconnectUserSockets } from "./realtime";

/** De sessie of beveiliging van het account veranderde na de herauthenticatie; er is niets verwijderd. */
export class AccountDeletionConflict extends Error {
  constructor() { super("session_changed"); }
}

/** Dezelfde wisprocedure voor zelf wissen, beheer en periodieke opschoning.
 * `expectedSessionVersion` is optioneel: bij zelf wissen na herauthenticatie wordt
 * de verwijdering alleen uitgevoerd als de sessieversie nog gelijk is aan die waarmee
 * het bewijs is geleverd, zodat een verouderd verzoek nooit een ander moment of een
 * ander account kan raken. Beheer en opschoning geven geen versie op. */
export async function deleteUserAccount(userId: string, options: { expectedSessionVersion?: number } = {}): Promise<void> {
  const { expectedSessionVersion } = options;
  if (expectedSessionVersion !== undefined) {
    // Vóór het verlaten van groepen controleren: een mislukte verwijdering mag geen bijwerkingen hebben.
    const current = await prisma.user.findUnique({ where: { id: userId }, select: { sessionVersion: true } });
    if (!current) return;
    if (current.sessionVersion !== expectedSessionVersion) throw new AccountDeletionConflict();
  }
  await leaveAllGroups(userId);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, sessionVersion: true } });
    if (!user) return;
    if (expectedSessionVersion !== undefined && user.sessionVersion !== expectedSessionVersion) throw new AccountDeletionConflict();
    await tx.pendingRegistration.deleteMany({ where: { email: user.email } });
    await tx.user.delete({ where: { id: userId } });
  });
  disconnectUserSockets(userId);
}
