import { createHash, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

export class NativeAuthError extends Error {
  constructor(public code: string, public status = 401) { super(code); }
}
export const hashSecret = (raw: string) => createHash("sha256").update(raw).digest("hex");
export function matchesHash(raw: string, hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash) && timingSafeEqual(Buffer.from(hashSecret(raw), "hex"), Buffer.from(hash, "hex"));
}
function key(label: string): Uint8Array {
  const secret = process.env.NATIVE_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new NativeAuthError("native_not_configured", 503);
  return new Uint8Array(hkdfSync("sha256", secret, "versado-native-v1", label, 32));
}
export type NativeTokens = { accessToken: string; refreshToken: string; expiresIn: number };
async function tokens(session: { id: string; userId: string; sessionVersion: number }, refreshToken: string): Promise<NativeTokens> {
  const accessToken = await new SignJWT({ userId: session.userId, sid: session.id, version: session.sessionVersion, purpose: "native-access" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer("versado-native-v1").setAudience("versado-native-v1")
    .setIssuedAt().setExpirationTime("5m").sign(key("access"));
  return { accessToken, refreshToken, expiresIn: 300 };
}
export async function issueNativeSession(userId: string, expectedVersion: number): Promise<NativeTokens> {
  key("access");
  const id = randomUUID(), raw = `${id}.${randomBytes(32).toString("base64url")}`;
  const session = await prisma.$transaction(async tx => {
    await lockNativeUser(tx, userId);
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || user.sessionVersion !== expectedVersion) throw new NativeAuthError("session_changed");
    if (user.mustChangePassword || (user.isAdmin && !user.totpEnabled)) throw new NativeAuthError("web_security_setup_required", 403);
    return tx.nativeSession.create({ data: { id, userId, sessionVersion: user.sessionVersion, refreshHash: hashSecret(raw), expiresAt: new Date(Date.now() + 30 * 86400_000) } });
  });
  return tokens(session, raw);
}
export async function lockNativeUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
}
const refreshFormat = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[A-Za-z0-9_-]{43}$/;
export async function rotateNativeSession(raw: string, actionId: string, revoke = false): Promise<NativeTokens | null> {
  if (!refreshFormat.test(raw)) throw new NativeAuthError("session_expired");
  const id = raw.split(".")[0];
  const found = await prisma.nativeSession.findUnique({ where: { id }, select: { userId: true } });
  if (!found) throw new NativeAuthError("session_expired");
  // Vaste volgorde: User → NativeSession. Een replaybesluit moet committen;
  // pas buiten de transactie de fout teruggeven, anders draait revocation terug.
  const result = await prisma.$transaction(async tx => {
    await lockNativeUser(tx, found.userId);
    await tx.$queryRaw`SELECT "id" FROM "NativeSession" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const session = await tx.nativeSession.findUnique({ where: { id } });
    const user = await tx.user.findUnique({ where: { id: found.userId }, select: { sessionVersion: true, mustChangePassword: true, isAdmin: true, totpEnabled: true } });
    if (!session || !user) return { error: "session_expired" } as const;
    const current = matchesHash(raw, session.refreshHash);
    const previous = !!session.previousRefreshHash && matchesHash(raw, session.previousRefreshHash);
    if (!current && !previous) return { error: "session_expired" } as const;
    if (revoke) {
      await tx.nativeSession.update({ where: { id }, data: { revokedAt: session.revokedAt ?? new Date() } });
      return { revoked: true } as const;
    }
    if (session.revokedAt || session.expiresAt <= new Date() || session.sessionVersion !== user.sessionVersion || user.mustChangePassword || (user.isAdmin && !user.totpEnabled)) return { error: "session_expired" } as const;
    if (previous && session.lastActionId !== actionId) {
      await tx.nativeSession.update({ where: { id }, data: { revokedAt: new Date() } });
      return { error: "refresh_replayed" } as const;
    }
    const next = `${id}.${createHmac("sha256", key("refresh-retry")).update(raw).update("\0").update(actionId).digest("base64url")}`;
    if (previous) {
      if (!matchesHash(next, session.refreshHash)) return { error: "session_expired" } as const;
      return { session, raw: next } as const;
    }
    if (session.lastActionId === actionId) return { error: "action_reused" } as const;
    const updated = await tx.nativeSession.update({ where: { id }, data: { previousRefreshHash: session.refreshHash, refreshHash: hashSecret(next), lastActionId: actionId } });
    return { session: updated, raw: next } as const;
  });
  if ("error" in result) throw new NativeAuthError(result.error ?? "session_expired");
  if ("revoked" in result) return null;
  return tokens(result.session, result.raw);
}
export async function nativeUser(accessToken: string) {
  try {
    const { payload } = await jwtVerify(accessToken, key("access"), { algorithms: ["HS256"], issuer: "versado-native-v1", audience: "versado-native-v1" });
    if (payload.purpose !== "native-access" || typeof payload.sid !== "string" || typeof payload.userId !== "string" || typeof payload.version !== "number") throw new Error();
    const session = await prisma.nativeSession.findUnique({ where: { id: payload.sid }, include: { user: true } });
    if (!session || session.userId !== payload.userId || session.revokedAt || session.expiresAt <= new Date() || session.sessionVersion !== payload.version || session.user.sessionVersion !== payload.version) throw new Error();
    if (session.user.mustChangePassword || (session.user.isAdmin && !session.user.totpEnabled)) throw new Error();
    return session.user;
  } catch { throw new NativeAuthError("session_expired"); }
}
