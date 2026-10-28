import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, createECDH } from "node:crypto";
import { readFileSync } from "node:fs";
import { io, type Socket } from "socket.io-client";

const database = process.env.SECURITY_TEST_DATABASE_URL;
const base = process.env.SECURITY_TEST_BASE_URL;
const skip = !database || !base ? "SECURITY_TEST_DATABASE_URL en SECURITY_TEST_BASE_URL vereist" : false;
if (database) {
  assert.match(new URL(database).pathname, /security_[a-z0-9_]*test$/i, "uitsluitend een expliciete security-testdatabase");
  process.env.DATABASE_URL = database;
}
let db: typeof import("../src/lib/db")["prisma"];
let auth: typeof import("../src/lib/auth");
let tokens: typeof import("../src/lib/authTokens");
const ids: string[] = [], emails: string[] = [];
const password = "synthetic-security-password-only";
const run = randomBytes(5).toString("hex");
let sequence = 0;
before(async () => {
  if (skip) return;
  db = (await import("../src/lib/db")).prisma;
  auth = await import("../src/lib/auth");
  tokens = await import("../src/lib/authTokens");
  assert.equal((await fetch(base! + "/api/health")).status, 200);
});
after(async () => {
  if (skip) return;
  await db.pendingRegistration.deleteMany({ where: { email: { in: emails } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});
async function user(isAdmin = false) {
  const email = `security-${run}-${++sequence}@test.invalid`;
  emails.push(email);
  const created = await db.user.create({ data: { email, handle: `Security ${run} ${sequence}`, discriminator: "1234", passwordHash: await auth.hashPassword(password), isAdmin } });
  ids.push(created.id);
  return created;
}
const cookie = async (id: string) => `bvm_session=${await auth.createSessionToken(id)}`;
async function request(path: string, method = "GET", body?: unknown, session?: string, extra: Record<string, string> = {}) {
  return fetch(base! + path, { method, headers: { Origin: base!, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(session ? { Cookie: session } : {}), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function socketFor(session: string): Promise<Socket> {
  const socket = io(base!, { transports: ["websocket"], extraHeaders: { Cookie: session, Origin: base! }, reconnection: false });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.disconnect(); reject(Error("socket niet beschikbaar")); }, 5000);
    socket.once("connect", () => { clearTimeout(timer); resolve(); });
    socket.once("connect_error", error => { clearTimeout(timer); socket.disconnect(); reject(error); });
  });
  return socket;
}
async function disconnected(socket: Socket, action: () => Promise<unknown>) {
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("ingetrokken socket bleef open")), 5000);
      socket.once("disconnect", () => { clearTimeout(timer); resolve(); });
      action().catch(reject);
    });
  } finally { socket.disconnect(); }
}

test("reset-token wordt bij acht gelijktijdige claims precies één keer geaccepteerd", { skip }, async () => {
  const account = await user(), token = await tokens.createAuthToken(account.id, "PASSWORD_RESET");
  const results = await Promise.all(Array.from({ length: 8 }, () => tokens.consumeAuthToken(token, "PASSWORD_RESET")));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await tokens.consumeAuthToken(token, "PASSWORD_RESET"), null);
});

test("twee verschillende resetlinks kunnen slechts één wachtwoordreset uitvoeren; verlopen link doet niets", { skip }, async () => {
  const account = await user();
  const links = await Promise.all([tokens.createAuthToken(account.id, "PASSWORD_RESET"), tokens.createAuthToken(account.id, "PASSWORD_RESET")]);
  const hash = await auth.hashPassword("new-synthetic-password");
  const outcomes = await Promise.all(links.map(link => tokens.resetPasswordWithToken(link, hash)));
  assert.equal(outcomes.filter(Boolean).length, 1);
  const updated = await db.user.findUniqueOrThrow({ where: { id: account.id } });
  assert.equal(updated.sessionVersion, account.sessionVersion + 1);
  assert.ok(await auth.verifyPassword("new-synthetic-password", updated.passwordHash));
  assert.equal(await tokens.resetPasswordWithToken(links[0], hash), null);
  const expired = await tokens.createAuthToken(account.id, "PASSWORD_RESET");
  await db.authToken.updateMany({ where: { userId: account.id, usedAt: null }, data: { expiresAt: new Date(0) } });
  assert.equal(await tokens.resetPasswordWithToken(expired, "unused"), null);
});

