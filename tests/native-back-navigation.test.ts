import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NativeNavigator } from "../src/lib/native/navigation";
import { nativeBackFallback } from "../src/lib/native/backTarget";
import { dismissTopmostModal } from "../src/lib/native/modalBack";

const FEATURES = ["games-v1", "realtime-ticket-v1", "friends-v1"];
function browser(hash = "", state: unknown = null) {
  const entries = [{ hash, state }]; let cursor = 0;
  const listeners = new Set<() => void>();
  const history = {
    get state() { return entries[cursor].state; },
    replaceState(next: unknown, _u: string, url?: string | URL | null) { entries[cursor] = { state: next, hash: String(url) }; },
    pushState(next: unknown, _u: string, url?: string | URL | null) { entries.splice(cursor + 1); entries.push({ state: next, hash: String(url) }); cursor++; },
    go(delta: number) { const next = cursor + delta; if (next >= 0 && next < entries.length) { cursor = next; for (const notify of listeners) notify(); } },
    back() { if (cursor) { cursor--; for (const notify of listeners) notify(); } },
  };
  return { entries, location: { get hash() { return entries[cursor].hash; } }, history, addEventListener(_t: "popstate", l: () => void) { listeners.add(l); }, removeEventListener(_t: "popstate", l: () => void) { listeners.delete(l); } };
}
/** Zoals de app: de terugbalk en de systeemterugknop gebruiken dezelfde terugvalroute. */
const back = (router: NativeNavigator) => router.back(nativeBackFallback(router.getSnapshot().href, FEATURES));
const at = (router: NativeNavigator) => router.getSnapshot().href;

test("tabwissels: terug loopt de bezochte schermen in omgekeerde volgorde terug en wisselt nooit naar een onbestaand scherm", () => {
  const router = new NativeNavigator(browser("#/dashboard")); router.listen();
  for (const tab of ["/courses", "/live", "/friends"]) router.push(tab);
  for (const expected of ["/live", "/courses", "/dashboard"]) { back(router); assert.equal(at(router), expected); }
  assert.equal(router.canGoBack(), false);
  // Zelfde tab opnieuw aantikken voegt geen extra geschiedenisregel toe.
  router.push("/courses"); router.push("/courses");
  back(router); assert.equal(at(router), "/dashboard");
});

test("vanuit een detailscherm gaat terug naar het scherm waar de gebruiker vandaan kwam, ook ver van de eigen tab", () => {
  const router = new NativeNavigator(browser("#/dashboard")); router.listen();
  router.push("/live"); router.push("/friends"); router.push("/friends/u1");
  back(router); assert.equal(at(router), "/friends");
  router.push("/streak"); back(router); assert.equal(at(router), "/friends");
  router.replace("/xp"); back(router); assert.equal(at(router), "/live");
});

test("zonder geschiedenis (heropening of deeplink) gaat terug naar de logische bovenliggende route, niet naar een willekeurige startpagina", () => {
  const expected: [string, string][] = [
    ["/friends/u1", "/friends"], ["/profile?view=notifications", "/profile"], ["/profile/avatar", "/profile"], ["/change-password", "/profile"], ["/account-verwijderen", "/profile"],
    ["/courses/c1/read/steps/s1", "/courses/c1/pad"], ["/courses/c1/read/chapters/ch1", "/courses/c1/pad"], ["/courses/c1/pad", "/courses"], ["/courses/c1/archief", "/courses/c1/pad"], ["/courses/c1", "/courses"],
    ["/jigsaw", "/live"], ["/scrabble/g1", "/live"], ["/kompas/play.quick-missionary", "/live"], ["/snelle-zendeling", "/live"], ["/lesson/ch1", "/live"],
    ["/streak", "/dashboard"], ["/xp", "/dashboard"], ["/competition", "/dashboard"], ["/privacy", "/dashboard"],
    // Een tabhoofdscherm valt nooit op zichzelf terug (dat zou terug laten vastlopen).
    ["/live", "/dashboard"], ["/courses", "/dashboard"], ["/friends", "/dashboard"], ["/profile", "/dashboard"],
  ];
  for (const [from, to] of expected) {
    assert.equal(nativeBackFallback(from, FEATURES), to, from);
    const router = new NativeNavigator(browser(`#${from}`)); router.listen();
    assert.equal(router.canGoBack(), false, from);
    back(router);
    assert.equal(at(router), to, `terug vanaf ${from}`);
    assert.equal(router.canGoBack(), false, "de terugval vervangt de regel, groeit de geschiedenis niet");
  }
});

test("een terugval wijst nooit naar het scherm zelf of buiten de lokale routes", () => {
  for (const [from] of [["/live"], ["/courses"], ["/friends"], ["/profile"], ["/streak"], ["/jigsaw"], ["/courses/c1/read/steps/s1"]]) {
    const target = nativeBackFallback(from, FEATURES);
    assert.notEqual(target, from);
    const router = new NativeNavigator(browser("#/dashboard")); router.push(target); assert.equal(at(router), target);
  }
});

test("profielschermen: terug naar het profiel en vandaar naar het scherm waar je het opende", () => {
  const router = new NativeNavigator(browser("#/dashboard")); router.listen();
  router.push("/competition"); router.push("/profile"); router.push("/profile?view=notifications"); router.push("/change-password");
  back(router); assert.equal(at(router), "/profile?view=notifications");
  back(router); assert.equal(at(router), "/profile");
  back(router); assert.equal(at(router), "/competition");
});

test("een navigatiebewaker (bv. onopgeslagen wijzigingen) blokkeert terug tot de gebruiker doorgaat", () => {
  const router = new NativeNavigator(browser("#/dashboard")); router.listen();
  router.push("/profile"); router.push("/change-password");
  let pending: (() => void) | null = null;
  router.registerNavigationGuard(proceed => { pending = proceed; return false; });
  back(router); assert.equal(at(router), "/change-password");
  pending!(); assert.equal(at(router), "/profile");
});

test("de systeemterugknop sluit eerst een open venster (dialog of role=dialog) en navigeert pas daarna", () => {
  const calls: string[] = [];
  const element = (name: string, handled = true) => ({ dispatchEvent(event: Event) { calls.push(`${name}:${event.type}`); return handled; }, close() { calls.push(`${name}:close`); } });
  const root = (dialog: unknown, modals: unknown[]) => ({ querySelector: () => dialog, querySelectorAll: () => modals });
  const escape = () => new Event("keydown");
  assert.equal(dismissTopmostModal(root(null, []), escape), false, "geen venster: navigeren mag");
  assert.equal(dismissTopmostModal(root(element("native"), [element("div")]), escape), true);
  assert.deepEqual(calls, ["native:cancel", "native:close"], "een <dialog> sluit via cancel/close");
  calls.length = 0;
  assert.equal(dismissTopmostModal(root(null, [element("onder"), element("boven")]), escape), true);
  assert.deepEqual(calls, ["boven:keydown"], "alleen het bovenste venster krijgt Escape, zoals op het web");
});

test("beide terugpaden (balk en systeemknop) gebruiken dezelfde terugvalbron en dezelfde modale sluiting", () => {
  const foundation = readFileSync("src/components/native/NativeFoundation.tsx", "utf8");
  assert.equal([...foundation.matchAll(/nativeBackFallback\(/g)].length, 2);
  assert.match(foundation, /dismissTopmostModal\(document\)/);
  assert.doesNotMatch(foundation, /querySelector<HTMLDialogElement>\("dialog\[open\]"\)/);
});
