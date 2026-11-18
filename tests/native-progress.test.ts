import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { nativeRoute } from "../src/lib/native/navigation";
import { gameApiRoute } from "../src/lib/native/gamesRoutes";
import { GAME_HANDLERS } from "../src/lib/native/gamesHandlers.server";
import { nativeProgressRoute } from "../src/components/native/NativeProgressView";

test("reeks, XP en competitie zijn lokale routes, zonder query of extra segmenten", () => {
  for (const route of ["/streak", "/xp", "/competition"]) {
    assert.equal(nativeRoute(route), route);
    assert.equal(nativeProgressRoute(route), route);
  }
  for (const bad of ["/streak/", "/xp?x=1", "/competition/extra", "//xp", "/tools/xp-guide", "/xp%2F"]) assert.equal(nativeRoute(bad), null, bad);
  assert.equal(nativeProgressRoute("/dashboard"), null);
});

test("de gegevensroutes van deze schermen staan expliciet, alleen-lezen en met vaste queryvelden in de spelbrug", () => {
  for (const path of ["/api/streak", "/api/streak?year=2026&month=11", "/api/xp-history?skip=0", "/api/leaderboard?scope=league", "/api/leaderboard?scope=friends"]) {
    const route = gameApiRoute(path, "GET");
    assert.ok(route, path);
    assert.ok(GAME_HANDLERS[route.id as keyof typeof GAME_HANDLERS]?.GET, `${path} heeft een handler`);
  }
  for (const [path, method] of [["/api/streak", "POST"], ["/api/xp-history?skip=0", "DELETE"], ["/api/leaderboard", "PUT"], ["/api/streak?x=1", "GET"], ["/api/leaderboard?scope=league&extra=1", "GET"], ["/api/competition/result", "POST"]] as const) {
    assert.equal(gameApiRoute(path, method), null, `${method} ${path}`);
  }
});

test("de header-chips zijn alleen aantikbaar als de schermen beschikbaar zijn en elke chipbestemming bestaat lokaal", () => {
  const header = readFileSync("src/components/native/NativeShellHeader.tsx", "utf8");
  assert.match(header, /interactive=\{progressLinks\}/);
  const foundation = readFileSync("src/components/native/NativeFoundation.tsx", "utf8");
  assert.match(foundation, /progressLinks=\{gamesEnabled\}/);
  const badges = readFileSync("src/components/shell/UserBadgesView.tsx", "utf8");
  for (const href of badges.match(/href="\/[a-z-]+"/g) ?? []) assert.ok(nativeRoute(href.slice(6, -1)), `${href} bestaat niet als native route`);
});

test("de gedeelde schermen importeren geen Next-link (die hoort niet in de lokale bundel)", () => {
  for (const file of ["StreakClient", "XpHistoryClient", "LeaderboardClient"]) assert.doesNotMatch(readFileSync(`src/components/${file}.tsx`, "utf8"), /from "next\//, file);
});