test("feedback-API bevat geen beheerderstoken; gewone gebruiker kan beheerroutes niet gebruiken", { skip }, async () => {
  const account = await user();
  const report = await db.feedback.create({ data: { userId: account.id, message: "synthetic", respondToken: randomBytes(24).toString("hex") } });
  const response = await request("/api/feedback", "GET", undefined, await cookie(account.id));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
  const body = await response.json();
  assert.equal(body.reports.find((r: { id: string }) => r.id === report.id)?.message, "synthetic");
  assert.equal(JSON.stringify(body).includes(report.respondToken), false);
  assert.equal("respondToken" in body.reports[0], false);
  const page = await request("/feedback", "GET", undefined, await cookie(account.id));
  assert.equal(page.status, 200);
  assert.ok((await page.text()).includes("security-operator@test.invalid"));
  assert.equal((await request(`/api/admin/feedback/${report.id}`, "PATCH", { status: "DONE" }, await cookie(account.id))).status, 403);
  const admin = await user(true);
  assert.equal((await request(`/api/admin/feedback/${report.id}`, "PATCH", { status: "DONE" }, await cookie(admin.id))).status, 200);
  assert.equal((await db.feedback.findUniqueOrThrow({ where: { id: report.id } })).status, "DONE");
});

test("beveiligingsmigratie trekt bestaande feedbacklinks in en bewaart de melding", { skip }, async () => {
  const account = await user(), oldToken = randomBytes(24).toString("hex");
  const original = await db.feedback.create({ data: { userId: account.id, message: "bewaren", respondToken: oldToken } });
  // Uitsluitend deze eigen testdatabase; voer de werkelijk ingecheckte data-migratie uit.
  await db.$executeRawUnsafe(readFileSync("prisma/migrations/20261126120000_feedback_token_rotation/migration.sql", "utf8"));
  const updated = await db.feedback.findUniqueOrThrow({ where: { id: original.id } });
  assert.notEqual(updated.respondToken, oldToken); assert.equal(updated.message, "bewaren");
  assert.equal((await request(`/api/feedback/respond/${oldToken}`, "POST", { status: "DONE" })).status, 404);
  assert.equal((await request(`/api/feedback/respond/${updated.respondToken}`, "POST", { status: "DONE" })).status, 200);
});

test("uitloggen trekt oude tokens en reeds geopende sockets in", { skip }, async () => {
  const account = await user(), session = await cookie(account.id), socket = await socketFor(session);
  await disconnected(socket, async () => assert.equal((await request("/api/auth/logout", "POST", {}, session)).status, 200));
  assert.equal((await request("/api/me", "GET", undefined, session)).status, 401);
  assert.equal((await request("/api/auth/logout", "POST", {}, session)).status, 200);
});

test("ook een losse sessionVersion-wijziging blokkeert het volgende socketpakket", { skip }, async () => {
  const account = await user(), session = await cookie(account.id), socket = await socketFor(session);
  await db.user.update({ where: { id: account.id }, data: { sessionVersion: { increment: 1 } } });
  await disconnected(socket, async () => { socket.emit("friend_statuses_request"); });
  assert.equal((await request("/api/me", "GET", undefined, session)).status, 401);
});

test("wachtwoord wijzigen blijft werken, met nieuwe cookie en intrekking van de oude sessie", { skip }, async () => {
  const account = await user(), session = await cookie(account.id), socket = await socketFor(session);
  let response: Response | undefined;
  await disconnected(socket, async () => {
    response = await request("/api/account", "PUT", { currentPassword: password, newPassword: "changed-synthetic-password" }, session);
    assert.equal(response.status, 200);
  });
  assert.equal((await request("/api/me", "GET", undefined, session)).status, 401);
  const renewed = response!.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  assert.equal((await request("/api/me", "GET", undefined, renewed)).status, 200);
});

