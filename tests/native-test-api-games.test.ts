// Spelen op de store-test-build (api-test.versado.app): de test-API-rand moet exact de verzoeken doorlaten die de
// native Spelen-client kan sturen, en al het andere (methoden, extra/dubbele parameters, verdachte coderingen,
// traversal, onbekende routes) geweigerd houden. Geen netwerk, geen NAS: de echte, gegenereerde nginx-regels
// (map + URI-guard) worden hier met dezelfde PCRE-semantiek als regex uitgevoerd; tests/native-test-api-proxy.integration.mjs
// en tests/native-test-api-games.local-nginx.mjs draaien dezelfde gevallen tegen echte nginx.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { render, routes, gameRoutes, studyFolderRoutes } from "../scripts/native/render-test-api-proxy.mjs";
import { clientRequests, rejectedRequests, searchRequests } from "./fixtures/native-test-api-game-cases.mjs";
import { accessRouteAllowed, nativeAccessTransport, TEST_API_ORIGIN } from "../src/lib/native/access";
import { nativeGamePathAllowed } from "../src/lib/native/gamesAccess";
import { GAME_PAGE_ROUTES } from "../src/lib/native/gamesPagesRoutes";
import { GAME_API_ROUTES, gameApiRoute } from "../src/lib/native/gamesRoutes";
import { NativeClientError } from "../src/lib/native/client";

const PREFIX = "/api/v1/native/";
// De URI-guard zoals in de gegenereerde nginx-configuratie (nginx-quoting: \\ is één backslash).
const guardLine = /if \(\$request_uri ~ "(.*)"\) \{ return 404; \}/.exec(render(readFileSync("deploy/nginx/nginx.conf", "utf8")));
assert.ok(guardLine, "URI-guard staat in de gegenereerde configuratie");
const GUARD = new RegExp(guardLine![1].replace(/\\\\/g, "\\"));
const matchers = (list: string[][]) => list.map(([method, path]) => new RegExp(`^${method}:${PREFIX}${path}$`));
const decide = (list: string[][]) => { const compiled = matchers(list); return (method: string, uri: string) => !GUARD.test(PREFIX + uri) && compiled.some(rx => rx.test(`${method}:${PREFIX}${uri}`)); };
const allowed = decide(routes as string[][]);
const legacyRoutes = (routes as string[][]).filter(route => !(gameRoutes as string[][]).includes(route));
const allowedBefore = decide(legacyRoutes);

test("de games-client stuurt toegestane verzoeken (client-allowlist): het was geen ontbrekende client-route", () => {
  assert.equal(accessRouteAllowed(`games/page?route=${encodeURIComponent("/live")}`, "GET"), true);
  assert.equal(GAME_PAGE_ROUTES.some(route => route.path === "/live"), true);
});

test("OORZAAK (bewaard als regressie): de oorspronkelijke proxylijst zonder spelroutes weigerde alles, ook games/page?route=%2Flive", () => {
  const requests = clientRequests() as string[][];
  assert.ok(requests.length > 200, "de hele spelsurface");
  assert.equal(requests.filter(([method, uri]) => allowedBefore(method, uri)).length, 0, "zonder gameRoutes komt geen enkel spelverzoek door");
  assert.equal(allowedBefore("GET", "games/page?route=%2Flive"), false, "exact het verzoek uit de foutmelding");
  for (const [method, uri] of [["GET", "today-overview"], ["GET", "courses"], ["GET", "capabilities"], ["POST", "realtime/session"], ["POST", "login"], ["POST", "refresh"], ["POST", "logout"]] as const) {
    assert.equal(allowedBefore(method, uri), true, `${method} ${uri} werkte al`);
  }
});

test("HERSTEL: elk verzoek dat de native Spelen-client kan sturen komt door de proxy-allowlist", () => {
  const requests = clientRequests() as string[][];
  const refused = requests.filter(([method, uri]) => !allowed(method, uri));
  assert.deepEqual(refused, [], "alle clientverzoeken moeten door de proxy");
  // Het zijn ook echt verzoeken die de client-allowlist (TS, gelijk aan Swift/Java) accepteert, niet slechts voorbeelden.
  const clientRefused = requests.filter(([method, uri]) => method !== "HEAD" && !nativeGamePathAllowed(uri, method) && !/\/audio\/[a-f0-9]{64}\/stream$/.test(uri));
  assert.deepEqual(clientRefused, [], "voorbeelden zijn geldig voor de client");
  // Dekking: elke pagina-rij, elke API-route met elke methode, annotaties en audio.
  const seen = new Set(requests.map(([method, uri]) => `${method} ${uri.split("?")[0]}`));
  for (const route of GAME_API_ROUTES) for (const method of route.methods) {
    const sample = `games/${route.path.replace(/\[word\]/, "zondaar").replace(/\[[^\]]+\]/g, "abc123")}`;
    assert.ok(seen.has(`${method} ${sample}`) || route.path === "list-order", `${method} ${route.path} is gedekt`);
  }
  assert.equal(requests.filter(([, uri]) => uri.startsWith("games/page?")).length >= GAME_PAGE_ROUTES.length, true);
});

test("afgewezen: verkeerde methoden, extra of dubbele parameters, verdachte coderingen, traversal en onbekende routes", () => {
  assert.ok(rejectedRequests.length >= 50);
  const accepted = (rejectedRequests as string[][]).filter(([, method, uri]) => allowed(method, uri));
  assert.deepEqual(accepted, [], "deze verzoeken hadden geweigerd moeten blijven");
});

