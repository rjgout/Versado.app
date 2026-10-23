import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { verifyAppleIdentity } from "../src/lib/native/apple";
import { NativeSessionClient, NativeClientError, type SecureSessionStore } from "../src/lib/native/client";
import { nativeOriginAllowed } from "../src/lib/native/api";
import { confirmNativeEmail } from "../src/lib/native/emailConfirmation";
import { nativePasswordResetActions } from "../src/lib/native/passwordReset";
import { nativeAccountActions } from "../src/lib/native/account";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { publicKey, privateKey } = await generateKeyPair("RS256");
const jwk = await exportJWK(publicKey); jwk.kid = "synthetic-test";
const keys = createLocalJWKSet({ keys: [jwk] }), nonce = "a".repeat(64), audience = "app.versado.test";
async function identity(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ sub: "stable-subject", nonce, email: "relay@privaterelay.appleid.com", email_verified: "true", ...overrides })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer("https://appleid.apple.com").setAudience(audience).setIssuedAt().setExpirationTime("5m").sign(privateKey);
}
test("Apple: echte RS256-verificatie, stabiel subject en relay-adres", async () => {
  assert.deepEqual(await verifyAppleIdentity(await identity(), nonce, audience, keys), { subject: "stable-subject", email: "relay@privaterelay.appleid.com" });
  assert.equal((await verifyAppleIdentity(await identity({ email_verified: "false" }), nonce, audience, keys)).email, null);
  assert.equal((await verifyAppleIdentity(await identity({ email: undefined }), nonce, audience, keys)).email, null);
});
test("Apple weigert verkeerde nonce, audience, issuer, tijd en handtekening", async () => {
  const jwt = await identity();
  await assert.rejects(verifyAppleIdentity(jwt, "b".repeat(64), audience, keys));
  await assert.rejects(verifyAppleIdentity(jwt, nonce, "another-app", keys));
  for (const payload of [
    { iss: "https://untrusted.invalid", aud: audience, nonce, sub: "subject", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+300 },
    { iss: "https://appleid.apple.com", aud: audience, nonce, sub: "subject", iat: 1, exp: 2 },
    { iss: "https://appleid.apple.com", aud: audience, sub: "subject", iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+300 },
    { iss: "https://appleid.apple.com", aud: audience, nonce, sub: "subject", iat: Math.floor(Date.now()/1000)+3600, exp: Math.floor(Date.now()/1000)+3900 },
  ]) {
    const token = await new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
    await assert.rejects(verifyAppleIdentity(token, nonce, audience, keys));
  }
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT({ nonce, sub: "subject" }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer("https://appleid.apple.com").setAudience(audience).setIssuedAt().setExpirationTime("5m").sign(other.privateKey);
  await assert.rejects(verifyAppleIdentity(forged, nonce, audience, keys));
  const symmetric = await new SignJWT({ nonce }).setProtectedHeader({ alg: "HS256" }).sign(new Uint8Array(32));
  await assert.rejects(verifyAppleIdentity(symmetric, nonce, audience, keys));
});
function store(initial: unknown = { refreshToken: "old-refresh" }) {
  let value: string | null = initial === null ? null : JSON.stringify(initial);
  const adapter: SecureSessionStore = { async read() { return value; }, async write(next) { value = next; }, async clear() { value = null; } };
  return { adapter, value: () => value ? JSON.parse(value) : null };
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
test("refresh: verloren response behoudt actionId en twee requests delen één rotatie", async () => {
  const saved = store(), calls: unknown[] = [];
  let drop = true;
  const transport: typeof fetch = async (_url, options) => {
    assert.equal(options?.credentials, "omit");
    if (String(_url).endsWith("/refresh")) {
      calls.push(JSON.parse(String(options?.body)));
      if (drop) { drop = false; throw new Error("synthetic lost response"); }
      return response({ accessToken: "access", refreshToken: "new-refresh", expiresIn: 300 });
    }
    assert.match(new Headers(options?.headers).get("authorization") ?? "", /^Bearer /);
    return response({ ok: true });
  };
  const client = new NativeSessionClient("https://example.invalid", saved.adapter, transport);
  await assert.rejects(client.restore(), NativeClientError);
  const pending = saved.value(); assert.ok(pending.actionId);
  await Promise.all([client.api("me"), client.api("me")]);
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(saved.value(), { refreshToken: "new-refresh" });
});
test("offline logout hervat nooit de oude sessie en handelt revocation af bij herstel", async () => {
  const saved = store(), requests: string[] = []; let online = false;
  const client = new NativeSessionClient("https://example.invalid", saved.adapter, async url => {
    requests.push(String(url)); if (!online) throw Error("offline"); return response({ ok: true });
  });
  await assert.rejects(client.logout()); assert.equal(saved.value().logoutPending, true);
  await assert.rejects(client.restore()); assert.equal(requests.some(url => url.endsWith("/refresh")), false);
  online = true; assert.equal(await client.restore(), false); assert.equal(saved.value(), null);
});
test("late loginresponse kan logout niet ongedaan maken", async () => {
  const saved = store(null), gate = Promise.withResolvers<Response>();
  const client = new NativeSessionClient("https://example.invalid", saved.adapter, async url => String(url).endsWith("/login") ? gate.promise : response({ ok: true }));
  const login = client.login("synthetic@example.invalid", "password");
  await client.logout();
  gate.resolve(response({ accessToken: "access", refreshToken: "new-refresh", expiresIn: 300 })); await assert.rejects(login, error => error instanceof NativeClientError && error.code === "session_changed");
  assert.equal(saved.value(), null);
});
test("verkeerd wachtwoord wordt niet als verlopen access-token opnieuw verstuurd", async () => {
  const saved = store(); let failed = 0, refreshes = 0;
  const client = new NativeSessionClient("https://example.invalid", saved.adapter, async url => {
    if (String(url).endsWith("/refresh")) { refreshes++; return response({ accessToken: "a", refreshToken: "r", expiresIn: 300 }); }
    failed++; return response({ error: "wrong_credentials" }, 401);
  });
  await assert.rejects(client.api("apple/challenge", { intent: "link", password: "wrong" }));
  assert.equal(failed, 1); assert.equal(refreshes, 1);
});
test("alleen exacte native origins; geen null, subdomeinen of credential-CORS", () => {
  for (const origin of ["capacitor://localhost", "https://localhost"]) assert.equal(nativeOriginAllowed(origin), true);
  for (const origin of [null, "null", "http://localhost", "https://localhost:443", "https://localhost.evil.invalid", "https://versado.app", "*"]) assert.equal(nativeOriginAllowed(origin), false);
});
test("local-development is lokaal; remote-preview blijft beschikbaar en release blijft geblokkeerd", () => {
  // Een lege tijdelijke uitvoermap houdt de test los van een eerder gebouwde (mogelijk ander) profiel in dist/native.
  const outdir = join(tmpdir(), `versado-foundation-profile-${process.pid}`);
  const run = (profile: string) => spawnSync(process.execPath, ["--import", "tsx", "-e", "import('./capacitor.config.ts').then(m=>console.log(JSON.stringify(m.default)))"], { encoding: "utf8", env: { ...process.env, NATIVE_BUILD_OUTDIR: outdir, CAPACITOR_BUILD_PROFILE: profile, CAPACITOR_SERVER_URL: profile === "remote-preview" ? "https://example.invalid" : "" } });
  const local = run("local-development"); assert.equal(local.status, 0, local.stderr); const config = JSON.parse(local.stdout.trim()); assert.equal(config.webDir, outdir); assert.equal(config.server.url, undefined);
  assert.equal(run("remote-preview").status, 0); assert.notEqual(run("release").status, 0);
});
test("native opslag is platformbeveiligd, ontbrekende configuratie geeft geen onveilige fallback", () => {
  const swift = readFileSync("ios/App/App/VersadoNativePlugin.swift", "utf8"), java = readFileSync("android/app/src/main/java/app/versado/app/VersadoNativePlugin.java", "utf8");
  assert.match(swift, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/); assert.match(swift, /localOnly/); assert.match(swift, /ASAuthorizationAppleIDProvider/);
  assert.match(java, /AndroidKeyStore/); assert.match(java, /AES\/GCM\/NoPadding/); assert.match(java, /localOnly/);
  for (const file of ["src/lib/native/client.ts", "src/lib/native/bridge.ts", "src/components/native/entry.tsx"]) assert.doesNotMatch(readFileSync(file,"utf8"), /localStorage\.|sessionStorage\./);
});

test("standaard browsertransport bewaart geen ongeldige fetch-receiver", async () => {
  const original = globalThis.fetch, saved = store();
  globalThis.fetch = async function(this: unknown) {
    assert.equal(this instanceof NativeSessionClient, false, "WebIDL fetch accepteert geen clientobject als receiver");
    return response({ accessToken: "access", refreshToken: "new-refresh", expiresIn: 300 });
  };
  try { assert.equal(await new NativeSessionClient("https://example.invalid", saved.adapter).restore(), true); }
  finally { globalThis.fetch = original; }
});
test("falen van beveiligde opslag geeft geen ingelogde status en trekt uitgegeven sessie in", async () => {
  const paths: string[] = [];
  const client = new NativeSessionClient("https://example.invalid", {
    async read() { return null; }, async write() { throw new NativeClientError("secure_storage_unavailable"); }, async clear() {},
  }, async url => { paths.push(String(url)); return response(String(url).endsWith("/login") ? { accessToken: "access", refreshToken: "new-refresh", expiresIn: 300 } : { ok: true }); });
  await assert.rejects(client.login("synthetic@example.invalid", "password"), /secure_storage_unavailable/);
  assert.equal(paths.filter(path => path.endsWith("/logout")).length, 1);
  assert.equal(await client.restore(), false);
});

test("logoutbevestiging volgt pas na duurzame opslag, ook bij traag platform en netwerkverlies", async () => {
  const gate = Promise.withResolvers<void>();
  let raw: string | null = JSON.stringify({ refreshToken: "original-refresh" }), committed = false;
  const client = new NativeSessionClient("https://example.invalid", {
    async read() { return raw; },
    async write(value) { await gate.promise; raw = value; },
    async clear() { raw = null; },
  }, async () => { throw new Error("offline"); });
  const logout = client.logout(() => { committed = true; assert.equal(JSON.parse(raw!).logoutPending, true); });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(committed, false, "nog geen uitlogbevestiging terwijl Keychain-write niet klaar is");
  gate.resolve(); await assert.rejects(logout, /network_unavailable/);
  assert.equal(committed, true); assert.equal(JSON.parse(raw!).logoutPending, true);
  assert.equal(await new NativeSessionClient("https://example.invalid", {
    async read() { return raw; }, async write(value) { raw = value; }, async clear() { raw = null; },
  }, async url => { assert.ok(String(url).endsWith("/logout"), "heropenen hervat geen oude sessie");return response({ok:true}); }).restore(), false);
});

test("laat bevestigde logout wist nooit een later ingelogd account", async () => {
  const saved = store(), started = Promise.withResolvers<void>(), release = Promise.withResolvers<Response>();
  const client = new NativeSessionClient("https://example.invalid", saved.adapter, async (url, options) => {
    if (String(url).endsWith("/login")) return response({ accessToken: "account-b-access", refreshToken: "account-b-refresh", expiresIn: 300 });
    if (String(url).endsWith("/logout") && JSON.parse(String(options?.body)).refreshToken === "old-refresh") { started.resolve(); return release.promise; }
    return response({ ok: true });
  });
  const logout = client.logout();
  await started.promise;
  await client.login("b@example.invalid", "password");
  release.resolve(response({ ok: true })); await logout;
  assert.equal(saved.value()?.refreshToken, "account-b-refresh");
  assert.notEqual(saved.value()?.logoutPending, true);
});

test("data uit de vorige accountsessie bereikt de nieuwe accountweergave niet", async () => {
  const saved = store(), started = Promise.withResolvers<void>(), release = Promise.withResolvers<Response>();
  const client = new NativeSessionClient("https://example.invalid", saved.adapter, async url => {
    if (String(url).endsWith("/refresh")) return response({ accessToken: "account-a-access", refreshToken: "account-a-refresh", expiresIn: 300 });
    if (String(url).endsWith("/login")) return response({ accessToken: "account-b-access", refreshToken: "account-b-refresh", expiresIn: 300 });
    if (String(url).endsWith("/me")) { started.resolve(); return release.promise; }
    return response({ ok: true });
  });
  await client.restore();
  const data = client.api("me");
  await started.promise; await client.login("b@example.invalid", "password");
  release.resolve(response({ id: "account-a", handle: "A" }));
  await assert.rejects(data, error => error instanceof NativeClientError && error.code === "session_changed");
});

test("een verzoek dat op oude refresh wacht wordt niet met het token van het nieuwe account verzonden", async () => {
  const saved = store(), started = Promise.withResolvers<void>(), release = Promise.withResolvers<Response>();
  const headers: string[] = [];
  const client = new NativeSessionClient("https://example.invalid", saved.adapter, async (url, options) => {
    if (String(url).endsWith("/refresh")) { started.resolve(); return release.promise; }
    if (String(url).endsWith("/login")) return response({ accessToken: "account-b-access", refreshToken: "account-b-refresh", expiresIn: 300 });
    if (String(url).endsWith("/chapters/account-a-chapter/complete")) headers.push(new Headers(options?.headers).get("authorization") ?? "");
    return response({ ok: true });
  });
  const stale = client.api("chapters/account-a-chapter/complete", {});
  await started.promise; await client.login("b@example.invalid", "password");
  release.resolve(response({ accessToken: "account-a-access", refreshToken: "account-a-refresh", expiresIn: 300 }));
  await assert.rejects(stale, error => error instanceof NativeClientError && error.code === "session_changed");
  assert.deepEqual(headers, [], "oude intentie mag het nieuwe account niet muteren");
});

test("een vertraagde provider-login na logout wordt ingetrokken en niet hervat", async () => {
  const saved = store(null), provider = Promise.withResolvers<unknown>();
  const retired: string[] = [];
  const client = new NativeSessionClient("https://example.invalid", saved.adapter, async (url, options) => {
    assert.ok(String(url).endsWith("/logout")); retired.push(JSON.parse(String(options?.body)).refreshToken);
    return response({ ok: true });
  });
  const login = client.authenticate(() => provider.promise);
  await client.logout();
  provider.resolve({ accessToken: "late-apple-access", refreshToken: "late-apple-refresh" });
  await assert.rejects(login, error => error instanceof NativeClientError && error.code === "session_changed");
  assert.equal(saved.value(), null); assert.deepEqual(retired, ["late-apple-refresh"]);
});

test("oude offline uitlogintentie overleeft accountwissel en heropening", async () => {
  const saved = store(), retired: { refreshToken: string; actionId: string }[] = [];
  const client = new NativeSessionClient("https://example.invalid", saved.adapter, async url => {
    if (String(url).endsWith("/login")) return response({ accessToken: "b-access", refreshToken: "b-refresh" });
    throw Error("synthetic offline logout");
  });
  await assert.rejects(client.logout());
  const actionId = saved.value().actionId;
  await client.login("b@example.invalid", "password");
  assert.equal(saved.value().refreshToken, "b-refresh");
  assert.ok(saved.value().pendingRevocations.some((item: { refreshToken: string; actionId: string }) => item.refreshToken === "old-refresh" && item.actionId === actionId));
  const reopened = new NativeSessionClient("https://example.invalid", saved.adapter, async (url, options) => {
    if (String(url).endsWith("/logout")) { retired.push(JSON.parse(String(options?.body))); return response({ ok: true }); }
    assert.ok(String(url).endsWith("/refresh"));
    assert.equal(JSON.parse(String(options?.body)).refreshToken, "b-refresh");
    return response({ accessToken: "b-new-access", refreshToken: "b-new-refresh" });
  });
  assert.equal(await reopened.restore(), true);
  // De intrekkingsqueue is bewust onafhankelijk van het ophalen van data.
  for (let i = 0; i < 20 && saved.value()?.pendingRevocations?.length; i++) await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(retired, [{ refreshToken: "old-refresh", actionId }]);
  assert.deepEqual(saved.value(), { refreshToken: "b-new-refresh" });
});

test("authenticatie die nog loopt mag geen oude sessie voor een nieuwe actie gebruiken", async () => {
  const saved = store(), provider = Promise.withResolvers<unknown>();
  const calls: string[] = [];
  const client = new NativeSessionClient("https://example.invalid", saved.adapter, async url => { calls.push(String(url)); return response({ ok: true }); });
  const login = client.authenticate(() => provider.promise);
  await assert.rejects(client.api("chapters/old/complete", {}), error => error instanceof NativeClientError && error.code === "authentication_in_progress");
  assert.deepEqual(calls, []);
  provider.resolve({ accessToken: "b-access", refreshToken: "b-refresh" }); await login;
});

test("generatiewissel tijdens Keychain-write maakt de late sessie duurzaam ongeldig", async () => {
  let raw: string | null = null, block = true;
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const saved: SecureSessionStore = {
    async read() { return raw; },
    async write(value) { if (block) { block = false; started.resolve(); await release.promise; } raw = value; },
    async clear() { raw = null; },
  };
  const client = new NativeSessionClient("https://example.invalid", saved, async url => {
    if (String(url).endsWith("/login")) return response({ error: "wrong_credentials" }, 401);
    throw Error("offline revocation");
  });
  const old = client.authenticate(async () => ({ accessToken: "a-access", refreshToken: "a-refresh" }));
  await started.promise;
  await assert.rejects(client.login("b@example.invalid", "wrong"));
  release.resolve();
  await assert.rejects(old, error => error instanceof NativeClientError && error.code === "session_changed");
  assert.equal(JSON.parse(raw!).logoutPending, true);
  let refreshes = 0;
  const reopened = new NativeSessionClient("https://example.invalid", saved, async url => { if (String(url).endsWith("/refresh")) refreshes++; return response({ ok: true }); });
  assert.equal(await reopened.restore(), false); assert.equal(refreshes, 0); assert.equal(raw, null);
});

function setupResponse() { return { securitySetup: { token: `${crypto.randomUUID()}.${'A'.repeat(43)}`, step: 'password' as const, expiresAt: new Date(Date.now() + 300_000).toISOString() } }; }
test("accountdatapoort beëindigt alleen een werkelijk verlopen sessie, niet een fout herauthenticatiewachtwoord", async () => {
  let stored: string | null = null, code = 'wrong_credentials', status = 401, expired = 0;
  const client = new NativeSessionClient('https://example.invalid', { async read() { return stored; }, async write(value) { stored = value; }, async clear() { stored = null; } }, async url => String(url).endsWith('/login') ? response({ accessToken: 'access', refreshToken: 'refresh' }) : response({ error: code }, status));
  await client.login('a', 'password'); const actions = nativeAccountActions(client, () => expired++);
  await assert.rejects(actions.changePassword({ currentPassword: 'wrong', newPassword: 'New-password-42' })); assert.equal(expired, 0);
  code = 'session_changed'; await assert.rejects(actions.changePassword({ currentPassword: 'password', newPassword: 'New-password-42' })); assert.equal(expired, 1);
  status = 409; await assert.rejects(actions.changePassword({ currentPassword: 'password', newPassword: 'New-password-42' })); assert.equal(expired, 1, 'Een afgebroken oude generatie logt het nieuwe account niet uit');
});
test("setupbewijs is nooit een hervatbare sessie en wordt bij heropening ingetrokken", async () => {
  let stored: string | null = null; const paths: string[] = [], setup = setupResponse();
  const store = { async read() { return stored; }, async write(value: string) { stored = value; }, async clear() { stored = null; } };
  const transport: typeof fetch = async url => { const path = String(url).split('/api/v1/native/')[1]; paths.push(path); return response(path === 'login' ? setup : { ok: true }); };
  const client = new NativeSessionClient('https://example.invalid', store, transport);
  assert.equal((await client.login('account', 'password', undefined, true)).securitySetup?.token, setup.securitySetup.token);
  await assert.rejects(client.api('me'), error => error instanceof NativeClientError && error.code === 'session_expired');
  assert.equal(JSON.parse(stored!).logoutPending, true); assert.equal(JSON.parse(stored!).kind, 'setup');
  assert.equal(paths.includes('security-setup/cancel'), false, 'De actieve geheugenflow wordt niet voortijdig ingetrokken');
  assert.equal(await new NativeSessionClient('https://example.invalid', store, transport).restore(), false);
  assert.equal(stored, null); assert.deepEqual(paths, ['login', 'security-setup/cancel']);
});
test("laat setupantwoord kan een nieuwer ingelogd account niet intrekken", async () => {
  let stored: string | null = null; const gate = Promise.withResolvers<Response>(), setup = setupResponse(); let logins = 0;
  const client = new NativeSessionClient('https://example.invalid', { async read() { return stored; }, async write(value) { stored = value; }, async clear() { stored = null; } }, async url => {
    if (String(url).endsWith('/login')) return ++logins === 1 ? gate.promise : response({ accessToken: 'b-access', refreshToken: 'b-refresh' });
    return response({ ok: true });
  });
  const old = client.login('a', 'password', undefined, true); await client.login('b', 'password');
  gate.resolve(response(setup)); await assert.rejects(old, error => error instanceof NativeClientError && error.code === 'session_changed');
  assert.equal(JSON.parse(stored!).refreshToken, 'b-refresh'); assert.notEqual(JSON.parse(stored!).logoutPending, true);
});
test("offline annulering van setup blijft duurzaam tot bevestigde intrekking", async () => {
  let stored: string | null = null, online = true; const paths: string[] = [], setup = setupResponse();
  const store = { async read() { return stored; }, async write(value: string) { stored = value; }, async clear() { stored = null; } };
  const transport: typeof fetch = async url => { const path = String(url).split('/api/v1/native/')[1]; paths.push(path); if (!online) throw Error('synthetic offline'); return response(path === 'login' ? setup : { ok: true }); };
  const client = new NativeSessionClient('https://example.invalid', store, transport); await client.login('a', 'password', undefined, true);
  online = false; await assert.rejects(client.logout()); assert.equal(JSON.parse(stored!).kind, 'setup');
  online = true; assert.equal(await new NativeSessionClient('https://example.invalid', store, transport).restore(), false);
  assert.equal(stored, null); assert.equal(paths.includes('refresh'), false);
});
test("een foutieve setupcode kan worden gecorrigeerd; alleen de volledige uitkomst wordt als sessie opgeslagen", async () => {
  let stored: string | null = null, attempts = 0; const setup = setupResponse();
  const client = new NativeSessionClient('https://example.invalid', { async read() { return stored; }, async write(value) { stored = value; }, async clear() { stored = null; } }, async (url, init) => {
    if (String(url).endsWith('/login')) return response(setup);
    if (String(url).endsWith('/security-setup/complete')) {
      assert.equal(JSON.parse(String(init?.body)).challengeToken, setup.securitySetup.token);
      return ++attempts === 1 ? response({ error: 'wrong_code' }, 400) : response({ accessToken: 'complete-access', refreshToken: 'complete-refresh', recoveryCodes: ['ABCDE-12345'] });
    }
    return response({ ok: true });
  });
  await client.login('a', 'password', undefined, true); await assert.rejects(client.completeSecuritySetup({ code: '000000' }));
  assert.deepEqual((await client.completeSecuritySetup({ code: '123456' })).recoveryCodes, ['ABCDE-12345']);
  assert.equal(JSON.parse(stored!).refreshToken, 'complete-refresh'); assert.equal(JSON.stringify(stored).includes('ABCDE-12345'), false);
});

test("native reset gebruikt geen sessie, cookies, refresh of platformopslag en accepteert geen loginresponse", async () => {
  const saved = store(null), calls: string[] = [];
  let reply: unknown = { ok: true, reauthenticationRequired: true };
  const client = new NativeSessionClient("https://example.invalid", saved.adapter, async (url, init) => {
    calls.push(String(url)); assert.equal(init?.credentials, "omit"); assert.equal(init?.headers && new Headers(init.headers).has("authorization"), false);
    return response(reply);
  });
  const actions = nativePasswordResetActions(client);
  assert.deepEqual(await actions.reset({ token: "R".repeat(43), newPassword: "Synthetic-reset-42" }), {});
  assert.deepEqual(calls, ["https://example.invalid/api/v1/native/reset-password"]); assert.equal(saved.value(), null);
  reply = { accessToken: "unexpected", refreshToken: "unexpected", expiresIn: 300 };
  await assert.rejects(actions.reset({ token: "R".repeat(43), newPassword: "Synthetic-reset-42" })); assert.equal(saved.value(), null);
});

test("native bevestiging gebruikt uitsluitend een publiek statuscontract zonder sessieopslag", async () => {
  const saved = store(null);let result: unknown = { status: "confirmed" };
  const client = new NativeSessionClient("https://example.invalid", saved.adapter, async (url, init) => {
    assert.equal(String(url), "https://example.invalid/api/v1/native/verify-email");assert.equal(init?.credentials, "omit");assert.equal(new Headers(init?.headers).has("authorization"), false);return response(result);
  });
  assert.equal(await confirmNativeEmail(client, "V".repeat(43)), "confirmed");assert.equal(saved.value(), null);
  result = { status: "confirmed", user: { email: "unexpected@example.invalid" } };await assert.rejects(confirmNativeEmail(client, "V".repeat(43)));
  assert.equal(saved.value(), null);
});
