import assert from "node:assert/strict";
import test from "node:test";
import { NativeClientError, NativeSessionClient, type SecureSessionStore } from "../src/lib/native/client";

// Doel: een schrijfactie (actionOnce) wordt na een 401 nooit herhaald, dus het
// toegangstoken (300 s) moet vóór het verzenden worden ververst als het bijna
// verloopt. De transport-dummy gedraagt zich als de server: een token ouder
// dan 300 s krijgt 401 session_expired.
function setup() {
  let value: string | null = JSON.stringify({ refreshToken: "refresh-0" });
  const store: SecureSessionStore = { async read() { return value; }, async write(n) { value = n; }, async clear() { value = null; } };
  let now = 1_000_000, serial = 0;
  const issued = new Map<string, number>();
  const log: string[] = [];
  const transport = (async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).split("/api/v1/native/")[1];
    const auth = (init?.headers as Record<string, string>)?.Authorization?.slice(7);
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (path === "refresh") {
      const token = `access-${++serial}`; issued.set(token, now); log.push("refresh");
      return reply(200, { accessToken: token, refreshToken: `refresh-${serial}`, expiresIn: 300 });
    }
    log.push(path);
    if (!auth || now - (issued.get(auth) ?? -Infinity) >= 300_000) return reply(401, { error: "session_expired" });
    return reply(200, { ok: true });
  }) as typeof fetch;
  const realNow = Date.now;
  Date.now = () => now;
  return { client: new NativeSessionClient("https://example.test", store, transport, false), log, advance(ms: number) { now += ms; }, restore() { Date.now = realNow; } };
}

test("schrijfactie na 4+ minuten stilte ververst eerst en wordt precies één keer verzonden", async () => {
  const t = setup();
  try {
    assert.equal(await t.client.restore(), true);
    t.advance(250_000);
    assert.deepEqual(await t.client.actionOnce("friends/accept", { id: "x" }), { ok: true });
    assert.deepEqual(t.log, ["refresh", "refresh", "friends/accept"]);
  } finally { t.restore(); }
});

test("vers token wordt niet onnodig ververst", async () => {
  const t = setup();
  try {
    await t.client.restore(); t.advance(10_000);
    await t.client.actionOnce("friends/accept", {});
    assert.deepEqual(t.log, ["refresh", "friends/accept"]);
  } finally { t.restore(); }
});

test("een 401 op de schrijfactie zelf (ingetrokken sessie) wordt nooit herhaald", async () => {
  let value: string | null = JSON.stringify({ refreshToken: "refresh-0" });
  const store: SecureSessionStore = { async read() { return value; }, async write(n) { value = n; }, async clear() { value = null; } };
  const calls: string[] = [];
  const transport = (async (input: string | URL | Request) => {
    const path = String(input).split("/api/v1/native/")[1]; calls.push(path);
    if (path === "refresh") return new Response(JSON.stringify({ accessToken: "t", refreshToken: "r1", expiresIn: 300 }), { status: 200 });
    return new Response(JSON.stringify({ error: "session_expired" }), { status: 401 });
  }) as typeof fetch;
  const client = new NativeSessionClient("https://example.test", store, transport, false);
  await client.restore();
  await assert.rejects(client.actionOnce("friends/accept", {}), (e: unknown) => e instanceof NativeClientError && e.status === 401);
  assert.equal(calls.filter(p => p === "friends/accept").length, 1);
  assert.deepEqual(calls, ["refresh", "friends/accept"]);
});

test("na een mislukte verversing door netwerkfout met nog geldig token wordt het oude token gebruikt", async () => {
  let value: string | null = JSON.stringify({ refreshToken: "refresh-0" });
  const store: SecureSessionStore = { async read() { return value; }, async write(n) { value = n; }, async clear() { value = null; } };
  let now = 5_000_000, refreshes = 0, offline = false;
  const realNow = Date.now; Date.now = () => now;
  const transport = (async (input: string | URL | Request) => {
    const path = String(input).split("/api/v1/native/")[1];
    if (path === "refresh") { if (offline) throw new TypeError("offline"); refreshes++; return new Response(JSON.stringify({ accessToken: "t", refreshToken: `r${refreshes}`, expiresIn: 300 }), { status: 200 }); }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const client = new NativeSessionClient("https://example.test", store, transport, false);
    await client.restore();
    now += 250_000; offline = true;
    assert.deepEqual(await client.api("me"), { ok: true });
    now += 60_000; // nu echt verlopen: de fout moet zichtbaar worden
    await assert.rejects(client.api("me"), (e: unknown) => e instanceof NativeClientError && e.code === "network_unavailable");
  } finally { Date.now = realNow; }
});
