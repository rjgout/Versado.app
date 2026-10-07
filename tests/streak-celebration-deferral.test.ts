import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { celebrationDeferredOn, shouldClaimStreakCelebration, visibleCelebration } from "../src/lib/celebrationGate";
import { isActivityRoute } from "../src/lib/focusMode";

/**
 * Simuleert de provider rond één gebruiker. De server claimt atomair, net als
 * `claimStreakCelebration`: de eerste claim toont, daarna nooit meer
 * (tests/streak-celebration.integration.test.ts bewijst dat tegen de database).
 */
class Session {
  pathname: string;
  /** De reeksdag is opgeslagen maar de viering is nog niet getoond. */
  serverPending: boolean;
  studiedToday = false;
  celebration: { streak: number } | null = null;
  claims = 0;
  shownCount = 0;

  constructor(pathname: string, extensionReached: boolean) {
    this.pathname = pathname;
    this.serverPending = extensionReached;
    this.studiedToday = extensionReached;
  }

  /** Een verversing (XP-event, routewissel, terugkeer naar het tabblad). */
  refresh() {
    if (!shouldClaimStreakCelebration({ pathname: this.pathname, status: "ACTIVE", studiedToday: this.studiedToday, claiming: false })) return;
    this.claims++;
    if (this.serverPending) {
      this.serverPending = false;
      this.celebration = { streak: 7 };
    }
  }

  navigate(pathname: string) {
    this.pathname = pathname;
    this.refresh();
  }

  /** Wat de gebruiker nu daadwerkelijk als fullscreen viering ziet. */
  get visible() {
    const visible = visibleCelebration(this.celebration, this.pathname);
    if (visible && !this.counted) { this.shownCount++; this.counted = true; }
    return visible;
  }
  private counted = false;

  dismiss() { this.celebration = null; this.counted = false; }
}

test("A: in een activiteit staat de resultaatkaart voorop en komt de reeksviering nog niet", () => {
  const session = new Session("/lesson/h1", true);
  session.refresh(); // het XP-event direct na afronden
  assert.equal(session.visible, null);
  assert.equal(session.claims, 0);
  assert.equal(session.serverPending, true, "de viering blijft in de database openstaan");
});

test("B: 'Verder gaan' naar de volgende stap toont de viering niet tussendoor", () => {
  const session = new Session("/lesson/h1", true);
  session.refresh();
  session.navigate("/lesson/h2");
  session.navigate("/reading-lesson/s3");
  session.refresh();
  assert.equal(session.visible, null);
  assert.equal(session.claims, 0);
  assert.equal(session.serverPending, true);
});

test("C: de activiteit verlaten toont de openstaande viering precies één keer", () => {
  const session = new Session("/lesson/h1", true);
  session.refresh();
  session.navigate("/lesson/h2");
  session.navigate("/dashboard");
  assert.deepEqual(session.visible, { streak: 7 });
  session.refresh();
  session.refresh();
  assert.equal(session.shownCount, 1);
  assert.equal(session.serverPending, false, "na de claim is er niets meer te claimen op de server");
});

test("D: een getoonde viering is afgehandeld en komt bij volgende navigatie niet terug", () => {
  const session = new Session("/lesson/h1", true);
  session.navigate("/dashboard");
  assert.deepEqual(session.visible, { streak: 7 });
  session.dismiss();
  session.navigate("/friends");
  session.navigate("/lesson/h9");
  session.navigate("/dashboard");
  assert.equal(session.visible, null);
  assert.equal(session.serverPending, false);
});

test("E: zonder reeksverlenging blijft de flow ongewijzigd", () => {
  const session = new Session("/lesson/h1", false);
  session.refresh();
  session.navigate("/dashboard");
  assert.equal(session.visible, null);
  assert.equal(session.claims, 0, "zonder studiedag wordt er niets geclaimd");
  assert.equal(shouldClaimStreakCelebration({ pathname: "/dashboard", status: "ACTIVE", studiedToday: false, claiming: false }), false);
});

test("hard refresh in de activiteit claimt niet; pas na het verlaten", () => {
  // Een remount begint met een nieuwe sessie terwijl de server nog wacht.
  const session = new Session("/lesson/h1", true);
  session.refresh();
  assert.equal(session.serverPending, true);
  session.navigate("/dashboard");
  assert.deepEqual(session.visible, { streak: 7 });
});

test("een viering die tijdens de activiteit binnenkomt blijft verborgen totdat de activiteit eindigt", () => {
  // Een claim die al onderweg was toen de gebruiker een activiteit startte.
  const celebration = { streak: 3 };
  assert.equal(visibleCelebration(celebration, "/lesson/h1"), null);
  assert.equal(visibleCelebration(celebration, "/snelle-zendeling/run/r1"), null);
  assert.equal(visibleCelebration(celebration, "/dashboard"), celebration);
  assert.equal(visibleCelebration(null, "/dashboard"), null);
});

test("niet claimen terwijl een claim loopt, of bij een onderbroken reeks", () => {
  assert.equal(shouldClaimStreakCelebration({ pathname: "/dashboard", status: "ACTIVE", studiedToday: true, claiming: true }), false);
  assert.equal(shouldClaimStreakCelebration({ pathname: "/dashboard", status: "INTERRUPTED", studiedToday: false, claiming: false }), false);
  assert.equal(shouldClaimStreakCelebration({ pathname: "/dashboard", status: null, studiedToday: false, claiming: false }), false);
  assert.equal(shouldClaimStreakCelebration({ pathname: "/dashboard", status: "ACTIVE", studiedToday: true, claiming: false }), true);
});

test("alle activiteiten tellen als activiteit, ook oefenen in de normale shell", () => {
  for (const route of ["/lesson/c1", "/reading-lesson/l1", "/intro/i1", "/kids/s1", "/podcast/p/e", "/word-game", "/chapter-guess/solo/g1", "/live/ABCD", "/snelle-zendeling/run/r1", "/practice", "/mysteries/003a/play", "/mysteries/006c/play"]) {
    assert.equal(isActivityRoute(route), true, route);
    assert.equal(celebrationDeferredOn(route), true, route);
  }
  for (const route of ["/dashboard", "/courses", "/friends", "/streak", "/profile", "/snelle-zendeling", "/mysteries", "/mysteries/003a", "/"]) {
    assert.equal(isActivityRoute(route), false, route);
    assert.equal(celebrationDeferredOn(route), false, route);
  }
});

test("de oefen-route krijgt geen focusshell: alleen de viering wacht", async () => {
  const { isFocusRoute, shellModeForRoute } = await import("../src/lib/focusMode");
  assert.equal(isFocusRoute("/practice"), false);
  assert.equal(shellModeForRoute("/practice"), "normal");
});

test("de provider gebruikt de centrale gate en geen timing-hacks", () => {
  const source = readFileSync(path.join(process.cwd(), "src/components/StreakContinuation.tsx"), "utf8");
  assert.match(source, /shouldClaimStreakCelebration/);
  assert.match(source, /visibleCelebration/);
  assert.doesNotMatch(source, /setTimeout/);
});
