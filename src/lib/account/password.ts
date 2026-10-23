import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { disconnectUserSockets } from "@/lib/realtime";

export class AccountPasswordError extends Error {
  constructor(readonly code: "wrong_password" | "session_changed") { super(code); }
}

/** Eén wachtwoord-/sessieprocedure voor web en native. Controleer de actuele
 * versie onder dezelfde User-lock als native refresh; een oud verzoek mag
 * geen nieuwe accountbeveiliging overschrijven.
 */
export async function changeAccountPassword(actor: { id: string; sessionVersion: number }, currentPassword: string, newPassword: string) {
  const passwordHash = await hashPassword(newPassword);
  const result = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: actor.id } });
    if (!user || user.sessionVersion !== actor.sessionVersion) throw new AccountPasswordError("session_changed");
    if (!user.passwordLoginEnabled || !await verifyPassword(currentPassword, user.passwordHash)) throw new AccountPasswordError("wrong_password");
    return tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } }, select: { id: true, sessionVersion: true } });
  });
  disconnectUserSockets(actor.id);
  return result;
}
