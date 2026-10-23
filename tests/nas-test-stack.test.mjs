import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { check, evaluate } from "../scripts/native/check-test-backend.mjs";

const compose = readFileSync("deploy/test-stack/docker-compose.yml", "utf8");
const example = readFileSync("deploy/test-stack/.env.native-test.example", "utf8");
const code = compose.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");

test("de teststack deelt niets met productie: eigen namen, netwerk, volumes; geen docker.sock, geen NAS-paden, geen agent", () => {
  assert.doesNotMatch(code, /docker\.sock/);
  assert.doesNotMatch(code, /\/volume\d/, "geen bind mounts op NAS-productiepaden");
  assert.doesNotMatch(code, /jehova-deploy|DEPLOY_AGENT/, "geen deploy-agent in de teststack");
  for (const match of code.matchAll(/container_name:\s*(\S+)/g)) assert.match(match[1], /^versado-test-/, `containernaam ${match[1]}`);
  assert.equal([...code.matchAll(/container_name:/g)].length, 4);
  for (const volume of ["versado_test_postgres", "versado_test_audio", "versado_test_study_media"]) assert.match(code, new RegExp(`^  ${volume}:`, "m"));
  assert.doesNotMatch(code, /^\s+-\s+(?!versado_test_)[a-z_]+:\/(data|var)/m, "alleen eigen benoemde volumes");
  assert.match(code, /versado-test-internal:\n\s+internal: true/, "intern netwerk voor database en Redis");
});

test("database, Redis en app zijn niet gepubliceerd; alleen de proxy publiceert een door de eigenaar gekozen poort", () => {
  const services = code.split(/\n  (?=versado-test-\w+:\n)/).slice(1).filter((chunk) => /^versado-test-(proxy|app|db|redis):/.test(chunk));
  assert.equal(services.length, 4);
  for (const service of services) {
    const name = /^versado-test-\w+/.exec(service)[0];
    const published = /\n\s+ports:/.test(service);
    assert.equal(published, name === "versado-test-proxy", `${name}: poortpublicatie`);
  }
  assert.match(code, /"\$\{TEST_PROXY_PORT:\?/, "geen standaardpoort");
});

test("elk geheim en elke omgeving is verplicht ingesteld (:?), zonder placeholder, zonder productie-origin of verzonnen domein", () => {
  for (const variable of ["TEST_POSTGRES_PASSWORD", "TEST_REDIS_PASSWORD", "TEST_SESSION_SECRET", "TEST_NATIVE_SESSION_SECRET", "TEST_APP_URL", "APP_IMAGE_TAG", "TEST_PROXY_PORT"])
    assert.match(code, new RegExp(`\\$\\{${variable}:\\?`), `${variable} moet verplicht zijn`);
  assert.doesNotMatch(code, /CHANGE_THIS|changeme|password123/i);
  assert.doesNotMatch(code, /versado\.app|jehova\.jouwdomein|https?:\/\/(?!localhost)/i, "geen domein of URL ingevuld");
  assert.doesNotMatch(code, /:latest\b/, "vaste tag, niet latest");
  assert.match(code, /ALLOW_INSECURE_COOKIES: "false"/);
  assert.match(code, /NATIVE_API_ENABLED: "1"/);
  assert.doesNotMatch(code, /SMTP|FEEDBACK_RECIPIENT/i, "geen echte e-mail vanuit de teststack");
});

test("het voorbeeldbestand bevat uitsluitend lege plaatsaanduidingen, zonder domein of echte waarde", () => {
  for (const line of example.split("\n")) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    assert.match(line, /^[A-Z_]+=$/, `alleen lege waarden: ${line}`);
  }
  assert.doesNotMatch(example, /https?:\/\//);
});

const ok = {
  capabilities: { status: 200, redirected: false, body: { apiVersion: 1, features: ["security-setup-v1", "account-password-v1", "password-reset-v1", "email-confirmation-v1", "account-deletion-v1"] } },
  native: { allowOrigin: "capacitor://localhost" }, cross: { allowOrigin: null },
  root: { status: 200, permissionsPolicy: "camera=(), microphone=(self), geolocation=()", hsts: "max-age=31536000" },
};
const base = { origin: "https://test.versado-test.com", allowlist: { internal: [], "store-test": [] }, ...ok };

test("beoordeling: een gezonde testbackend slaagt; een lege allowlist is een eigenaartaak, geen fout", () => {
  const result = evaluate({ ...base, profile: "store-test" });
  assert.equal(result.ok, true); assert.match(result.notes.join(" "), /allowlist.*leeg/);
});

test("beoordeling: productie, ontbrekende allowlist-origin, uitgeschakelde API, ontbrekende capability, redirect, CORS en proxyheader worden afgekeurd", () => {
  const bad = (patch, pattern) => { const result = evaluate({ ...base, ...patch }); assert.equal(result.ok, false); assert.match(result.problems.join(" | "), pattern); };
  bad({ production: "https://test.versado-test.com" }, /productie-origin/);
  bad({ profile: "store-test", allowlist: { internal: [], "store-test": ["https://andere.versado-test.com"] } }, /niet in de allowlist/);
  bad({ capabilities: { status: 404, redirected: false, body: null } }, /404/);
  bad({ capabilities: { ...ok.capabilities, body: { apiVersion: 2, features: [] } } }, /apiVersion/);
  bad({ capabilities: { ...ok.capabilities, body: { apiVersion: 1, features: ["security-setup-v1"] } } }, /Capability ontbreekt/);
  bad({ capabilities: { ...ok.capabilities, redirected: true } }, /redirect/);
  bad({ native: { allowOrigin: null } }, /native origin niet toe/);
  bad({ cross: { allowOrigin: "https://aanvaller.example" } }, /vreemde origin/);
  bad({ root: { ...ok.root, permissionsPolicy: "microphone=()" } }, /microphone=\(self\)/);
});

test("check(): alleen leesverzoeken, nooit een redirect volgen, en alleen na exacte HTTPS-origin-validatie", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, method: init.method, redirect: init.redirect, origin: init.headers?.Origin });
    const cors = init.headers?.Origin === "capacitor://localhost" ? { "access-control-allow-origin": "capacitor://localhost" } : {};
    if (url.endsWith("/capabilities")) return new Response(JSON.stringify(ok.capabilities.body), { status: 200, headers: { "content-type": "application/json", ...cors } });
    return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html", "permissions-policy": "microphone=(self)", "strict-transport-security": "max-age=1" } });
  };
  const result = await check("https://test.versado-test.com", { fetchImpl, allowlist: { internal: [], "store-test": [] }, env: {} });
  assert.equal(result.ok, true, result.problems.join("; "));
  assert.ok(requests.length === 3 && requests.every((request) => request.method === "GET" && request.redirect === "manual"));
  await assert.rejects(check("http://test.versado-test.com", { fetchImpl }), /HTTPS/);
  await assert.rejects(check("https://test.versado-test.com/pad", { fetchImpl }), /pad|origin/i);
  assert.equal(requests.length, 3, "geen verzoek bij een ongeldige origin");
  const production = await check("https://test.versado-test.com", { fetchImpl, allowlist: { internal: [], "store-test": [] }, env: { VERSADO_PRODUCTION_ORIGIN: "https://test.versado-test.com" } });
  assert.equal(production.ok, false);
});
