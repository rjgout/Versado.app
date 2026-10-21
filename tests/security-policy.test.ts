import test from "node:test";
import assert from "node:assert/strict";
import { applicationOrigin, getBaseUrl } from "../src/lib/baseUrl";
import { requestSecurityError } from "../src/lib/requestSecurity";
import { isAllowedPushEndpoint } from "../src/lib/pushEndpoint";
import { NextRequest } from "next/server";
import { boundedJson } from "../src/lib/requestBody";

test("e-maillinks negeren Host en forwarded-headers; productie faalt zonder canonieke URL", () => {
  const previous = { APP_URL: process.env.APP_URL, NODE_ENV: process.env.NODE_ENV };
  try {
    process.env.APP_URL = "https://versado.example";
    const request = new NextRequest("https://attacker.invalid/", { headers: { host: "attacker.invalid", "x-forwarded-host": "attacker.invalid", "x-forwarded-proto": "http" } });
    assert.equal(getBaseUrl(request), "https://versado.example");
    for (const value of ["http://public.example", "https://user:pass@public.example", "https://public.example/path", "https://public.example/#fragment"]) {
      process.env.APP_URL = value; assert.throws(applicationOrigin);
    }
    delete process.env.APP_URL; Object.assign(process.env, { NODE_ENV: "production" });
    assert.throws(applicationOrigin, /APP_URL/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("push weigert interne adressen, lookalikes, credentials, andere protocollen en poorten", () => {
  for (const url of ["https://fcm.googleapis.com/fcm/send/token", "https://updates.push.services.mozilla.com/wpush/v2/token", "https://web.push.apple.com/token", "https://wns2.notify.windows.com/token"]) assert.ok(isAllowedPushEndpoint(url), url);
  for (const url of ["https://127.0.0.1/private", "https://[::1]/", "https://169.254.169.254/", "https://10.0.0.1/", "http://fcm.googleapis.com/", "https://fcm.googleapis.com:444/", "https://fcm.googleapis.com.attacker.invalid/", "https://attacker.invalid/?fcm.googleapis.com", "https://user@fcm.googleapis.com/", "https://fcm.googleapis.com/#fragment"]) assert.equal(isAllowedPushEndpoint(url), false, url);
});

test("webmutaties controleren origin en JSON, met expliciete native- en RFC8058-uitzonderingen", () => {
  const previous = process.env.APP_URL; process.env.APP_URL = "https://versado.example";
  try {
    const check = (headers: Record<string, string>, path = "/api/account") => requestSecurityError("PATCH", path, new Headers(headers));
    assert.equal(check({ origin: "https://versado.example", "content-type": "application/json" }), null);
    assert.equal(check({ origin: "https://other.versado.example", "content-type": "application/json" }), 403);
    assert.equal(check({ origin: "null" }), 403);
    assert.equal(check({ "sec-fetch-site": "cross-site" }), 403);
    assert.equal(check({ "sec-fetch-site": "same-site" }), 403);
    assert.equal(check({ origin: "https://versado.example", "content-type": "text/plain" }), 415);
    assert.equal(check({ origin: "capacitor://localhost" }, "/api/v1/native/login"), null);
    assert.equal(check({ "content-type": "application/x-www-form-urlencoded" }, "/api/unsubscribe"), null);
  } finally { if (previous === undefined) delete process.env.APP_URL; else process.env.APP_URL = previous; }
});

test("JSON-lezer begrenst ook chunked bodies zonder Content-Length", async () => {
  const data = new TextEncoder().encode(JSON.stringify({ value: "x".repeat(20_000) }));
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(data.slice(0, 8000)); controller.enqueue(data.slice(8000)); controller.close();
  } });
  const request = new Request("https://versado.example/api/auth/register", { method: "POST", body, duplex: "half" } as RequestInit);
  assert.equal(await boundedJson(request), null);
  assert.deepEqual(await boundedJson(new Request("https://versado.example", { method: "POST", body: '{"value":1}' })), { value: 1 });
});
