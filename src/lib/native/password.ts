import { prisma } from "@/lib/db";
import { randomBytes } from "node:crypto";
import { verifyPassword, hashPassword } from "@/lib/auth";
import { parseTag } from "@/lib/handle";
import { isEmailConfigured } from "@/lib/email";
import { decryptTotpSecret, verifyTotpCode, consumeRecoveryCode, twoFactorFailureKey, TWO_FACTOR_MAX_FAILURES, TWO_FACTOR_WINDOW_MS } from "@/lib/totp";
import { failureLockSeconds, registerFailure, clearFailures } from "@/lib/rateLimit";
import { NativeAuthError } from "./sessions";
import type { User } from "@/generated/prisma/client";

export async function nativeSecondFactor(user: User, code?: string) {
  if (!user.totpEnabled) {
    if (user.isAdmin) throw new NativeAuthError("web_security_setup_required", 403);
    return;
  }
  if (!code) throw new NativeAuthError("two_factor_required");
  const failureKey = twoFactorFailureKey(user.id);
  if (failureLockSeconds(failureKey, TWO_FACTOR_MAX_FAILURES)) throw new NativeAuthError("too_many_attempts", 429);
  const valid = !!user.totpSecretEncrypted && verifyTotpCode(decryptTotpSecret(user.totpSecretEncrypted), code);
  if (!valid) {
    const remaining = await consumeRecoveryCode(user.totpRecoveryCodes, code);
    if (!remaining || !(await prisma.user.updateMany({ where: { id: user.id, totpRecoveryCodes: user.totpRecoveryCodes }, data: { totpRecoveryCodes: remaining } })).count) {
      registerFailure(failureKey, TWO_FACTOR_WINDOW_MS); throw new NativeAuthError("wrong_credentials");
    }
  }
  clearFailures(failureKey);
}
export async function assertNativeAccount(user: User) {
  if (user.mustChangePassword) throw new NativeAuthError("web_security_setup_required", 403);
  if (!user.emailVerifiedAt && await isEmailConfigured()) throw new NativeAuthError("email_confirmation_required", 403);
}
let dummyHash: Promise<string> | undefined;
export async function nativePasswordLogin(identifier: string, password: string, code?: string, expectedUserId?: string) {
  const tag = parseTag(identifier);
  const user = tag ? await prisma.user.findFirst({ where: { handle: { equals: tag.handle, mode: "insensitive" }, discriminator: tag.discriminator } })
    : await prisma.user.findUnique({ where: { email: identifier.toLowerCase() } });
  const hash = user?.passwordHash ?? await (dummyHash ??= hashPassword(randomBytes(32).toString("hex")));
  const valid = await verifyPassword(password, hash);
  if (!user || (expectedUserId && user.id !== expectedUserId) || !user.passwordLoginEnabled || !valid) throw new NativeAuthError("wrong_credentials");
  await assertNativeAccount(user);
  await nativeSecondFactor(user, code);
  return user;
}
