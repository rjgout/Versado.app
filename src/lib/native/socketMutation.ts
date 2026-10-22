import type { Socket } from "socket.io";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { activeNativeSession, NativeAuthError, type NativeSessionBinding } from "./sessions";
import { nativeSocketEnabled, socketSecurityState } from "./socketAuth";

/** Alleen voor korte databasecommits, zonder netwerk/contentwerk of geheugenmutaties.
 * User → NativeSession is dezelfde rijlockvolgorde als logout/refresh-replay.
 * Intrekking en deze commit krijgen daarmee een definitieve databasevolgorde.
 * De terugkeerwaarde mag daarna synchroon in de tijdelijke spelcache verschijnen.
 * Dit beschermt uitsluitend callsites die deze grens expliciet gebruiken.
 */
export async function commitSocketMutation<T>(socket: Socket, run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const binding = socket.data.nativeSession as NativeSessionBinding | undefined;
  if (!binding) return run(prisma); // Bestaande webauthenticatie blijft ongewijzigd.
  const securityState = socket.data.nativeSecurityState as string;
  try {
    return await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${binding.userId} FOR UPDATE`;
      const sessions = await tx.$queryRaw<{ expiresAt: Date }[]>`SELECT "id", "expiresAt" FROM "NativeSession" WHERE "id" = ${binding.sessionId}::uuid FOR UPDATE`;
      const user = await activeNativeSession(binding, tx);
      if (!nativeSocketEnabled() || !socket.connected || socketSecurityState(user) !== securityState) throw new NativeAuthError("session_expired");
      const result = await run(tx);
      // Rijlocks stoppen revocation, niet de klok. Ook verloop tijdens run
      // moet de domeinwrites vóór commit terugrollen.
      if (!socket.connected || !sessions[0] || sessions[0].expiresAt <= new Date() || !nativeSocketEnabled()) throw new NativeAuthError("session_expired");
      return result;
    }, { maxWait: 2000, timeout: 4000 });
  } catch (error) {
    socket.disconnect(true);
    throw error;
  }
}
