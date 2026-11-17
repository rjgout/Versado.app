import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { nativeRoute } from "../src/lib/native/navigation";
import { nativeFriendsAvailable, nativePrimaryNav } from "../src/lib/native/shell";
import { gameApiRoute } from "../src/lib/native/gamesRoutes";
import { nativeGamePathAllowed } from "../src/lib/native/gamesAccess";
import { activeDestination } from "../src/lib/navigation";

const ALL = ["games-v1", "realtime-ticket-v1", "courses-overview-v1", "friends-v1"];

test("Vrienden is pas een bestemming met friends-v1, games-v1 én realtime", () => {
  assert.deepEqual(nativePrimaryNav(ALL).map(item => item.id), ["today", "learn", "play", "friends"]);
  for (const missing of ["friends-v1", "games-v1", "realtime-ticket-v1"]) {
    const features = ALL.filter(f => f !== missing);
    assert.equal(nativeFriendsAvailable(features), false, missing);
    assert.equal(nativePrimaryNav(features).some(item => item.id === "friends"), false, missing);
  }
});

test("alleen /friends en /friends/<id> zijn lokale routes; geen query, extra segmenten of andere sociale pagina's", () => {
  assert.equal(nativeRoute("/friends"), "/friends");
  assert.equal(nativeRoute("/friends/abc_123-X"), "/friends/abc_123-X");
  for (const bad of ["/friends/", "/friends/a/b", "/friends?x=1", "/friends/a%20b", "//friends", "/groups", "/competition", "/activity", "/friends/" + "a".repeat(129)]) assert.equal(nativeRoute(bad), null, bad);
  assert.equal(activeDestination("/friends/abc"), "friends");
});

test("de vriendenroutes staan expliciet met exact de toegestane methoden in de spelbrug", () => {
  const allowed: [string, string][] = [
    ["/api/friends", "GET"], ["/api/friends/request", "POST"], ["/api/friends/profiles/u1", "GET"], ["/api/friends/f1", "DELETE"],
    ["/api/friends/f1/accept", "POST"], ["/api/friends/f1/decline", "POST"],
    ["/api/friend-streaks", "GET"], ["/api/friend-streaks", "POST"], ["/api/friend-streaks/s1", "POST"],
    ["/api/freezes/gift", "POST"], ["/api/nudges", "POST"], ["/api/users/search?q=Jan", "GET"],
  ];
  for (const [path, method] of allowed) assert.ok(gameApiRoute(path, method), `${method} ${path}`);
  const denied: [string, string][] = [
    ["/api/friends/request", "GET"], ["/api/friends/f1", "GET"], ["/api/friends/f1", "POST"], ["/api/friends/profiles/u1", "POST"],
    ["/api/friends/profiles/u1", "DELETE"], ["/api/friend-streaks", "DELETE"], ["/api/freezes/gift", "GET"],
    ["/api/friends/invite", "GET"], ["/api/friends/invite", "POST"], ["/api/freezes/received", "GET"],
    ["/api/friends/profiles/../u1", "GET"], ["/api/friends/profiles/u1?x=1", "GET"], ["/api/friends/f%2F1", "DELETE"],
  ];
  for (const [path, method] of denied) assert.equal(gameApiRoute(path, method), null, `${method} ${path}`);
  assert.equal(nativeGamePathAllowed("games/friends/request", "POST"), true);
  assert.equal(nativeGamePathAllowed("games/friends/request", "GET"), false);
});

test("de gedeelde vriendenclients roepen alleen toegestane routes aan en gebruiken geen browser-only poorten", () => {
  const sources = ["src/components/FriendsClient.tsx", "src/components/FriendProfileClient.tsx", "src/components/social/FriendStreaksSection.tsx"].map(file => [file, readFileSync(file, "utf8")] as const);
  // Alleen wat op het native scherm bereikbaar is: uitnodigingskaart, groepen en dorp zijn daar bewust verborgen.
  const hiddenOnNative = ["/api/friends/invite", "/api/groups", "/api/dorp"];
  for (const [file, source] of sources) {
    assert.doesNotMatch(source, /from "next\/link"|from "next\/navigation"/, file);
    assert.doesNotMatch(source, /(?<![\w.])fetch\(/, `${file}: ruwe fetch( buiten applicationFetch`);
    for (const literal of source.matchAll(/["'`](\/api\/[A-Za-z0-9_\-/]+)(?:\$\{[^}]*\}[A-Za-z0-9_\-/]*)?/g)) {
      const sample = literal[0].slice(1).replace(/\$\{[^}]*\}/g, "x");
      if (hiddenOnNative.some(prefix => sample.startsWith(prefix))) continue;
      const ok = gameApiRoute(sample, "GET") ?? gameApiRoute(sample, "POST") ?? gameApiRoute(sample, "DELETE");
      assert.ok(ok, `${file}: ${sample} heeft geen route in de spelbrug`);
    }
  }
});
