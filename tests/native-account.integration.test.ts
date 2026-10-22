import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { prisma } from "../src/lib/db";
import { createSessionToken, hashPassword, verifyPassword, verifySessionToken } from "../src/lib/auth";
import { generateTotpCode, encryptTotpSecret, generateTotpSecret } from "../src/lib/totp";
import { issueNativeSession, nativeUser, rotateNativeSession } from "../src/lib/native/sessions";
import { nativeSetupSchema } from "../src/lib/native/contract";
import { finishNativeSecuritySetup, nativeSignInResult } from "../src/lib/native/securitySetup";
import { createAppleChallenge, finishAppleChallenge } from "../src/lib/native/apple";
import { startPendingRegistration } from "../src/lib/registration";
import { createAuthToken } from "../src/lib/authTokens";
import { changeAccountPassword } from "../src/lib/account/password";

const database = new URL(process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || database.href !== process.env.DATABASE_URL) throw Error("Alleen eigen geïsoleerde database");
const base = process.env.NATIVE_TEST_BASE_URL!, password = "Synthetic-account-42", nextPassword = "Synthetic-account-43", passwordHash = await hashPassword(password);
async function account(extra: Record<string, unknown> = {}) { return prisma.user.create({ data: { email: `native-account-${randomUUID()}@example.invalid`, handle: `Account${randomUUID().slice(0, 10)}`, discriminator: "01", passwordHash, emailVerifiedAt: new Date(), onboardingSeenAt: new Date(), ...extra } }); }
async function call(path: string, body?: unknown, token?: string) {
  const response = await fetch(`${base}/api/v1/native/${path}`, { method: body === undefined ? "GET" : "POST", headers: { Origin: "capacitor://localhost", "X-Versado-Client": "native-v1", "x-real-ip": "127.0.0.27", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { response, data: await response.json() };
}
async function enter(email: string, code?: string) { return call("login", { identifier: email, password, supportsSecuritySetup: true, ...(code ? { code } : {}) }); }
after(async () => {
  await prisma.$disconnect();
  const shared = globalThis as typeof globalThis & { __versadoAuthBudget?: Promise<{ disconnect(): void }> };
  await shared.__versadoAuthBudget?.then(client => client.disconnect()).catch(() => {});
});

test("verplichte wachtwoordsetup geeft geen gewone sessie, wijzigt één keer en trekt oude sessies in", async () => {
  const user = await account({ xpTotal: 27, currentStreak: 3 }), old = await issueNativeSession(user.id, 0), web = await createSessionToken(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
  await assert.rejects(nativeUser(old.accessToken)); await assert.rejects(rotateNativeSession(old.refreshToken, randomUUID()));
  assert.equal((await call("login", { identifier: user.email, password })).response.status, 403, "Oudere clients krijgen geen bypass");
  const start = await enter(user.email), setup = nativeSetupSchema.parse(start.data).securitySetup;
  assert.equal(setup.step, "password"); assert.equal((await call("me", undefined, setup.token)).response.status, 401);
  await assert.rejects(rotateNativeSession(setup.token, randomUUID())); await assert.rejects(issueNativeSession(user.id, 0));
  const done = await call("security-setup/complete", { challengeToken: setup.token, newPassword: nextPassword });
  assert.equal(done.response.status, 200); assert.equal((await nativeUser(done.data.accessToken)).id, user.id);
  assert.equal((await call("security-setup/complete", { challengeToken: setup.token, newPassword: nextPassword })).response.status, 401);
  assert.equal((await call("login", { identifier: user.email, password })).response.status, 401);
  assert.equal((await call("login", { identifier: user.email, password: nextPassword })).response.status, 200);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(after.sessionVersion, 1); assert.equal(after.mustChangePassword, false); assert.equal(after.xpTotal, 27); assert.equal(after.currentStreak, 3);
  await assert.rejects(nativeUser(old.accessToken)); assert.equal(await verifySessionToken(web), null);
});

test("setup is gebonden aan doel, eigenaarversie, geheim, vervaltijd en eenmalige claim", async () => {
  const user = await account({ mustChangePassword: true });
  const first = nativeSetupSchema.parse((await enter(user.email)).data).securitySetup;
  const second = nativeSetupSchema.parse((await enter(user.email)).data).securitySetup;
  assert.equal((await call("security-setup/complete", { challengeToken: first.token, newPassword: nextPassword })).response.status, 401, "Nieuwe login vervangt oud setupbewijs");
  assert.equal((await call("security-setup/complete", { challengeToken: second.token, newPassword: nextPassword, userId: "other" })).response.status, 400);
  const wrong = `${second.token.split('.')[0]}.${'X'.repeat(43)}`;
  await call("security-setup/cancel", { challengeToken: wrong });
  assert.ok(await prisma.nativeAuthChallenge.findUnique({ where: { id: second.token.split('.')[0] } }), "Alleen id kennen kan niets intrekken");
  await prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
  assert.equal((await call("security-setup/complete", { challengeToken: second.token, newPassword: nextPassword })).response.status, 401);
  const expired = nativeSetupSchema.parse((await enter(user.email)).data).securitySetup;
  await prisma.nativeAuthChallenge.update({ where: { id: expired.token.split('.')[0] }, data: { expiresAt: new Date(0) } });
  assert.equal((await call("security-setup/complete", { challengeToken: expired.token, newPassword: nextPassword })).response.status, 401);
  const valid = nativeSetupSchema.parse((await enter(user.email)).data).securitySetup;
  const [a, b] = await Promise.all([call("security-setup/complete", { challengeToken: valid.token, newPassword: nextPassword }), call("security-setup/complete", { challengeToken: valid.token, newPassword: nextPassword })]);
  assert.deepEqual([a.response.status, b.response.status].sort(), [200, 401]);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion, 2);
});

test("beheerder rondt eerst wachtwoord en echte TOTP af; herstelcodes zijn eenmalig", async () => {
  const user = await account({ mustChangePassword: true, isAdmin: true });
  const start = nativeSetupSchema.parse((await enter(user.email)).data).securitySetup;
  const passwordStep = await call("security-setup/complete", { challengeToken: start.token, newPassword: nextPassword });
  const setup = nativeSetupSchema.parse(passwordStep.data).securitySetup; assert.equal(setup.step, "totp"); assert.ok(setup.secret);
  assert.equal(await prisma.nativeSession.count({ where: { userId: user.id } }), 0);
  assert.notEqual((await prisma.nativeAuthChallenge.findUniqueOrThrow({ where: { id: setup.token.split('.')[0] } })).totpSecretEncrypted, setup.secret);
  assert.equal((await call("security-setup/complete", { challengeToken: setup.token, code: "not-a-code" })).response.status, 400);
  const done = await call("security-setup/complete", { challengeToken: setup.token, code: generateTotpCode(setup.secret!) });
  assert.equal(done.response.status, 200); assert.equal(done.data.recoveryCodes.length, 8); assert.equal((await nativeUser(done.data.accessToken)).id, user.id);
  assert.equal((await call("login", { identifier: user.email, password: nextPassword })).response.status, 401);
  assert.equal((await call("login", { identifier: user.email, password: nextPassword, code: done.data.recoveryCodes[0] })).response.status, 200);
  assert.equal((await call("login", { identifier: user.email, password: nextPassword, code: done.data.recoveryCodes[0] })).response.status, 401);
  const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(stored.totpEnabled, true); assert.equal(stored.sessionVersion, 2); assert.equal(stored.totpRecoveryCodes!.includes(done.data.recoveryCodes[0]), false);
});

test("bestaande TOTP blijft verplicht vóór een wachtwoordchallenge en annulering is idempotent", async () => {
  const secret = generateTotpSecret(), user = await account({ mustChangePassword: true, totpEnabled: true, totpSecretEncrypted: encryptTotpSecret(secret) });
  assert.equal((await enter(user.email)).response.status, 401); assert.equal(await prisma.nativeAuthChallenge.count({ where: { userId: user.id } }), 0);
  const setup = nativeSetupSchema.parse((await enter(user.email, generateTotpCode(secret))).data).securitySetup;
  assert.equal((await call("security-setup/cancel", { challengeToken: setup.token })).response.status, 200);
  assert.equal((await call("security-setup/cancel", { challengeToken: setup.token })).response.status, 200);
  assert.equal((await call("security-setup/complete", { challengeToken: setup.token, newPassword: nextPassword })).response.status, 401);
});

test("Apple-only beheerder krijgt na geverifieerde Apple-login dezelfde begrensde TOTP-setup", async () => {
  const user = await account({ isAdmin: true, passwordLoginEnabled: false }), subject = randomUUID();
  await prisma.externalIdentity.create({ data: { userId: user.id, provider: "APPLE", scope: "TESTTEAM01", subject } });
  const { publicKey, privateKey } = await generateKeyPair("RS256"), jwk = await exportJWK(publicKey); jwk.kid = "setup-test";
  const keys = createLocalJWKSet({ keys: [jwk] }), apple = await createAppleChallenge("signin");
  const identityToken = await new SignJWT({ sub: subject, nonce: apple.nonce }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer("https://appleid.apple.com").setAudience("app.versado.synthetic").setIssuedAt().setExpirationTime("5m").sign(privateKey);
  const verified = await finishAppleChallenge({ challengeId: apple.id, state: apple.state, identityToken }, undefined, keys, true);
  const setup = nativeSetupSchema.parse(await nativeSignInResult(verified)).securitySetup; assert.equal(setup.step, "totp");
  const row = await prisma.nativeAuthChallenge.findUniqueOrThrow({ where: { id: setup.token.split('.')[0] } });
  await assert.rejects(finishAppleChallenge({ challengeId: row.id, state: setup.token.split('.')[1], identityToken }, undefined, keys, true), /apple_challenge_expired/);
  const completed = await finishNativeSecuritySetup({ challengeToken: setup.token, code: generateTotpCode(setup.secret!) });
  assert.ok('accessToken' in completed); assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).passwordLoginEnabled, false);
});

test("native wachtwoordactie herauthenticeert met TOTP, behoudt voortgang en logt alle sessies uit", async () => {
  const secret = generateTotpSecret(), user = await account({ xpTotal: 41, currentStreak: 4, totpEnabled: true, totpSecretEncrypted: encryptTotpSecret(secret) });
  const pair = await issueNativeSession(user.id, 0), web = await createSessionToken(user.id);
  assert.equal((await call("account/password", { currentPassword: password, newPassword: nextPassword, userId: "other" }, pair.accessToken)).response.status, 400);
  assert.equal((await call("account/password", { currentPassword: password, newPassword: nextPassword }, pair.accessToken)).response.status, 401);
  const changed = await call("account/password", { currentPassword: password, newPassword: nextPassword, code: generateTotpCode(secret) }, pair.accessToken);
  assert.equal(changed.response.status, 200); assert.equal(changed.data.reauthenticationRequired, true);
  await assert.rejects(nativeUser(pair.accessToken)); await assert.rejects(rotateNativeSession(pair.refreshToken, randomUUID())); assert.equal(await verifySessionToken(web), null);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } }); assert.equal(after.xpTotal, 41); assert.equal(after.currentStreak, 4); assert.equal(after.sessionVersion, 1);
  assert.equal((await call("login", { identifier: user.email, password: nextPassword, code: generateTotpCode(secret) })).response.status, 200);
});