test("accountwissen verwijdert registratiepersoonsgegevens via zowel zelfbediening als beheer", { skip }, async () => {
  const admin = await user(true);
  for (const throughAdmin of [false, true]) {
    const account = await user();
    await db.pendingRegistration.create({ data: { email: account.email, handle: account.handle, passwordHash: "", tokenHash: randomBytes(32).toString("hex"), confirmedAt: new Date(), expiresAt: new Date(Date.now() + 86400000) } });
    const response = throughAdmin
      ? await request(`/api/admin/users/${account.id}`, "DELETE", undefined, await cookie(admin.id))
      : await request("/api/account", "DELETE", { password, confirm: "DELETE" }, await cookie(account.id));
    assert.equal(response.status, 200);
    assert.equal(await db.user.count({ where: { id: account.id } }), 0);
    assert.equal(await db.pendingRegistration.count({ where: { email: account.email } }), 0);
  }
});

test("verkeerde origin en text/plain wijzigen geen privacyinstelling; legitieme JSON wel", { skip }, async () => {
  const account = await user(), session = await cookie(account.id);
  assert.equal((await request("/api/account", "PATCH", { shareOnlineStatus: false }, session, { Origin: "https://untrusted.example.invalid" })).status, 403);
  assert.equal((await request("/%61pi/account", "PATCH", { shareOnlineStatus: false }, session, { Origin: "https://untrusted.example.invalid" })).status, 403);
  assert.equal((await fetch(base! + "/%zz")).status, 400);
  assert.equal((await request("/api/health")).status, 200);
  assert.equal((await request("/api/account", "PATCH", { shareOnlineStatus: false }, session, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: account.id } })).shareOnlineStatus, account.shareOnlineStatus);
  assert.equal((await request("/api/account", "PATCH", { shareOnlineStatus: false }, session)).status, 200);
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: account.id } })).shareOnlineStatus, false);
});

test("wachtwoordcontrole heeft een budget en begrensde invoer", { skip }, async () => {
  const account = await user(), session = await cookie(account.id);
  for (let i = 0; i < 10; i++) assert.equal((await request("/api/account", "PUT", { currentPassword: "wrong", newPassword: "unused-password" }, session)).status, 401);
  const locked = await request("/api/account", "PUT", { currentPassword: "wrong", newPassword: "unused-password" }, session);
  assert.equal(locked.status, 429); assert.ok(Number(locked.headers.get("retry-after")) > 0);
  assert.equal((await request("/api/auth/register", "POST", { email: "unused@test.invalid", handle: "Synthetic", password: "x".repeat(257) })).status, 400);
});

test("push weigert interne bestemmingen en verwijdert ook onveilige historische subscriptions", { skip }, async () => {
  const account = await user(), session = await cookie(account.id), ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  const keys = { p256dh: ecdh.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };
  assert.equal((await request("/api/push/subscribe", "POST", { endpoint: "https://127.0.0.1/private", keys }, session)).status, 400);
  const endpoint = `https://fcm.googleapis.com/fcm/send/security-${run}`;
  assert.equal((await request("/api/push/subscribe", "POST", { endpoint, keys }, session)).status, 200);
  const bad = await db.pushSubscription.create({ data: { userId: account.id, endpoint: `https://127.0.0.1/private-${run}`, ...keys } });
  const push = await import("../src/lib/push"); const original = push.pushTransport.send; const sent: string[] = [];
  try {
    push.pushTransport.send = async subscription => { sent.push(subscription.endpoint); return { statusCode: 201, headers: {}, body: "" }; };
    await push.sendPushToUser(account.id, { title: "synthetic", body: "no network" });
  } finally { push.pushTransport.send = original; }
  assert.deepEqual(sent, [endpoint]); assert.equal(await db.pushSubscription.count({ where: { id: bad.id } }), 0);
});

