import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createSessionToken, hashPassword } from "../src/lib/auth";
import { encryptTotpSecret, generateRecoveryCodes, generateTotpCode, generateTotpSecret, hashRecoveryCodes } from "../src/lib/totp";
import { issueNativeSession, nativeSessionIdentity, nativeUser } from "../src/lib/native/sessions";
import { AccountDeletionConflict, deleteUserAccount } from "../src/lib/accountDeletion";
import { AccountDeletionError, deleteAccountWithReauthentication } from "../src/lib/account/deletion";
import { clearFailures } from "../src/lib/rateLimit";
import { createGroup } from "../src/lib/social/groups";
import { twoFactorFailureKey } from "../src/lib/totp";

// Uitsluitend de eigen, geïsoleerde testdatabase met synthetische accounts.
const database = new URL(process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || database.href !== process.env.DATABASE_URL) throw Error("Alleen eigen geïsoleerde database");
const base = process.env.NATIVE_TEST_BASE_URL, password = "Synthetic-delete-42", passwordHash = await hashPassword(password);
const confirm = "DELETE" as const;

async function account(extra: Record<string, unknown> = {}) {
  return prisma.user.create({ data: { email: `delete-${randomUUID()}@example.invalid`, handle: `Verwijder${randomUUID().slice(0, 8)}`, discriminator: "01", passwordHash, emailVerifiedAt: new Date(), onboardingSeenAt: new Date(), xpTotal: 41, ...extra } });
}
const exists = async (id: string) => !!(await prisma.user.findUnique({ where: { id }, select: { id: true } }));
const rejectsWith = (promise: Promise<unknown>, code: string) => assert.rejects(promise, (error: unknown) => error instanceof AccountDeletionError && error.code === code);

after(async () => {
  await prisma.$disconnect();
  const shared = globalThis as typeof globalThis & { __versadoAuthBudget?: Promise<{ disconnect(): void }> };
  await shared.__versadoAuthBudget?.then(client => client.disconnect()).catch(() => {});
});

test("goed wachtwoord verwijdert alleen dit account; sessies en Apple-koppeling verdwijnen mee, andere accounts blijven", async () => {
  const user = await account(), other = await account();
  const session = await issueNativeSession(user.id, user.sessionVersion);
  await prisma.externalIdentity.create({ data: { userId: user.id, provider: "APPLE", scope: "TESTTEAM01", subject: randomUUID() } });
  await deleteAccountWithReauthentication(user, { password, confirm });
  assert.equal(await exists(user.id), false);
  assert.equal(await prisma.nativeSession.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.externalIdentity.count({ where: { userId: user.id } }), 0);
  await assert.rejects(nativeUser(session.accessToken), "oude native sessie is ongeldig na verwijdering");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).xpTotal, 41, "ander account ongemoeid");
});

test("na verwijdering worden de Socket.io-verbindingen van het account gesloten, en niet bij een mislukte poging", async () => {
  const shared = globalThis as typeof globalThis & { __versadoRealtimeServer?: unknown };
  const rooms: string[] = [];
  shared.__versadoRealtimeServer = { in: (room: string) => ({ disconnectSockets: () => { rooms.push(room); } }) };
  try {
    const user = await account();
    await rejectsWith(deleteAccountWithReauthentication(user, { password: "fout", confirm }), "wrong_password");
    assert.deepEqual(rooms, [], "mislukte poging sluit niets");
    await deleteAccountWithReauthentication(user, { password, confirm });
    assert.deepEqual(rooms, [`user:${user.id}`]);
  } finally { delete shared.__versadoRealtimeServer; }
});

test("verkeerd wachtwoord verwijdert niets en wijzigt niets", async () => {
  const user = await account();
  await rejectsWith(deleteAccountWithReauthentication(user, { password: "fout-wachtwoord", confirm }), "wrong_password");
  const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(after.sessionVersion, user.sessionVersion); assert.equal(after.passwordHash, user.passwordHash);
});

test("verlopen of gewijzigde sessie (andere sessieversie) of onbekend account verwijdert niets", async () => {
  const user = await account();
  await rejectsWith(deleteAccountWithReauthentication({ id: user.id, sessionVersion: user.sessionVersion + 1 }, { password, confirm }), "session_changed");
  await rejectsWith(deleteAccountWithReauthentication({ id: randomUUID(), sessionVersion: 0 }, { password, confirm }), "session_changed");
  assert.equal(await exists(user.id), true);
});

