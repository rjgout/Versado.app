import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as profiles from "../scripts/native/profiles.cjs";
import { NativeClientError, NativeSessionClient, type SecureSessionStore } from "../src/lib/native/client";
import { NativeSocketConnection } from "../src/lib/native/socketClient";
import { INTERNAL_ACCESS_ORIGIN, nativeAccessTransport, type NativeAccessBridge } from "../src/lib/native/access";

const buildEnv = (values: Record<string, string> = {}): NodeJS.ProcessEnv => ({ NODE_ENV: "test", ...values });
const base = `${INTERNAL_ACCESS_ORIGIN}/api/v1/native/`;
const credentialsError = (error: unknown) => error instanceof NativeClientError && error.code === "access_denied" && error.status === 0;
function savedSession() {
  let value: string | null = JSON.stringify({ refreshToken: "existing-refresh-token" });
  const store: SecureSessionStore = { async read() { return value; }, async write(next) { value = next; }, async clear() { value = null; } };
  return { store, value: () => value ? JSON.parse(value) : null };
}
function bridge(handler: NativeAccessBridge["accessRequest"]): NativeAccessBridge {
  return { async accessStatus() { return { enabled: true, configured: false }; }, async enrollAccess() { return { changed: true }; }, async clearAccess() { return { changed: true }; }, accessRequest: handler };
}
test("expliciete interne Access-vlag accepteert alleen echte dev-origin, geen andere profielen of bouwgeheimen", () => {
  const resolved = profiles.resolveBuildProfile(buildEnv({ CAPACITOR_BUILD_PROFILE: "local-internal", NATIVE_API_BASE_URL: INTERNAL_ACCESS_ORIGIN }));
  assert.equal(profiles.internalAccessEnabled(resolved, buildEnv()), false);
  assert.equal(profiles.internalAccessEnabled(resolved, buildEnv({ NATIVE_INTERNAL_ACCESS: "1" })), true);
  for (const change of [{ profile: "local-development" }, { profile: "local-store-test" }, { profile: "release" }, { apiOrigin: "https://versado.app" }, { apiOrigin: "https://example.invalid" }, { compileProbe: true }, { channel: "testflight" }]) {
    assert.throws(() => profiles.internalAccessEnabled({ ...resolved, ...change }, buildEnv({ NATIVE_INTERNAL_ACCESS: "1" })));
  }
  assert.throws(() => profiles.internalAccessEnabled(resolved, buildEnv({ NATIVE_INTERNAL_ACCESS: "true" })));
  for (const key of ["CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET", "CF-Access-Client-Id", "CF-Access-Client-Secret"]) {
    assert.throws(() => profiles.internalAccessEnabled(resolved, buildEnv({ [key]: "synthetic-forbidden-build-input" })), /verboden als bouwinvoer/);
  }
});
test("native transport ontvangt alleen route, methode, body en Versado-Bearer; geen Cloudflare-headers", async () => {
  const calls: unknown[] = [];
  const transport = nativeAccessTransport(bridge(async options => { calls.push(options); return { status: 200, body: '{"ok":true}' }; }));
  assert.deepEqual(await (await transport(base + "account/password", { method: "POST", credentials: "omit", redirect: "error", headers: { Authorization: "Bearer synthetic.native", "X-Versado-Client": "native-v1", "Content-Type": "application/json" }, body: "{}" })).json(), { ok: true });
  assert.deepEqual(calls, [{ path: "account/password", method: "POST", authorization: "Bearer synthetic.native", body: "{}" }]);
  assert.doesNotMatch(JSON.stringify(calls), /CF-Access|Cookie|secret/i);
});
test("willekeurige origins, routes, traversal, query en redirects krijgen nooit toegang tot de bridge", async () => {
  let calls = 0;
  const transport = nativeAccessTransport(bridge(async () => { calls++; return { status: 200, body: "{}" }; }));
  for (const url of ["https://versado.app/api/v1/native/me", "http://dev.versado.app/api/v1/native/me", "https://dev.versado.app:443/api/v1/native/me", "https://user@dev.versado.app/api/v1/native/me", base + "../admin/users", base + "%2e%2e/me", base + "me?url=https://evil.invalid", base + "me#x", base + "chapters/../me", base + "realtime/session"]) {
    await assert.rejects(transport(url), /access_request_invalid/);
  }
  for (const options of [{ redirect: "follow" as const }, { credentials: "include" as const }, { method: "PUT" }, { headers: { "CF-Access-Client-Secret": "synthetic-only" } }, { method: "POST", body: "😀".repeat(5000) }]) {
    await assert.rejects(transport(base + "me", options), /access_request_invalid/);
  }
  assert.equal(calls, 0);
});
test("ontbrekende, ongeldige en ingetrokken Access blokkeren zonder de Versado-refreshstaat te wissen", async () => {
  for (const code of ["access_missing", "access_denied", "access_storage_unavailable", "access_changed", "access_network_unavailable", "access_redirect_blocked"]) {
    const saved = savedSession();
    const client = new NativeSessionClient(INTERNAL_ACCESS_ORIGIN, saved.store, nativeAccessTransport(bridge(async () => { throw new Error(code); })), false);
    await assert.rejects(client.restore(), (error: unknown) => error instanceof NativeClientError && error.code === code && error.status === 0);
    assert.equal(saved.value().refreshToken, "existing-refresh-token");
    assert.ok(saved.value().actionId);
  }
});
test("edge-JSON-401 is geen verlopen Versado-sessie; een echte backend-session_expired behoudt zijn betekenis", async () => {
  for (const error of ["access_denied", "service_token_invalid", "session_expired"]) {
    const saved = savedSession();
    const client = new NativeSessionClient(INTERNAL_ACCESS_ORIGIN, saved.store, nativeAccessTransport(bridge(async () => ({ status: 401, body: JSON.stringify({ error }) }))), false);
    if (error === "session_expired") { await assert.rejects(client.restore(), /session_expired/); assert.equal(saved.value(), null); }
    else { await assert.rejects(client.restore(), credentialsError); assert.equal(saved.value().refreshToken, "existing-refresh-token"); }
  }
});
test("na herstelde Access gebruikt retry dezelfde refresh-actionId en werkt bestaande sessierotatie", async () => {
  const saved = savedSession(), calls: unknown[] = []; let denied = true;
  const client = new NativeSessionClient(INTERNAL_ACCESS_ORIGIN, saved.store, nativeAccessTransport(bridge(async options => {
    calls.push(JSON.parse(options.body!));
    if (denied) throw new Error("access_denied");
    return { status: 200, body: JSON.stringify({ accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 300 }) };
  })), false);
  await assert.rejects(client.restore(), credentialsError); denied = false;
  assert.equal(await client.restore(), true); assert.deepEqual(calls[0], calls[1]); assert.equal(saved.value().refreshToken, "new-refresh");
});
test("logout bij ingetrokken Access blijft duurzaam en wordt na herstelde toegang afgehandeld", async () => {
  const saved = savedSession(); let denied = true; const calls: string[] = [];
  const client = new NativeSessionClient(INTERNAL_ACCESS_ORIGIN, saved.store, nativeAccessTransport(bridge(async options => {
    calls.push(options.path); if (denied) throw new Error("access_denied"); return { status: 200, body: '{"ok":true}' };
  })), false);
  await assert.rejects(client.logout(), credentialsError); assert.equal(saved.value().logoutPending, true);
  denied = false; assert.equal(await client.restore(), false); assert.equal(saved.value(), null); assert.deepEqual(calls, ["logout", "logout"]);
});
test("realtime voor interne Access is fail-closed vóór ticket en WebSocket-factory; gewone native blijft beschikbaar", () => {
  let calls = 0; const saved = savedSession();
  const client = new NativeSessionClient(INTERNAL_ACCESS_ORIGIN, saved.store, nativeAccessTransport(bridge(async () => { calls++; throw new Error(); })), false);
  assert.throws(() => new NativeSocketConnection(client, undefined, () => { calls++; throw new Error(); }), /access_realtime_unavailable/);
  assert.equal(calls, 0); assert.equal(new NativeSessionClient(INTERNAL_ACCESS_ORIGIN, saved.store).realtimeSupported, true);
});
test("native foutdetails, HTML en onverwachte bridgevelden worden niet aan de UI doorgegeven", async () => {
  const transport = nativeAccessTransport(bridge(async () => { throw new Error("synthetic-private-native-diagnostic"); }));
  await assert.rejects(transport(base + "capabilities"), (error: unknown) => error instanceof NativeClientError && error.message === "access_unavailable");
  await assert.rejects(nativeAccessTransport(bridge(async () => ({ status: 200, body: "<html>Access login</html>" })))(base + "capabilities"), /access_invalid_response/);
  const controller = new AbortController(); controller.abort(); let called = false;
  await assert.rejects(nativeAccessTransport(bridge(async () => { called = true; return { status: 200, body: "{}" }; }))(base + "capabilities", { signal: controller.signal }), /access_network_unavailable/); assert.equal(called, false);
});
test("bridge biedt geen credentialgetter of JS-credentialenrollment; opslag is platformgescheiden", () => {
  const bridgeSource = readFileSync("src/lib/native/access.ts", "utf8");
  assert.match(bridgeSource, /enrollAccess\(options: \{ language: string \}\)/);
  assert.doesNotMatch(bridgeSource, /CF-Access-Client-(Id|Secret)|localStorage|sessionStorage/);
  const swift = readFileSync("ios/App/App/VersadoNativePlugin.swift", "utf8"), java = readFileSync("android/app/src/main/java/app/versado/app/VersadoNativePlugin.java", "utf8");
  assert.match(swift, /app\.versado\.native\.cloudflare\.v1/); assert.match(swift, /kSecAttrAccessibleWhenUnlockedThisDeviceOnly/);
  assert.match(java, /versado-native-cloudflare-v1/); assert.match(java, /AES\/GCM\/NoPadding/);
  assert.match(java, /requestedEpoch != accessEpoch/);
});

test("de bestaande AbortSignal-timeout wacht niet op een vertraagde native response", async () => {
  let complete!: (value: { status: number; body: string }) => void;
  const controller = new AbortController();
  const transport = nativeAccessTransport(bridge(() => new Promise(resolve => { complete = resolve; })));
  const request = transport(base + "capabilities", { signal: controller.signal });
  controller.abort(); await assert.rejects(request, /access_network_unavailable/);
  complete({ status: 200, body: "{}" }); // Een late native callback herstelt de afgebroken aanvraag niet.
});
