import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from "jose";
import { verifyAppleIdentity } from "../src/lib/native/apple";
import { NativeSessionClient, NativeClientError, type SecureSessionStore } from "../src/lib/native/client";
import { nativeOriginAllowed } from "../src/lib/native/api";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

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
  gate.resolve(response({ accessToken: "access", refreshToken: "new-refresh", expiresIn: 300 })); await login;
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
  const run = (profile: string) => spawnSync(process.execPath, ["--import", "tsx", "-e", "import('./capacitor.config.ts').then(m=>console.log(JSON.stringify(m.default)))"], { encoding: "utf8", env: { ...process.env, CAPACITOR_BUILD_PROFILE: profile, CAPACITOR_SERVER_URL: profile === "remote-preview" ? "https://example.invalid" : "" } });
  const local = run("local-development"); assert.equal(local.status, 0, local.stderr); const config = JSON.parse(local.stdout.trim()); assert.equal(config.webDir, "dist/native"); assert.equal(config.server.url, undefined);
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