test("accountverwisseling: het bewijs van het ene account verwijdert nooit een ander account", async () => {
  const mine = await account(), theirs = await account({ passwordHash: await hashPassword("Ander-wachtwoord-42") });
  await rejectsWith(deleteAccountWithReauthentication({ id: theirs.id, sessionVersion: theirs.sessionVersion }, { password, confirm }), "wrong_password");
  assert.equal(await exists(theirs.id), true); assert.equal(await exists(mine.id), true);
});

test("deleteUserAccount met verouderde sessieversie gooit AccountDeletionConflict en laat het account intact", async () => {
  const user = await account(), friend = await account();
  await assert.rejects(deleteUserAccount(user.id, { expectedSessionVersion: user.sessionVersion + 5 }), AccountDeletionConflict);
  assert.equal(await exists(user.id), true);
  await deleteUserAccount(user.id, { expectedSessionVersion: user.sessionVersion });
  assert.equal(await exists(user.id), false);
  await deleteUserAccount(user.id, { expectedSessionVersion: user.sessionVersion }); // idempotent: geen fout bij een tweede keer
  await deleteUserAccount(friend.id); // beheer/opschoning: zonder versie, zoals voorheen
  assert.equal(await exists(friend.id), false);
});

test("TOTP: zonder code, met foute code, met geldige code en met herstelcode (eenmalig, atomair)", async () => {
  const secret = generateTotpSecret(), recovery = generateRecoveryCodes(2);
  const user = await account({ totpEnabled: true, totpSecretEncrypted: encryptTotpSecret(secret), totpRecoveryCodes: await hashRecoveryCodes(recovery) });
  clearFailures(twoFactorFailureKey(user.id));
  await rejectsWith(deleteAccountWithReauthentication(user, { password, confirm }), "two_factor_required");
  await rejectsWith(deleteAccountWithReauthentication(user, { password, code: "000000", confirm }), "wrong_code");
  assert.equal(await exists(user.id), true);
  await deleteAccountWithReauthentication(user, { password, code: generateTotpCode(secret), confirm });
  assert.equal(await exists(user.id), false);

  const second = await account({ totpEnabled: true, totpSecretEncrypted: encryptTotpSecret(secret), totpRecoveryCodes: await hashRecoveryCodes(recovery) });
  clearFailures(twoFactorFailureKey(second.id));
  await deleteAccountWithReauthentication(second, { password, code: recovery[0], confirm });
  assert.equal(await exists(second.id), false, "geldige herstelcode werkt");
});