test("feedback heeft uitsluitend een expliciet geconfigureerde ontvanger", { skip }, async () => {
  const { feedbackRecipient, sendFeedbackMail } = await import("../src/lib/feedback");
  const previous = process.env.FEEDBACK_RECIPIENT_EMAIL;
  try {
    delete process.env.FEEDBACK_RECIPIENT_EMAIL; assert.equal(feedbackRecipient(), null);
    assert.equal((await sendFeedbackMail({ subject: "synthetic", html: "", text: "" })).ok, false);
    process.env.FEEDBACK_RECIPIENT_EMAIL = "operator@example.invalid"; assert.equal(feedbackRecipient(), "operator@example.invalid");
    process.env.FEEDBACK_RECIPIENT_EMAIL = "operator@example.invalid,attacker@example.invalid"; assert.equal(feedbackRecipient(), null);
  } finally { if (previous === undefined) delete process.env.FEEDBACK_RECIPIENT_EMAIL; else process.env.FEEDBACK_RECIPIENT_EMAIL = previous; }
});

test("web-2FA blijft verplicht na reset, met authenticator én eenmalige herstelcode", { skip }, async () => {
  const account = await user();
  const totp = await import("../src/lib/totp");
  const secret = totp.generateTotpSecret(), recovery = totp.generateRecoveryCodes();
  await db.user.update({ where: { id: account.id }, data: { totpEnabled: true, totpSecretEncrypted: totp.encryptTotpSecret(secret), totpRecoveryCodes: await totp.hashRecoveryCodes(recovery) } });
  const raw = await tokens.createAuthToken(account.id, "PASSWORD_RESET");
  const reset = await request("/api/auth/reset-password", "POST", { token: raw, newPassword: "new-twofactor-password" });
  assert.equal(reset.status, 200); assert.equal(reset.headers.getSetCookie().length, 0);
  const challenge = await reset.json(); assert.equal(challenge.requiresTwoFactor, true);
  const verified = await request("/api/auth/login/2fa", "POST", { challengeToken: challenge.challengeToken, code: totp.generateTotpCode(secret) });
  assert.equal(verified.status, 200); assert.ok(verified.headers.get("set-cookie")?.includes("bvm_session="));
  const login = await request("/api/auth/login", "POST", { identifier: account.email, password: "new-twofactor-password" });
  const second = await login.json(); assert.equal(second.requiresTwoFactor, true);
  const recovered = await request("/api/auth/login/2fa", "POST", { challengeToken: second.challengeToken, code: recovery[0] });
  assert.equal(recovered.status, 200); assert.equal((await recovered.json()).usedRecoveryCode, true);
  assert.equal((await request("/api/auth/login/2fa", "POST", { challengeToken: second.challengeToken, code: recovery[0] })).status, 401);
});

test("beheerderreset zonder SMTP blijft beschikbaar en trekt het oude token in", { skip }, async () => {
  const admin = await user(true), target = await user(), previous = await cookie(target.id);
  const reset = await request(`/api/admin/users/${target.id}/reset-password`, "POST", {}, await cookie(admin.id));
  assert.equal(reset.status, 200);
  const result = await reset.json(); assert.equal(typeof result.tempPassword, "string");
  assert.equal((await request("/api/me", "GET", undefined, previous)).status, 401);
  const login = await request("/api/auth/login", "POST", { identifier: target.email, password: result.tempPassword });
  assert.equal(login.status, 200); assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).mustChangePassword, true);
});

test("vergeten-wachtwoordbudget begrenst tokenaanmaak ook voor niet-bestaande accounts", { skip }, async () => {
  const identifier = `unknown-${run}@test.invalid`;
  // SMTP is in deze geïsoleerde database uit; geen echte e-mail versturen.
  assert.ok(!(await db.emailSettings.findUnique({ where: { id: "singleton" }, select: { enabled: true } }))?.enabled);
  for (let i = 0; i < 3; i++) assert.equal((await request("/api/auth/forgot-password", "POST", { identifier })).status, 503);
  const limited = await request("/api/auth/forgot-password", "POST", { identifier });
  assert.equal(limited.status, 200); assert.equal((await limited.json()).ok, true);
});