test("web behoudt zijn wachtwoordflow; gelijktijdige beveiligingswijziging overschrijft geen nieuwere versie", async () => {
  const user = await account(), token = await createSessionToken(user.id);
  const response = await fetch(`${base}/api/account`, { method: "PUT", headers: { Origin: base, Cookie: `bvm_session=${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: password, newPassword: nextPassword }) });
  assert.equal(response.status, 200); assert.ok(response.headers.get('set-cookie')?.includes('bvm_session=')); assert.equal(await verifySessionToken(token), null);
  const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const outcomes = await Promise.allSettled([changeAccountPassword(current, nextPassword, "Synthetic-parallel-A"), changeAccountPassword(current, nextPassword, "Synthetic-parallel-B")]);
  assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } }); assert.equal(after.sessionVersion, 2); assert.equal(await verifyPassword(nextPassword, after.passwordHash), false);
});

test("native reset verbruikt het bestaande mailbewijs eenmaal, trekt sessies in en omzeilt TOTP niet", async () => {
  const secret = generateTotpSecret(), user = await account({ xpTotal: 43, currentStreak: 5, totpEnabled: true, totpSecretEncrypted: encryptTotpSecret(secret) });
  const old = await issueNativeSession(user.id, 0), web = await createSessionToken(user.id);
  const first = await createAuthToken(user.id, "PASSWORD_RESET"), second = await createAuthToken(user.id, "PASSWORD_RESET");
  const done = await call("reset-password", { token: first, newPassword: nextPassword });
  assert.equal(done.response.status, 200); assert.deepEqual(done.data, { ok: true, reauthenticationRequired: true });
  assert.equal(done.response.headers.get("set-cookie"), null); assert.equal(done.response.headers.get("cache-control"), "private, no-store");
  await assert.rejects(nativeUser(old.accessToken)); await assert.rejects(rotateNativeSession(old.refreshToken, randomUUID())); assert.equal(await verifySessionToken(web), null);
  assert.equal((await call("reset-password", { token: first, newPassword: "Replayed-password-42" })).response.status, 400);
  assert.equal((await call("reset-password", { token: second, newPassword: "Second-password-42" })).response.status, 400);
  assert.equal((await call("login", { identifier: user.email, password: nextPassword })).response.status, 401);
  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(after.sessionVersion, 1); assert.equal(after.xpTotal, 43); assert.equal(after.currentStreak, 5); assert.equal(after.totpEnabled, true);
  assert.equal(await prisma.nativeSession.count({ where: { userId: user.id } }), 1, "Reset geeft geen NativeSession uit");
  assert.equal((await call("login", { identifier: user.email, password: nextPassword, code: generateTotpCode(secret) })).response.status, 200);
});

test("native reset accepteert geen verkeerd doel, verlopen bewijs of clientgekozen eigenaar; parallel slechts één winnaar", async () => {
  const user = await account(), other = await account();
  const verification = await createAuthToken(user.id, "EMAIL_VERIFY"), expired = await createAuthToken(user.id, "PASSWORD_RESET");
  await prisma.authToken.updateMany({ where: { userId: user.id, type: "PASSWORD_RESET" }, data: { expiresAt: new Date(0) } });
  for (const token of [verification, expired, "invalid-token"]) assert.equal((await call("reset-password", { token, newPassword: nextPassword })).response.status, 400);
  const first = await createAuthToken(user.id, "PASSWORD_RESET"), second = await createAuthToken(user.id, "PASSWORD_RESET");
  assert.equal((await call("reset-password", { token: first, newPassword: nextPassword, userId: other.id })).response.status, 400);
  const outcomes = await Promise.all([call("reset-password", { token: first, newPassword: nextPassword }), call("reset-password", { token: second, newPassword: "Other-password-42" })]);
  assert.deepEqual(outcomes.map(row => row.response.status).sort(), [200, 400]);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionVersion, 1);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).passwordHash, passwordHash);
});

test("native e-mailbevestiging maakt hetzelfde account precies eenmaal zonder cookie of sessie", async () => {
  const email = `native-verify-${randomUUID()}@example.invalid`;
  const token = await startPendingRegistration({ email, handle: "Bevestigd", passwordHash, uiLanguage: "nl", contentLanguage: "nl", returnTo: "/adminbackend" }, base); assert.ok(token);
  assert.equal((await call("login", { identifier: email, password: "Wrong-password-42" })).response.status, 401);
  const pendingLogin = await call("login", { identifier: email, password }); assert.equal(pendingLogin.response.status, 403); assert.equal(pendingLogin.data.error, "email_confirmation_required");
  assert.equal(await prisma.user.count({ where: { email } }), 0);
  assert.equal((await call("verify-email", { token, userId: "other" })).response.status, 400);
  const outcomes = await Promise.all([call("verify-email", { token }), call("verify-email", { token })]);
  assert.deepEqual(outcomes.map(row => row.data.status).sort(), ["already", "confirmed"]);
  for (const result of outcomes) { assert.deepEqual(Object.keys(result.data), ["status"]); assert.equal(result.response.headers.get("set-cookie"), null); }
  const user = await prisma.user.findUniqueOrThrow({ where: { email } }); assert.ok(user.emailVerifiedAt);
  assert.equal(await prisma.nativeSession.count({ where: { userId: user.id } }), 0); assert.equal(user.xpTotal, 0);
  assert.equal((await call("verify-email", { token })).data.status, "already");
  assert.equal((await call("login", { identifier: email, password })).response.status, 200);
});

test("oude e-maillinks bevestigen atomair; ander doel en verlopen links bevestigen niemand", async () => {
  const user = await account({ emailVerifiedAt: null }), other = await account({ emailVerifiedAt: null });
  const token = await createAuthToken(user.id, "EMAIL_VERIFY"), reset = await createAuthToken(other.id, "PASSWORD_RESET");
  const outcomes = await Promise.all([call("verify-email", { token }), call("verify-email", { token })]);
  assert.deepEqual(outcomes.map(row => row.data.status).sort(), ["confirmed", "invalid"]);
  assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt);
  assert.equal((await call("verify-email", { token: reset })).data.status, "invalid");
  const expired = await createAuthToken(other.id, "EMAIL_VERIFY");
  await prisma.authToken.updateMany({ where: { userId: other.id, type: "EMAIL_VERIFY" }, data: { expiresAt: new Date(0) } });
  assert.equal((await call("verify-email", { token: expired })).data.status, "invalid");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).emailVerifiedAt, null);
  const email = `native-verify-expired-${randomUUID()}@example.invalid`, pending = await startPendingRegistration({ email, handle: "Verlopen", passwordHash, uiLanguage: "nl", contentLanguage: "nl" }, base);assert.ok(pending);
  await prisma.pendingRegistration.update({ where: { email }, data: { expiresAt: new Date(0) } });
  assert.equal((await call("verify-email", { token: pending })).data.status, "expired");assert.equal(await prisma.user.count({ where: { email } }), 0);
});

test("webbevestiging behoudt redirect en cookie voor nieuwe registratie, oude accountlink blijft zonder nieuwe cookie", async () => {
  const email = `web-verify-${randomUUID()}@example.invalid`, token = await startPendingRegistration({ email, handle: "Webbevestigd", passwordHash, uiLanguage: "nl", contentLanguage: "nl", returnTo: "/groups" }, base);assert.ok(token);
  const response = await fetch(`${base}/api/auth/verify-email/confirm?token=${token}`, { redirect: "manual" });
  assert.equal(response.status, 303);assert.ok(response.headers.get("set-cookie")?.includes("bvm_session="));
  const destination = new URL(response.headers.get("location")!);assert.equal(destination.pathname, "/verify-email");assert.equal(destination.searchParams.get("status"), "confirmed");assert.equal(destination.searchParams.get("next"), "/groups");assert.equal(destination.searchParams.has("token"), false);
  const user = await account({ emailVerifiedAt: null }), legacy = await createAuthToken(user.id, "EMAIL_VERIFY");
  const old = await fetch(`${base}/api/auth/verify-email/confirm?token=${legacy}`, { redirect: "manual" });assert.equal(old.status, 303);assert.equal(old.headers.get("set-cookie"), null);assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt);
});

test("mislukte oude accountbevestiging rolt ook tokenverbruik terug en blijft herstelbaar", async () => {
  const user = await account({ emailVerifiedAt: null }), token = await createAuthToken(user.id, "EMAIL_VERIFY");
  // Alleen deze wegwerpdatabase; geen productie. Fout ná tokenclaim afdwingen.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION native_verify_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic verification fault'; END; $$`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER native_verify_fault BEFORE UPDATE OF "emailVerifiedAt" ON "User" FOR EACH ROW EXECUTE FUNCTION native_verify_fault()`);
    assert.equal((await call("verify-email", { token })).response.status, 500);
    assert.equal((await prisma.authToken.findFirstOrThrow({ where: { userId: user.id, type: "EMAIL_VERIFY" } })).usedAt, null);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt, null);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS native_verify_fault ON "User"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION native_verify_fault()`);
  }
  assert.equal((await call("verify-email", { token })).data.status, "confirmed");
});