test("een herstelcode kan niet door twee gelijktijdige verzoeken worden gebruikt", async () => {
  const secret = generateTotpSecret(), recovery = generateRecoveryCodes(1);
  const user = await account({ totpEnabled: true, totpSecretEncrypted: encryptTotpSecret(secret), totpRecoveryCodes: await hashRecoveryCodes(recovery) });
  clearFailures(twoFactorFailureKey(user.id));
  const results = await Promise.allSettled([1, 2].map(() => deleteAccountWithReauthentication(user, { password, code: recovery[0], confirm })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1, "precies één verzoek slaagt");
  const failed = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(failed.reason instanceof AccountDeletionError && ["wrong_code", "session_changed"].includes(failed.reason.code));
  assert.equal(await exists(user.id), false);
});

test("na vijf foute tweede factoren volgt een blokkade, ook met de juiste code", async () => {
  const secret = generateTotpSecret();
  const user = await account({ totpEnabled: true, totpSecretEncrypted: encryptTotpSecret(secret), totpRecoveryCodes: null });
  clearFailures(twoFactorFailureKey(user.id));
  for (let i = 0; i < 5; i++) await rejectsWith(deleteAccountWithReauthentication(user, { password, code: "111111", confirm }), "wrong_code");
  await rejectsWith(deleteAccountWithReauthentication(user, { password, code: generateTotpCode(secret), confirm }), "too_many_attempts");
  assert.equal(await exists(user.id), true);
  clearFailures(twoFactorFailureKey(user.id));
});

test("gelijktijdige verzoeken met geldig bewijs: het account verdwijnt één keer, zonder onverwachte fouten", async () => {
  const user = await account();
  const results = await Promise.allSettled([1, 2, 3].map(() => deleteAccountWithReauthentication(user, { password, confirm })));
  assert.ok(results.some(result => result.status === "fulfilled"));
  for (const result of results) if (result.status === "rejected") assert.ok(result.reason instanceof AccountDeletionError && result.reason.code === "session_changed", String(result.reason));
  assert.equal(await exists(user.id), false);
});

test("accounts zonder wachtwoord (alleen Apple) worden nog niet verwijderd en niet beschadigd", async () => {
  const user = await account({ passwordLoginEnabled: false });
  await prisma.externalIdentity.create({ data: { userId: user.id, provider: "APPLE", scope: "TESTTEAM01", subject: randomUUID() } });
  await rejectsWith(deleteAccountWithReauthentication(user, { password, confirm }), "reauthentication_unavailable");
  await rejectsWith(deleteAccountWithReauthentication(user, { password: "", confirm } as never), "reauthentication_unavailable");
  assert.equal(await exists(user.id), true); assert.equal(await prisma.externalIdentity.count({ where: { userId: user.id } }), 1);
});

test("de laatste beheerder kan zichzelf niet verwijderen; met een tweede beheerder wel", async () => {
  await prisma.user.updateMany({ where: { isAdmin: true }, data: { isAdmin: false } });
  const admin = await account({ isAdmin: true });
  await rejectsWith(deleteAccountWithReauthentication(admin, { password, confirm }), "last_admin");
  assert.equal(await exists(admin.id), true);
  const second = await account({ isAdmin: true });
  await deleteAccountWithReauthentication(admin, { password, confirm });
  assert.equal(await exists(admin.id), false);
  await prisma.user.update({ where: { id: second.id }, data: { isAdmin: false } });
});

test("admin-wissen en opruimen werken ongewijzigd zonder herauthenticatie", async () => {
  const user = await account();
  await deleteUserAccount(user.id);
  assert.equal(await exists(user.id), false);
});

// Native HTTP-contract: alleen als de testserver beschikbaar is (de geïsoleerde native-testrunner start hem).
const http = base ? test : test.skip;
async function nativeDelete(token: string | null, body: unknown, ip = "127.0.0.31") {
  const response = await fetch(`${base}/api/v1/native/account`, { method: "DELETE", headers: { Origin: "capacitor://localhost", "X-Versado-Client": "native-v1", "Content-Type": "application/json", "x-real-ip": ip, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { response, data: await response.json() as { error?: string; ok?: boolean } };
}
http("native contract: zonder sessie 401, fout wachtwoord 401, zonder bevestiging 400, daarna één geslaagde verwijdering en een ongeldige sessie", async () => {
  const user = await account();
  const session = await issueNativeSession(user.id, user.sessionVersion);
  assert.equal((await nativeDelete(null, { password, confirm })).response.status, 401);
  const wrong = await nativeDelete(session.accessToken, { password: "fout", confirm }); assert.equal(wrong.response.status, 401); assert.equal(wrong.data.error, "wrong_credentials");
  assert.equal((await nativeDelete(session.accessToken, { password })).response.status, 400, "zonder expliciete bevestiging");
  assert.equal((await nativeDelete(session.accessToken, { password, confirm, extra: true })).response.status, 400, "strikt contract");
  assert.equal(await exists(user.id), true);
  const done = await nativeDelete(session.accessToken, { password, confirm }); assert.equal(done.response.status, 200); assert.equal(done.data.ok, true);
  assert.equal(await exists(user.id), false);
  const again = await nativeDelete(session.accessToken, { password, confirm }); assert.equal(again.response.status, 401, "herhaling na verwijdering geeft een ongeldige sessie, geen tweede verwijdering");
  const me = await fetch(`${base}/api/v1/native/me`, { headers: { Origin: "capacitor://localhost", "X-Versado-Client": "native-v1", Authorization: `Bearer ${session.accessToken}` } });
  assert.equal(me.status, 401);
});
http("native contract: een account zonder wachtwoord (Apple) krijgt een uitlegbare 409, zonder verwijdering", async () => {
  const apple = await account({ passwordLoginEnabled: false });
  const token = (await issueNativeSession(apple.id, apple.sessionVersion)).accessToken;
  const result = await nativeDelete(token, { password, confirm }, "127.0.0.32");
  assert.equal(result.response.status, 409); assert.equal(result.data.error, "reauthentication_unavailable");
  assert.equal(await exists(apple.id), true);
});
http("native contract: het budget begrenst pogingen per account (429)", async () => {
  const user = await account();
  const token = (await issueNativeSession(user.id, user.sessionVersion)).accessToken;
  const statuses: number[] = [];
  for (let i = 0; i < 7; i++) statuses.push((await nativeDelete(token, { password: "fout", confirm }, "127.0.0.33")).response.status);
  assert.equal(statuses.at(-1), 429); assert.equal(statuses[0], 401);
  assert.equal(await exists(user.id), true);
});

async function webDelete(cookie: string | null, body: string | undefined, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}/api/account`, { method: "DELETE", headers: { Origin: base!, "Content-Type": "application/json", "x-real-ip": "127.0.0.41", ...(cookie ? { Cookie: `bvm_session=${cookie}` } : {}), ...headers }, body });
  return { response, data: await response.json().catch(() => ({})) as { error?: string; code?: string; ok?: boolean } };
}
http("web: alleen een sessiecookie volstaat niet meer; cross-origin, same-site en niet-JSON worden geweigerd", async () => {
  const user = await account(), cookie = await createSessionToken(user.id);
  assert.equal((await webDelete(null, JSON.stringify({ password, confirm }))).response.status, 401, "zonder sessie");
  const bare = await webDelete(cookie, JSON.stringify({})); assert.equal(bare.response.status, 400, "alleen cookie, zonder bewijs");
  assert.equal((await webDelete(cookie, undefined)).response.status, 400, "zonder body");
  assert.equal((await webDelete(cookie, JSON.stringify({ password, confirm }), { Origin: "https://aanvaller.example" })).response.status, 403, "andere origin");
  assert.equal((await webDelete(cookie, JSON.stringify({ password, confirm }), { Origin: "", "Sec-Fetch-Site": "cross-site" })).response.status, 403, "cross-site zonder origin");
  assert.equal((await webDelete(cookie, JSON.stringify({ password, confirm }), { Origin: "", "Sec-Fetch-Site": "same-site" })).response.status, 403, "same-site zonder origin");
  assert.equal((await webDelete(cookie, JSON.stringify({ password, confirm }), { "Content-Type": "text/plain" })).response.status, 415, "geen JSON");
  const wrong = await webDelete(cookie, JSON.stringify({ password: "fout", confirm })); assert.equal(wrong.response.status, 401); assert.equal(wrong.data.code, "wrong_password");
  assert.equal(await exists(user.id), true, "niets verwijderd door al deze verzoeken");
  const done = await webDelete(cookie, JSON.stringify({ password, confirm }));
  assert.equal(done.response.status, 200); assert.equal(done.data.ok, true);
  assert.match(done.response.headers.get("set-cookie") ?? "", /bvm_session=;/, "sessiecookie wordt gewist");
  assert.equal(await exists(user.id), false);
  assert.equal((await webDelete(cookie, JSON.stringify({ password, confirm }))).response.status, 401, "dezelfde cookie is daarna ongeldig, geen tweede verwijdering");
});
http("web: TOTP-account vraagt een code; Apple-only account krijgt 409; laatste beheerder 409", async () => {
  const secret = generateTotpSecret();
  const totp = await account({ totpEnabled: true, totpSecretEncrypted: encryptTotpSecret(secret) });
  clearFailures(twoFactorFailureKey(totp.id));
  const cookie = await createSessionToken(totp.id);
  const missing = await webDelete(cookie, JSON.stringify({ password, confirm }), { "x-real-ip": "127.0.0.42" }); assert.equal(missing.response.status, 400); assert.equal(missing.data.code, "two_factor_required");
  assert.equal((await webDelete(cookie, JSON.stringify({ password, code: generateTotpCode(secret), confirm }), { "x-real-ip": "127.0.0.42" })).response.status, 200);
  const apple = await account({ passwordLoginEnabled: false });
  const appleResult = await webDelete(await createSessionToken(apple.id), JSON.stringify({ password, confirm }), { "x-real-ip": "127.0.0.43" });
  assert.equal(appleResult.response.status, 409); assert.equal(appleResult.data.code, "reauthentication_unavailable"); assert.equal(await exists(apple.id), true);
  await prisma.user.updateMany({ where: { isAdmin: true }, data: { isAdmin: false } });
  const admin = await account({ isAdmin: true });
  const last = await webDelete(await createSessionToken(admin.id), JSON.stringify({ password, confirm }), { "x-real-ip": "127.0.0.44" });
  assert.equal(last.response.status, 409); assert.equal(last.data.code, "last_admin"); assert.equal(await exists(admin.id), true);
  await prisma.user.update({ where: { id: admin.id }, data: { isAdmin: false } });
});


test("native verwijdering hercontroleert ingetrokken, verlopen en verwisselde sessies onder de rijlocks", async () => {
  const user = await account(), other = await account();
  const original = await nativeSessionIdentity((await issueNativeSession(user.id, user.sessionVersion)).accessToken);
  const wrong = await nativeSessionIdentity((await issueNativeSession(other.id, other.sessionVersion)).accessToken);
  await rejectsWith(deleteAccountWithReauthentication(user, { password, confirm }, wrong.binding), "session_changed");
  await prisma.nativeSession.update({ where: { id: original.binding.sessionId }, data: { revokedAt: new Date() } });
  await rejectsWith(deleteAccountWithReauthentication(user, { password, confirm }, original.binding), "session_changed");
  const expired = await nativeSessionIdentity((await issueNativeSession(user.id, user.sessionVersion)).accessToken);
  await prisma.nativeSession.update({ where: { id: expired.binding.sessionId }, data: { createdAt: new Date(Date.now() - 2000), expiresAt: new Date(Date.now() - 1000) } });
  await rejectsWith(deleteAccountWithReauthentication(user, { password, confirm }, expired.binding), "session_changed");
  assert.equal(await exists(user.id), true); assert.equal(await exists(other.id), true);
});

test("databasefout na groepsvertrek en herstelcodeverbruik rolt de hele verwijdering terug", async () => {
  const recovery = generateRecoveryCodes(1), secret = generateTotpSecret();
  const user = await account({ totpEnabled: true, totpSecretEncrypted: encryptTotpSecret(secret), totpRecoveryCodes: await hashRecoveryCodes(recovery) });
  const group = await createGroup(user.id, "Synthetische verwijdergroep");
  const baseline = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  await prisma.$executeRawUnsafe(`CREATE FUNCTION delete_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id = '${user.id}' THEN RAISE EXCEPTION 'synthetic rollback'; END IF; RETURN OLD; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER delete_test_failure BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION delete_test_failure()`);
  try {
    await assert.rejects(deleteAccountWithReauthentication(user, { password, code: recovery[0], confirm }), /synthetic rollback/);
    assert.deepEqual((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).totpRecoveryCodes, baseline.totpRecoveryCodes);
    assert.equal((await prisma.socialGroup.findUniqueOrThrow({ where: { id: group.id } })).memberCount, 1);
    assert.equal((await prisma.groupMembership.findUniqueOrThrow({ where: { groupId_userId: { groupId: group.id, userId: user.id } } })).leftAt, null);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER delete_test_failure ON "User"');
    await prisma.$executeRawUnsafe('DROP FUNCTION delete_test_failure()');
  }
  await deleteAccountWithReauthentication(user, { password, code: recovery[0], confirm });
  assert.equal(await exists(user.id), false); assert.equal(await prisma.socialGroup.count({ where: { id: group.id } }), 0);
});

test("sessieverloop tijdens vertraagde DELETE rolt ook de accountcascade terug", async () => {
  const user = await account();
  const { binding } = await nativeSessionIdentity((await issueNativeSession(user.id, user.sessionVersion)).accessToken);
  await prisma.nativeSession.update({ where: { id: binding.sessionId }, data: { expiresAt: new Date(Date.now() + 1000) } });
  await prisma.$executeRawUnsafe(`CREATE FUNCTION delete_test_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id = '${user.id}' THEN PERFORM pg_sleep(1.5); END IF; RETURN OLD; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER delete_test_delay BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION delete_test_delay()`);
  try {
    await rejectsWith(deleteAccountWithReauthentication(user, { password, confirm }, binding), "session_changed");
    assert.equal(await exists(user.id), true);
    assert.equal(await prisma.nativeSession.count({ where: { id: binding.sessionId } }), 1);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER delete_test_delay ON "User"');
    await prisma.$executeRawUnsafe('DROP FUNCTION delete_test_delay()');
  }
});

test("de twee laatste beheerders kunnen zichzelf niet gelijktijdig allebei verwijderen", async () => {
  await prisma.user.updateMany({ where: { isAdmin: true }, data: { isAdmin: false } });
  const secret = generateTotpSecret();
  const extra = { isAdmin: true, totpEnabled: true, totpSecretEncrypted: encryptTotpSecret(secret) };
  const a = await account(extra), b = await account(extra);
  const result = await Promise.allSettled([a, b].map(actor => deleteAccountWithReauthentication(actor, { password, code: generateTotpCode(secret), confirm })));
  assert.equal(result.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(await prisma.user.count({ where: { id: { in: [a.id, b.id] }, isAdmin: true } }), 1);
  const rejected = result.find(x => x.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "last_admin");
});
