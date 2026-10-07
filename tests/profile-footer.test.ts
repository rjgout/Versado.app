import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PROFILE_VIEWS, isProfileOverview, parseProfileView, type ProfileView } from "../src/lib/profileViews";

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

test("alleen het profieloverzicht toont de footer", () => {
  assert.equal(isProfileOverview("/profile", null), true);
  // Een onbekende view valt terug op het overzicht, net als ProfileClient.
  assert.equal(isProfileOverview("/profile", parseProfileView("bestaat-niet")), true);
});

test("elk profielonderdeel (?view=...) toont de footer niet, ook toekomstige", () => {
  for (const view of Object.keys(PROFILE_VIEWS) as ProfileView[]) {
    assert.equal(isProfileOverview("/profile", parseProfileView(view)), false, view);
  }
});

test("losse profielpagina's en nieuwe routes onder profiel starten zonder footer", () => {
  for (const route of ["/feedback", "/change-password", "/xp", "/streak", "/shop", "/profile/instellingen", "/profile/nieuw/onderdeel"]) {
    assert.equal(isProfileOverview(route, null), false, route);
  }
  assert.equal(isProfileOverview(null, null), false);
  assert.equal(isProfileOverview(undefined, null), false);
});

test("terug naar het overzicht brengt de footer terug", () => {
  const route = [
    ["/profile", null],
    ["/profile", parseProfileView("language")],
    ["/feedback", null],
    ["/profile", null],
  ] as const;
  assert.deepEqual(route.map(([pathname, view]) => isProfileOverview(pathname, view)), [true, false, false, true]);
});

test("de profielshell bepaalt de footer centraal en de focus-shell blijft los daarvan", () => {
  const shell = read("src/components/profile/ProfilePage.tsx");
  assert.match(shell, /isProfileOverview/);
  assert.match(shell, /showFooter &&/);
  // Pagina's regelen de footer nooit zelf.
  for (const file of ["src/components/ProfileClient.tsx", "src/components/FeedbackClient.tsx", "src/components/ChangePasswordClient.tsx"]) {
    assert.doesNotMatch(read(file), /components\/Footer/, file);
  }
  // De globale onderbalk blijft aan de bestaande focus-/immersive-regels hangen.
  const css = read("src/app/globals.css");
  assert.match(css, /\[data-shell-mode="focus"\] \[data-app-global-header\],\s*\[data-shell-mode="focus"\] nav\[data-main-nav\]/);
});