test("de algemene beveiliging is niet verzwakt: % blijft alleen toegestaan voor de vaste bytes en bestaande routes gedragen zich gelijk", () => {
  for (const bad of ["%25", "%2E", "%2e", "%00", "%5C", "%63", "%2f", "%41", "%7F", "%1F", "%"]) assert.equal(GUARD.test(`${PREFIX}x${bad}y`), true, `${bad} wordt door de guard geweigerd`);
  for (const good of ["%2F", "%3F", "%3D", "%26", "%20", "%2C", "%23", "%40", "%2B", "%C3%A9", "%E2%80%99"]) assert.equal(GUARD.test(`${PREFIX}x${good}y`), false, `${good} is een toegestane byte`);
  for (const bad of ["x/../y", "a//b", "a/./..", "/.."]) assert.equal(GUARD.test(bad), true, `traversal/dubbele slash ${bad}`);
  // Bestaande (niet-spel)routes: zelfde beslissing met en zonder spelroutes, en codering blijft daar verboden.
  for (const [method, uri] of [["GET", "capabilities"], ["GET", "%63apabilities"], ["GET", "capabilities?token=secret"], ["GET", "capabilities/extra"], ["POST", "login"], ["DELETE", "account"], ["GET", "profile%2Ftwo-factor"], ["GET", "courses/c%2Fx/path"], ["POST", "realtime/session"]] as const) {
    assert.equal(allowed(method, uri), allowedBefore(method, uri), `${method} ${uri} ongewijzigd`);
  }
  assert.equal(allowed("GET", "capabilities"), true); assert.equal(allowed("GET", "%63apabilities"), false); assert.equal(allowed("GET", "capabilities?token=secret"), false);
  assert.equal(allowed("POST", "realtime/session"), true);
  // Het aantal oorspronkelijke routes is ongewijzigd; alleen gameRoutes is toegevoegd.
  assert.equal(legacyRoutes.length - studyFolderRoutes.length, 11);
});

test("de proxy antwoordt voor onbekende routes met een kale 404 (geen JSON, geen CORS-header); Swift classificeert dat als access_invalid_response", () => {
  assert.match(readFileSync("scripts/native/render-test-api-proxy.mjs", "utf8"), /if \(\$native_test_route = 0\) \{ return 404; \}/);
  const swift = readFileSync("ios/App/App/NativeAccessTransport.swift", "utf8");
  assert.match(swift, /\[401, 403\]\.contains\(status\) \? "access_denied" : status >= 500 \? "access_network_unavailable" : "access_invalid_response"/);
});

test("transportfout, netwerkfout, toegangsweigering en een onbekende nativefout houden verschillende codes tot aan de UI (en één generieke tekst)", async () => {
  const run = async (error: Error) => {
    const bridge = { accessStatus: async () => ({ enabled: true, configured: true }), enrollAccess: async () => ({ changed: false }), clearAccess: async () => ({ changed: false }), accessRequest: async () => { throw error; } };
    return nativeAccessTransport(bridge as never, undefined, true)(`${TEST_API_ORIGIN}/api/v1/native/games/page?route=%2Flive`, { method: "GET" }).then(() => "ok", (caught: unknown) => (caught as NativeClientError).code);
  };
  assert.equal(await run(new Error("access_invalid_response")), "access_invalid_response", "kale 404 van de proxy / geen JSON");
  assert.equal(await run(new Error("access_network_unavailable")), "access_network_unavailable", "netwerk of 5xx");
  assert.equal(await run(new Error("access_denied")), "access_denied", "401/403 van de edge");
  assert.equal(await run(new Error("access_request_invalid")), "access_request_invalid", "native allowlist weigert het verzoek");
  assert.equal(await run(new Error("iets_onbekends")), "access_unavailable", "onbekende nativefout");
  const foundation = readFileSync("src/components/native/NativeFoundation.tsx", "utf8");
  assert.match(foundation, /key\.startsWith\("access_"\)[\s\S]{0,400}"access_missing" \? "nativeAccess\.missing" : key === "access_disabled" \? "nativeAccess\.disabled" : key === "access_denied" \? "nativeAccess\.denied" : "nativeAccess\.error"/);
});

test("NativeGamesView geeft de fout door aan NativeFoundation.report (de bron van de generieke toesteltoegangstekst)", () => {
  const view = readFileSync("src/components/native/NativeGamesView.tsx", "utf8");
  assert.match(view, /useEffect\(\(\)=>\{if\(failure&&!nativeLearningTransientError\(failure\)\)onError\(failure\);\},\[failure,onError\]\);/);
  const foundation = readFileSync("src/components/native/NativeFoundation.tsx", "utf8");
  assert.match(foundation, /onError=\{err=>\{if\(err instanceof NativeClientError&&err\.code==="content_context_changed"\)void refreshContent\(\);else report\(err\);\}\}/);
});

test("zoektermen met # en @ (tag of e-mailadres) gaan door, ook via de gedeelde client", () => {
  for (const [method, uri] of searchRequests as string[][]) {
    assert.equal(allowed(method, uri), true, `${uri} hoort door de proxy`);
    assert.ok(gameApiRoute(`/api/${uri.slice(6)}`, method), `${uri} hoort door de client`);
  }
});

test("de verruiming is beperkt tot q van users/search", () => {
  const sensitive = ["games/users/avatars?ids=a%23b", "games/users/avatars?ids=a%40b", "games/puzzle/history?cursor=a%23b", "games/users/search?x=a%23b", "games/users/search?q=a%2523b", "games/users/search?q=a%2Fb", "games/users/search?q=a%26b"];
  for (const uri of sensitive) assert.equal(allowed("GET", uri), false, `${uri} blijft geweigerd`);
  // Alle andere routes zijn byte-voor-byte onveranderd: alleen users/search draagt de uitgebreide klasse.
  const withExtra = (routes as string[][]).filter(([, path]) => path.includes("%23"));
  assert.equal(withExtra.length, 1);
  assert.ok(withExtra[0]![1].includes("users/search"));
});
