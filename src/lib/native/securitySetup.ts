import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { authBudget, authBudgetKey } from "@/lib/authBudget";
import { formatTag } from "@/lib/handle";
import { disconnectUserSockets } from "@/lib/realtime";
import { createOtpauthUri, decryptTotpSecret, encryptTotpSecret, generateRecoveryCodes, generateTotpSecret, hashRecoveryCodes, verifyTotpCode } from "@/lib/totp";
import type { User } from "@/generated/prisma/client";
import { hashSecret, issueNativeSession, lockNativeUser, matchesHash, NativeAuthError } from "./sessions";
import { assertNativeEmail, nativeSecondFactor } from "./password";
import { nativeSetupFinishSchema } from "./contract";

type Step = "password" | "totp";
export function nativeSecurityStep(user: Pick<User, "mustChangePassword" | "isAdmin" | "totpEnabled">): Step | null {
  return user.mustChangePassword ? "password" : user.isAdmin && !user.totpEnabled ? "totp" : null;
}
async function setupBudget(userId: string) {
  const limited = await authBudget(authBudgetKey("native-security-setup", userId), 10, 15 * 60_000);
  if (limited) throw new NativeAuthError(limited.status === 503 ? "security_check_unavailable" : "too_many_attempts", limited.status);
}
async function createSetup(user: User, step: Step) {
  const raw = randomBytes(32).toString("base64url"), secret = step === "totp" ? generateTotpSecret() : null;
  const challenge = await prisma.$transaction(async tx => {
    await lockNativeUser(tx, user.id);
    const current = await tx.user.findUnique({ where: { id: user.id } });
    if (!current || current.sessionVersion !== user.sessionVersion || nativeSecurityStep(current) !== step) throw new NativeAuthError("session_changed");
    // Eén actuele setup per account; parallelle nieuwe logins vervangen oude
    // setupbewijzen, maar nooit Apple-challenges of bestaande gebruikersdata.
    await tx.nativeAuthChallenge.deleteMany({ where: { userId: user.id, intent: { in: ["password", "totp"] } } });
    return tx.nativeAuthChallenge.create({ data: {
      userId: user.id, intent: step, sessionVersion: user.sessionVersion,
      nonceHash: hashSecret(randomBytes(32).toString("base64url")), stateHash: hashSecret(raw),
      expiresAt: new Date(Date.now() + 300_000), totpSecretEncrypted: secret ? encryptTotpSecret(secret) : null,
    } });
  });
  return { securitySetup: { token: `${challenge.id}.${raw}`, step, expiresAt: challenge.expiresAt.toISOString(), ...(secret ? { secret, otpauthUri: createOtpauthUri(secret, formatTag(user.handle, user.discriminator)) } : {}) } };
}
/** Alleen na geverifieerd wachtwoord of Apple-identiteit aanroepen. Een
 * bestaande tweede factor blijft verplicht vóór een setup-challenge.
 */
export async function nativeSignInResult(user: User, code?: string) {
  await assertNativeEmail(user);
  if (user.totpEnabled) await nativeSecondFactor(user, code);
  const step = nativeSecurityStep(user);
  if (!step) return issueNativeSession(user.id, user.sessionVersion);
  await setupBudget(user.id);
  return createSetup(user, step);
}
const format = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.[A-Za-z0-9_-]{43}$/;
export async function cancelNativeSecuritySetup(token: string) {
  if (!format.test(token)) return;
  const [id, raw] = token.split(".");
  await prisma.nativeAuthChallenge.deleteMany({ where: { id, stateHash: hashSecret(raw), intent: { in: ["password", "totp"] } } });
}
export async function finishNativeSecuritySetup(input: { challengeToken: string; newPassword?: string; code?: string }) {
  input = nativeSetupFinishSchema.parse(input);
  if (!format.test(input.challengeToken)) throw new NativeAuthError("setup_expired");
  const [id, raw] = input.challengeToken.split(".");
  const found = await prisma.nativeAuthChallenge.findUnique({ where: { id } });
  if (!found?.userId || !["password", "totp"].includes(found.intent) || found.consumedAt || found.expiresAt <= new Date() || !matchesHash(raw, found.stateHash)) throw new NativeAuthError("setup_expired");
  await setupBudget(found.userId);
  if (found.intent === "password" ? !input.newPassword || input.code !== undefined : !input.code || input.newPassword !== undefined) throw new NativeAuthError("invalid_input", 400);
  const passwordHash = input.newPassword ? await hashPassword(input.newPassword) : null;
  const result = await prisma.$transaction(async tx => {
    await lockNativeUser(tx, found.userId!);
    await tx.$queryRaw`SELECT "id" FROM "NativeAuthChallenge" WHERE "id" = ${id}::uuid FOR UPDATE`;
    const challenge = await tx.nativeAuthChallenge.findUnique({ where: { id } });
    const user = await tx.user.findUnique({ where: { id: found.userId! } });
    if (!user || !challenge || challenge.userId !== user.id || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.sessionVersion !== user.sessionVersion || nativeSecurityStep(user) !== challenge.intent || !matchesHash(raw, challenge.stateHash)) throw new NativeAuthError("setup_expired");
    await assertNativeEmail(user);
    let recoveryCodes: string[] | undefined;
    if (challenge.intent === "totp") {
      if (!challenge.totpSecretEncrypted || !verifyTotpCode(decryptTotpSecret(challenge.totpSecretEncrypted), input.code!)) throw new NativeAuthError("wrong_code", 400);
      recoveryCodes = generateRecoveryCodes();
    }
    const updated = await tx.user.update({ where: { id: user.id }, data: {
      sessionVersion: { increment: 1 },
      ...(passwordHash ? { passwordHash, passwordLoginEnabled: true, mustChangePassword: false } : {
        totpEnabled: true, totpSecretEncrypted: challenge.totpSecretEncrypted, totpRecoveryCodes: await hashRecoveryCodes(recoveryCodes!),
      }),
    } });
    await tx.nativeAuthChallenge.update({ where: { id }, data: { consumedAt: new Date(), totpSecretEncrypted: null } });
    return { user: updated, recoveryCodes };
  });
  disconnectUserSockets(result.user.id);
  const next = nativeSecurityStep(result.user);
  if (next) return createSetup(result.user, next);
  return { ...await issueNativeSession(result.user.id, result.user.sessionVersion), ...(result.recoveryCodes ? { recoveryCodes: result.recoveryCodes } : {}) };
}
