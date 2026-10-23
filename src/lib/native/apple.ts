import { randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { prisma } from "@/lib/db";
import { resolveEditionId, BOFM_WORK } from "@/lib/contentCollections";
import type { LanguageCode } from "@/lib/languages";
import { createAccount } from "@/lib/registration";
import { hashPassword } from "@/lib/auth";
import { disconnectUserSockets } from "@/lib/realtime";
import { hashSecret, matchesHash, lockNativeUser, NativeAuthError } from "./sessions";
import { nativeSecondFactor, assertNativeAccount } from "./password";
import type { User } from "@/generated/prisma/client";

const appleKeys = createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys"), { timeoutDuration: 5000, cooldownDuration: 30_000 });
export function appleConfiguration() {
  const scope = process.env.APPLE_TEAM_ID, audience = process.env.APPLE_IOS_CLIENT_ID;
  if (process.env.APPLE_SIGN_IN_ENABLED !== "1" || !scope || !/^[A-Z0-9]{10}$/.test(scope) || !audience || !/^[A-Za-z0-9.-]{3,128}$/.test(audience)) return null;
  return { scope, audience };
}
/** Injecteer alleen in tests een lokale JWKS-verifier; nooit een client-URL. */
export async function verifyAppleIdentity(token: string, nonceHash: string, audience: string, keys: JWTVerifyGetKey = appleKeys) {
  const { payload } = await jwtVerify(token, keys, { algorithms: ["RS256"], issuer: "https://appleid.apple.com", audience, requiredClaims: ["sub", "exp", "iat", "nonce"], maxTokenAge: "10m", clockTolerance: 5 });
  if (typeof payload.sub !== "string" || payload.sub.length < 1 || payload.sub.length > 255 || payload.nonce !== nonceHash || typeof payload.iat !== "number" || payload.iat > Date.now() / 1000 + 5) throw new NativeAuthError("apple_token_invalid");
  const verified = payload.email_verified === true || payload.email_verified === "true";
  return { subject: payload.sub, email: verified && typeof payload.email === "string" ? payload.email : null };
}
export async function createAppleChallenge(intent: "signin" | "link", userId?: string) {
  if (!appleConfiguration()) throw new NativeAuthError("apple_not_configured", 503);
  if ((intent === "link") !== !!userId) throw new NativeAuthError("invalid_input", 400);
  const nonce = hashSecret(randomBytes(32).toString("base64url")), state = randomBytes(32).toString("base64url");
  const challenge = await prisma.nativeAuthChallenge.create({ data: { intent, userId, nonceHash: nonce, stateHash: hashSecret(state), expiresAt: new Date(Date.now() + 300_000) } });
  return { id: challenge.id, nonce, state };
}
export async function finishAppleChallenge(input: { uiLanguage?: LanguageCode; challengeId: string; state: string; identityToken: string; handle?: string; displayName?: string; code?: string }, owner?: User, keys?: JWTVerifyGetKey, securitySetup = false) {
  const config = appleConfiguration();
  if (!config) throw new NativeAuthError("apple_not_configured", 503);
  const challenge = await prisma.nativeAuthChallenge.findUnique({ where: { id: input.challengeId } });
  if (!challenge || !["signin", "link"].includes(challenge.intent) || challenge.consumedAt || challenge.expiresAt <= new Date() || !matchesHash(input.state, challenge.stateHash) || (challenge.intent === "link" && challenge.userId !== owner?.id)) throw new NativeAuthError("apple_challenge_expired");
  if ((challenge.intent === "link") !== !!owner) throw new NativeAuthError("apple_challenge_expired");
  let identity;
  try { identity = await verifyAppleIdentity(input.identityToken, challenge.nonceHash, config.audience, keys); }
  catch { throw new NativeAuthError("apple_token_invalid"); }
  // Atomisch eenmalig claimen; een fout vergt een nieuwe toestemming/challenge.
  const claimed = await prisma.nativeAuthChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
  if (claimed.count !== 1) throw new NativeAuthError("apple_challenge_expired");
  const where = { provider_scope_subject: { provider: "APPLE" as const, scope: config.scope, subject: identity.subject } };
  if (challenge.intent === "link") {
    if (!owner) throw new NativeAuthError("session_expired");
    return prisma.$transaction(async tx => {
      await lockNativeUser(tx, owner.id);
      const current = await tx.user.findUnique({ where: { id: owner.id } });
      if (!current || current.sessionVersion !== owner.sessionVersion) throw new NativeAuthError("session_changed");
      const existing = await tx.externalIdentity.findUnique({ where });
      if (existing) {
        if (existing.userId !== owner.id) throw new NativeAuthError("apple_already_linked", 409);
        return current;
      }
      await tx.externalIdentity.create({ data: { userId: owner.id, provider: "APPLE", scope: config.scope, subject: identity.subject, displayName: input.displayName } });
      return current;
    });
  }
  let linked = await prisma.externalIdentity.findUnique({ where, include: { user: true } });
  if (!linked) {
    const { z } = await import("zod");
    if (!identity.email || !z.email().safeParse(identity.email).success) throw new NativeAuthError("apple_email_required", 409);
    const emailOwner = await prisma.user.findUnique({ where: { email: identity.email.toLowerCase() } });
    if (emailOwner) {
      linked = await prisma.externalIdentity.findUnique({ where, include: { user: true } });
      if (!linked || linked.userId !== emailOwner.id) throw new NativeAuthError("sign_in_then_link_apple", 409);
    }
    if (!(await prisma.user.count())) throw new NativeAuthError("web_security_setup_required", 403);
    const language = input.uiLanguage ?? "nl", editionId = await resolveEditionId(BOFM_WORK, language);
    const edition = editionId ? await prisma.contentCollection.findUnique({ where: { id: editionId }, select: { language: true } }) : null;
    if (!linked) try {
      await createAccount({ email: identity.email.toLowerCase(), handle: input.handle ?? "Versado", passwordHash: await hashPassword(randomBytes(48).toString("base64url")), uiLanguage: language, contentLanguage: edition?.language ?? "nl", emailVerifiedAt: new Date(), externalIdentity: { scope: config.scope, subject: identity.subject, displayName: input.displayName } });
    } catch {
      // De samengestelde unieke identiteit rolt een gelijktijdige tweede User-create
      // volledig terug. Alleen de aantoonbaar dezelfde subject opnieuw ophalen.
      if (!(await prisma.externalIdentity.findUnique({ where }))) throw new NativeAuthError("apple_account_conflict", 409);
    }
    linked = await prisma.externalIdentity.findUnique({ where, include: { user: true } });
  }
  if (!linked) throw new NativeAuthError("apple_account_conflict", 409);
  // De expliciete setup-entry controleert hierna e-mail en bestaande TOTP,
  // en geeft uitsluitend een doelgebonden challenge of een normale sessie.
  if (securitySetup && !owner) return linked.user;
  await assertNativeAccount(linked.user);
  await nativeSecondFactor(linked.user, input.code);
  return linked.user;
}
export async function unlinkApple(user: User) {
  await prisma.$transaction(async tx => {
    await lockNativeUser(tx, user.id);
    const current = await tx.user.findUnique({ where: { id: user.id } });
    if (!current || current.sessionVersion !== user.sessionVersion) throw new NativeAuthError("session_changed");
    if (!current.passwordLoginEnabled || !current.emailVerifiedAt) throw new NativeAuthError("alternative_login_required", 409);
    await tx.externalIdentity.deleteMany({ where: { userId: user.id, provider: "APPLE" } });
    // Ook eerder via Apple uitgegeven sessies intrekken, geen voortgang wijzigen.
    await tx.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
  });
  disconnectUserSockets(user.id);
}
