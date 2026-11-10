import { prisma } from "./db";
import type { Prisma } from "@/generated/prisma/client";
import { announceAccountDeparture, leaveAllGroupsInTransaction } from "./social/groups";
import { disconnectUserSockets } from "./realtime";

export class AccountDeletionConflict extends Error {
  constructor() { super("session_changed"); }
}

type DeletionOptions = {
  expectedSessionVersion?: number;
  authorize?: (tx: Prisma.TransactionClient) => Promise<void>;
  beforeCommit?: (tx: Prisma.TransactionClient) => Promise<void>;
};

/** Eén commitgrens voor herauthenticatie, groepsopvolging en accountwissen.
 * Beheer en opschoning behouden hetzelfde pad zonder zelfwisvoorwaarden.
 * Bij elke fout rollen ook groepsmutaties en herstelcodeverbruik terug. */
export async function deleteUserAccount(userId: string, options: DeletionOptions = {}): Promise<void> {
  const promotions = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
    // Serialiseert zelfverwijderingen van beheerders vóór hun User-locks:
    // twee gelijktijdige laatste beheerders mogen niet beiden verdwijnen.
    if (options.authorize) await tx.$executeRaw`SELECT pg_advisory_xact_lock(187202, 4)`;
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { email: true, sessionVersion: true } });
    if (!user) {
      if (options.authorize) throw new AccountDeletionConflict();
      return [];
    }
    if (options.expectedSessionVersion !== undefined && user.sessionVersion !== options.expectedSessionVersion) throw new AccountDeletionConflict();
    await options.authorize?.(tx);
    const promotions = await leaveAllGroupsInTransaction(tx, userId);
    await tx.pendingRegistration.deleteMany({ where: { email: user.email } });
    await tx.user.delete({ where: { id: userId } });
    await options.beforeCommit?.(tx);
    return promotions;
  }, { maxWait: 5000, timeout: 15000 });
  disconnectUserSockets(userId);
  // Een notificatiefout verandert een reeds gecommitte verwijdering nooit in
  // een schijnbare fout; de normale meldingen blijven best effort.
  await announceAccountDeparture(promotions).catch(error => console.error("Groepsopvolging melden mislukt", error));
}
