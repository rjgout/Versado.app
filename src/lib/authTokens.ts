import { createHash, randomBytes } from "crypto";
import type { AuthTokenType, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 uur
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 uur

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function ttlFor(type: AuthTokenType): number {
  return type === "EMAIL_VERIFY" ? EMAIL_VERIFY_TTL_MS : PASSWORD_RESET_TTL_MS;
}

/** Maakt een nieuw token aan en geeft de RUWE waarde terug — die komt alleen in de e-maillink, nooit in de database. */
export async function createAuthToken(userId: string, type: AuthTokenType): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await prisma.authToken.create({
    data: {
      userId,
      type,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + ttlFor(type)),
    },
  });
  return raw;
}

/** Verbruikt een token (eenmalig, mits nog geldig) en geeft de bijbehorende userId terug, of null. */
export async function consumeAuthToken(raw: string, type: AuthTokenType, db: Prisma.TransactionClient = prisma): Promise<string | null> {
  const tokenHash = hashToken(raw);
  const consumed = await db.authToken.updateMany({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) return null;
  return (await db.authToken.findUnique({ where: { tokenHash }, select: { userId: true } }))?.userId ?? null;
}

/** User eerst vergrendelen: ook twee verschillende resetlinks mogen elkaar niet inhalen. */
export async function resetPasswordWithToken(raw: string, passwordHash: string) {
  const candidate = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(raw) }, select: { userId: true, type: true } });
  if (!candidate || candidate.type !== "PASSWORD_RESET") return null;
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${candidate.userId} FOR UPDATE`;
    const userId = await consumeAuthToken(raw, "PASSWORD_RESET", tx);
    if (!userId) return null;
    const user = await tx.user.update({
      where: { id: userId },
      data: { passwordHash, passwordLoginEnabled: true, mustChangePassword: false, sessionVersion: { increment: 1 } },
      select: { id: true, totpEnabled: true },
    });
    await tx.authToken.updateMany({ where: { userId, type: "PASSWORD_RESET", usedAt: null }, data: { usedAt: new Date() } });
    return user;
  });
}
