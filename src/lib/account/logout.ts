import { prisma } from "@/lib/db";
import { activeNativeSession, NativeAuthError, type NativeSessionBinding } from "@/lib/native/sessions";
import { disconnectUserSockets } from "@/lib/realtime";

/** De bestaande webbetekenis van Overal uitloggen: één nieuwe sessieversie
 * maakt zowel web-JWT's als native access-/refreshsessies ongeldig.
 * De actor komt uitsluitend uit serverauth, nooit uit het verzoekbody. */
export async function logoutAccount(actor: { id: string; sessionVersion: number }, binding?: NativeSessionBinding) {
  if (binding && (binding.userId !== actor.id || binding.sessionVersion !== actor.sessionVersion)) throw new NativeAuthError("session_expired");
  const changed = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${actor.id} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: actor.id }, select: { sessionVersion: true } });
    if (!user || user.sessionVersion !== actor.sessionVersion) {
      if (binding) throw new NativeAuthError("session_expired");
      return false;
    }
    let expiresAt: Date | undefined;
    if (binding) {
      await tx.$queryRaw`SELECT "id" FROM "NativeSession" WHERE "id" = ${binding.sessionId}::uuid FOR UPDATE`;
      await activeNativeSession(binding, tx);
      expiresAt = (await tx.nativeSession.findUniqueOrThrow({ where: { id: binding.sessionId }, select: { expiresAt: true } })).expiresAt;
    }
    const result = await tx.user.updateMany({ where: { id: actor.id, sessionVersion: actor.sessionVersion }, data: { sessionVersion: { increment: 1 } } });
    // Deze terminale mutatie trekt haar eigen sessie bewust in. Controleer
    // daarom vervaltijd, niet opnieuw de zojuist verhoogde sessieversie.
    if (expiresAt && expiresAt <= new Date()) throw new NativeAuthError("session_expired");
    return result.count === 1;
  }, { maxWait: 2000, timeout: 5000 });
  if (changed) disconnectUserSockets(actor.id);
  return changed;
}
