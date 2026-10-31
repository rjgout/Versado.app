import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { activeNativeSession, NativeAuthError, type NativeSessionBinding } from "@/lib/native/sessions";

/** Alleen door serverauthenticatie geconstrueerd, nooit uit requestvelden. */
export type AccountActor = { userId: string; nativeSession?: NativeSessionBinding };
/** Korte persoonlijke/sociale commit. Alle User-rijen lexicografisch → NativeSession
 * → domeinrijen. Geen netwerkwerk. Native revocation en commit krijgen één volgorde;
 * de tweede controle bewaakt ook klokverloop tijdens lockwachten/domeinwerk.
 */
export async function commitAccountMutation<T>(actor: AccountActor, otherUsers: string[], run: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
    for (const id of [...new Set([actor.userId, ...otherUsers])].sort()) {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
      if (!rows.length) throw new NativeAuthError("session_expired");
    }
    if (actor.nativeSession) {
      if (actor.nativeSession.userId !== actor.userId) throw new NativeAuthError("session_expired");
      await tx.$queryRaw`SELECT "id" FROM "NativeSession" WHERE "id" = ${actor.nativeSession.sessionId}::uuid FOR UPDATE`;
      await activeNativeSession(actor.nativeSession, tx);
    }
    const result = await run(tx);
    if (actor.nativeSession) await activeNativeSession(actor.nativeSession, tx);
    return result;
  }, { maxWait: 2000, timeout: 5000 });
}
