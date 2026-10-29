import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth";
import { createAuthToken } from "../src/lib/authTokens";
import { NativeClientError, NativeSessionClient, type SecureSessionStore } from "../src/lib/native/client";
import { nativeAccessTransport, INTERNAL_ACCESS_ORIGIN } from "../src/lib/native/access";
import { nativeAccessGateway } from "./fixtures/native-access-gateway";

const database = new URL(process.env.NATIVE_TEST_DATABASE_URL ?? "http://invalid");
if (database.hostname !== "127.0.0.1" || database.pathname !== "/versado_content_access_test" || database.href !== process.env.DATABASE_URL) throw new Error("Alleen eigen geïsoleerde database");
const backend = process.env.NATIVE_TEST_BASE_URL!;
const password = "Synthetic-Access-password-42", passwordHash = await hashPassword(password);
after(() => prisma.$disconnect());
function sessions() {
  let value: string | null = null;
  const store: SecureSessionStore = { async read() { return value; }, async write(next) { value = next; }, async clear() { value = null; } };
  return { store, value: () => value ? JSON.parse(value) : null };
}
const account = () => prisma.user.create({ data: { email: `access-${randomUUID()}@example.invalid`, handle: `Access${randomUUID().slice(0, 10)}`, discriminator: "01", passwordHash, emailVerifiedAt: new Date(), onboardingSeenAt: new Date() } });

test("Access-poort blokkeert vóór backend; enrollment, capabilities, login, refresh en logout gebruiken bestaande sessies", async () => {
  const gate = await nativeAccessGateway(backend), saved = sessions(), user = await account();
  const client = new NativeSessionClient(INTERNAL_ACCESS_ORIGIN, saved.store, nativeAccessTransport(gate.bridge), false);
  try {
    await assert.rejects(client.publicRequest("capabilities"), /access_missing/); assert.equal(gate.counts().forwarded, 0);
    await gate.bridge.enrollAccess({ language: "nl" });
    assert.equal((await client.publicRequest<{ apiVersion: number }>("capabilities")).apiVersion, 1);
    await client.login(user.email, password); assert.equal((await client.api<{ id: string }>("me")).id, user.id);
    const initial = saved.value().refreshToken;
    gate.revoke();
    const resumed = new NativeSessionClient(INTERNAL_ACCESS_ORIGIN, saved.store, nativeAccessTransport(gate.bridge), false);
    await assert.rejects(resumed.restore(), (error: unknown) => error instanceof NativeClientError && error.code === "access_denied" && error.status === 0);
    assert.equal(saved.value().refreshToken, initial);
    assert.equal(await prisma.nativeSession.count({ where: { userId: user.id, revokedAt: null } }), 1);
    const actionId = saved.value().actionId;
    gate.rotate(); await gate.bridge.enrollAccess({ language: "nl" });
    assert.equal(await resumed.restore(), true); assert.notEqual(saved.value().refreshToken, initial);
    const refreshCalls = gate.calls.filter((value) => (value as { path: string }).path === "refresh") as Array<{ body: string }>;
    assert.ok(refreshCalls.every(call => JSON.parse(call.body).actionId === actionId));
    await resumed.logout(); assert.equal(saved.value(), null);
    assert.equal(await prisma.nativeSession.count({ where: { userId: user.id, revokedAt: null } }), 0);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).xpTotal, 0);
    for (const secret of gate.privateValues()) assert.ok(!JSON.stringify(gate.calls).includes(secret));
  } finally { await gate.close(); }
});
test("wissen bewaart logoutintentie zonder Access; reenrollment voert serverintrekking af; redirects gaan nergens heen", async () => {
  const gate = await nativeAccessGateway(backend), saved = sessions(), user = await account();
  const client = new NativeSessionClient(INTERNAL_ACCESS_ORIGIN, saved.store, nativeAccessTransport(gate.bridge), false);
  try {
    await gate.bridge.enrollAccess({ language: "en" }); await client.login(user.email, password);
    await gate.bridge.clearAccess(); await assert.rejects(client.logout(), /access_missing/);
    assert.equal(saved.value().logoutPending, true); assert.equal(await prisma.nativeSession.count({ where: { userId: user.id, revokedAt: null } }), 1);
    await gate.bridge.enrollAccess({ language: "en" }); assert.equal(await client.restore(), false);
    assert.equal(saved.value(), null); assert.equal(await prisma.nativeSession.count({ where: { userId: user.id, revokedAt: null } }), 0);
    const before = gate.counts().forwarded; gate.redirect(true);
    await assert.rejects(client.publicRequest("capabilities"), /access_redirect_blocked/); assert.equal(gate.counts().forwarded, before);
  } finally { await gate.close(); }
});
test("registratie, bevestiging en reset via de poort behouden bestaande mail-/eenmaligheidsregels", async () => {
  const gate = await nativeAccessGateway(backend), saved = sessions(), user = await account();
  const client = new NativeSessionClient(INTERNAL_ACCESS_ORIGIN, saved.store, nativeAccessTransport(gate.bridge), false);
  try {
    await gate.bridge.enrollAccess({ language: "en" });
    const email = `access-register-${randomUUID()}@example.invalid`;
    assert.deepEqual(await client.publicRequest("register", { email, password, handle: `Access${randomUUID().slice(0, 10)}` }), { ok: true });
    // Deze geïsoleerde server heeft bewust geen SMTP. De bestaande registratieflow
    // maakt dan een onbevestigd account; met SMTP geldt de apart geteste pending-flow.
    const registered = await prisma.user.findUniqueOrThrow({ where: { email } });
    assert.equal(registered.emailVerifiedAt, null);
    assert.equal(await prisma.nativeSession.count({ where: { userId: registered.id } }), 0);
    await client.publicRequest("forgot-password", { identifier: user.email });
    const reset = await createAuthToken(user.id, "PASSWORD_RESET");
    await client.publicRequest("reset-password", { token: reset, newPassword: "Synthetic-new-access-password-42" });
    await assert.rejects(client.publicRequest("reset-password", { token: reset, newPassword: "Synthetic-replayed-password-42" }), /invalid_reset_link/);
    const verification = await createAuthToken(registered.id, "EMAIL_VERIFY");
    const result = await client.publicRequest<{ status: string }>("verify-email", { token: verification });
    assert.equal(result.status, "confirmed");
    assert.equal((await client.publicRequest<{ status: string }>("verify-email", { token: verification })).status, "already");
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: registered.id } })).emailVerifiedAt);
    assert.equal(await prisma.nativeSession.count({ where: { userId: registered.id } }), 0);
    assert.equal(await prisma.nativeSession.count({ where: { userId: user.id } }), 0, "Reset- en mailbewijs zijn geen loginbewijs");
  } finally { await gate.close(); }
});
