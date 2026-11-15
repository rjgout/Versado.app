// Reproductie (alleen onderzoek, geen fix): waarom Spelen op de store-test-build (api-test.versado.app)
// "De toesteltoegang kon niet worden gebruikt." toont. Geen netwerk, geen NAS: alleen de echte route-
// allowlists uit de repository en de foutclassificatie van de native transportlaag.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { routes } from "../scripts/native/render-test-api-proxy.mjs";
import { accessRouteAllowed, nativeAccessTransport, TEST_API_ORIGIN } from "../src/lib/native/access";
import { GAME_PAGE_ROUTES } from "../src/lib/native/gamesPagesRoutes";
import { GAME_API_ROUTES } from "../src/lib/native/gamesRoutes";
import { NativeClientError } from "../src/lib/native/client";

/** Dezelfde beslissing als de nginx-map `$native_test_route` (regex op "METHODE:request_uri"). */
const proxyAllows = (method: string, uri: string) =>
  (routes as string[][]).some(([m, path]) => new RegExp(`^${m}:/api/v1/native/${path}$`).test(`${method}:${uri}`));
const sample = (path: string) => path.replace(/\[[^\]]+\]/g, "abc123");

test("de games-client stuurt wel toegestane verzoeken (client-allowlist) — het is geen ontbrekende client-route", () => {
  const page = `games/page?route=${encodeURIComponent("/live")}`;
  assert.equal(accessRouteAllowed(page, "GET"), true, "games/page?route=%2Flive wordt door de TS-allowlist toegelaten");
  assert.equal(GAME_PAGE_ROUTES.some(route => route.path === "/live"), true);
});

test("OORZAAK: de api-test-proxy staat geen enkele games/*-route toe (404 vóór de app)", () => {
  const requests: Array<[string, string]> = [["GET", `/api/v1/native/games/page?route=${encodeURIComponent("/live")}`]];
  for (const route of GAME_PAGE_ROUTES) requests.push(["GET", `/api/v1/native/games/page?route=${encodeURIComponent(sample(route.path))}`]);
  for (const route of GAME_API_ROUTES) for (const method of route.methods) requests.push([method, `/api/v1/native/games/${sample(route.path)}`]);
  assert.ok(requests.length > 50, "de hele spelsurface");
  const blocked = requests.filter(([method, uri]) => !proxyAllows(method, uri));
  assert.equal(blocked.length, requests.length, "alle spelverzoeken worden door de proxy-allowlist afgewezen");
  // Ter controle van de test zelf: bestaande, wél ondersteunde routes slagen wel (Vandaag en Leren werken).
  for (const [method, uri] of [["GET", "/api/v1/native/today-overview"], ["GET", "/api/v1/native/courses"], ["GET", "/api/v1/native/capabilities"], ["POST", "/api/v1/native/realtime/session"]] as const) {
    assert.equal(proxyAllows(method, uri), true, `${method} ${uri}`);
  }
  assert.equal(proxyAllows("GET", "/api/v1/native/games/page?route=%2Flive"), false, "exact het verzoek uit de foutmelding");
});

test("de proxy antwoordt met een kale 404 (geen JSON, geen CORS-header); Swift classificeert dat als access_invalid_response", () => {
  const proxy = readFileSync("scripts/native/render-test-api-proxy.mjs", "utf8");
  assert.match(proxy, /if \(\$native_test_route = 0\) \{ return 404; \}/, "nginx: return 404 zonder JSON-body");
  const swift = readFileSync("ios/App/App/NativeAccessTransport.swift", "utf8");
  // JSON + exacte CORS-header zijn verplicht; anders 401/403 → access_denied, >=500 → access_network_unavailable, rest → access_invalid_response.
  assert.match(swift, /\[401, 403\]\.contains\(status\) \? "access_denied" : status >= 500 \? "access_network_unavailable" : "access_invalid_response"/);
});

test("transportfout, netwerkfout, toegangsweigering en ontbrekende backendfunctie hebben verschillende codes, maar bijna dezelfde gebruikersmelding", async () => {
  const run = async (error: Error) => {
    const bridge = { accessStatus: async () => ({ enabled: true, configured: true }), enrollAccess: async () => ({ changed: false }), clearAccess: async () => ({ changed: false }), accessRequest: async () => { throw error; } };
    const fetcher = nativeAccessTransport(bridge as never, undefined, true);
    return fetcher(`${TEST_API_ORIGIN}/api/v1/native/games/page?route=%2Flive`, { method: "GET" }).then(() => "ok", (caught: unknown) => (caught as NativeClientError).code);
  };
  // De codes die native kan teruggeven blijven onderscheidbaar tot aan de UI…
  assert.equal(await run(new Error("access_invalid_response")), "access_invalid_response", "kale 404 van de proxy / geen JSON");
  assert.equal(await run(new Error("access_network_unavailable")), "access_network_unavailable", "netwerk of 5xx");
  assert.equal(await run(new Error("access_denied")), "access_denied", "401/403 van de edge");
  assert.equal(await run(new Error("access_request_invalid")), "access_request_invalid", "native allowlist weigert het verzoek");
  assert.equal(await run(new Error("iets_onbekends")), "access_unavailable", "onbekende nativefout");
  // …maar NativeFoundation.report kent maar drie aparte teksten (missing, disabled, denied); alle andere access_*-codes geven één melding.
  const foundation = readFileSync("src/components/native/NativeFoundation.tsx", "utf8");
  assert.match(foundation, /key\.startsWith\("access_"\)[\s\S]{0,400}"access_missing" \? "nativeAccess\.missing" : key === "access_disabled" \? "nativeAccess\.disabled" : key === "access_denied" \? "nativeAccess\.denied" : "nativeAccess\.error"/);
  // Een ontbrekende backendfunctie ZOALS DE APP HAAR KENT (JSON-404 uit de echte backend) is geen access_*-fout:
  // zij krijgt een eigen tekst en is dus hier niet de oorzaak.
  assert.ok(!"content_unavailable".startsWith("access_"));
});

test("NativeGamesView toont zelf 'offline' en geeft de fout door aan NativeFoundation.report, dat de generieke toesteltoegangstekst kiest", () => {
  const view = readFileSync("src/components/native/NativeGamesView.tsx", "utf8");
  assert.match(view, /useEffect\(\(\)=>\{if\(failure&&!nativeLearningTransientError\(failure\)\)onError\(failure\);\},\[failure,onError\]\);/);
  const foundation = readFileSync("src/components/native/NativeFoundation.tsx", "utf8");
  assert.match(foundation, /onError=\{err=>\{if\(err instanceof NativeClientError&&err\.code==="content_context_changed"\)void refreshContent\(\);else report\(err\);\}\}/);
});
