import test from "node:test";
import assert from "node:assert/strict";
import { NativeNavigator, nativeDeepLink, nativeRoute, nativePasswordResetLink, nativeEmailConfirmationLink } from "../src/lib/native/navigation";

function browser(hash = "", state: unknown = null) {
  const entries = [{ hash, state }]; let cursor = 0;
  const listeners = new Set<() => void>();
  const location = { get hash() { return entries[cursor].hash; } };
  const history = {
    get state() { return entries[cursor].state; },
    replaceState(state: unknown, _unused: string, url?: string | URL | null) { entries[cursor] = { state, hash: String(url) }; },
    pushState(state: unknown, _unused: string, url?: string | URL | null) { entries.splice(cursor + 1); entries.push({ state, hash: String(url) }); cursor++; },
    back() { if (cursor) { cursor--; for (const notify of listeners) notify(); } },
  };
  return { location, history, addEventListener(_type: "popstate", listener: () => void) { listeners.add(listener); }, removeEventListener(_type: "popstate", listener: () => void) { listeners.delete(listener); }, entries };
}

test("de lokale routegrens accepteert alleen bestaande schermen zonder URL-geheimen", () => {
  for (const route of ["/dashboard", "/profile", "/privacy", "/cookies", "/login", "/register", "/forgot-password", "/lesson/chapter_1-test"]) assert.equal(nativeRoute(route), route);
  for (const route of ["/courses/../pad", "/adminbackend", "https://evil.invalid/privacy", "//evil.invalid/privacy", "/privacy?token=secret", "/privacy#secret", "/lesson/a%2fb", "/lesson/../privacy", "/privacy\\", "/privacy ", "/lesson/", "/lesson/" + "a".repeat(129)]) assert.equal(nativeRoute(route), null, route);
});
test("deeplinks behouden de exacte backend-origin en laten geen querytokens of credentials door", () => {
  assert.equal(nativeDeepLink("https://versado.app/lesson/chapter-1", "https://versado.app"), "/lesson/chapter-1");
  for (const url of ["https://versado.app.evil.invalid/privacy", "http://versado.app/privacy", "https://user:secret@versado.app/privacy", "https://versado.app:444/privacy", "https://versado.app/privacy?token=x", "https://versado.app/privacy#token", "capacitor://localhost/privacy", "https://versado.app/courses?token=secret"]) assert.equal(nativeDeepLink(url, "https://versado.app"), null, url);
});
test("push, replace en systeemterug delen dezelfde lokale geschiedenis", () => {
  const window = browser(), router = new NativeNavigator(window), stop = router.listen();
  let notifications = 0; const unsubscribe = router.subscribe(() => notifications++);
  router.push("/privacy"); router.push("/cookies"); router.replace("/profile");
  assert.equal(window.entries.length, 3); assert.equal(router.getSnapshot().href, "/profile");
  router.back(); assert.equal(router.getSnapshot().href, "/privacy"); assert.equal(router.getSnapshot().traversal, true);
  assert.equal(notifications, 4); unsubscribe(); stop();
});
test("heropening herstelt de route en kent zonder appgeschiedenis een veilige terugval", () => {
  const window = browser("#/privacy"), router = new NativeNavigator(window);
  assert.equal(router.getSnapshot().href, "/privacy"); assert.equal(router.canGoBack(), false);
  router.back(); assert.equal(router.getSnapshot().href, "/dashboard");
  const first = new NativeNavigator(browser("#https://evil.invalid")); assert.equal(first.getSnapshot().href, "/dashboard");
  router.push("/profile"); const reopened = new NativeNavigator(window); assert.equal(reopened.canGoBack(), true);
  assert.deepEqual(Object.keys(Object(window.history.state)).sort(), ["href", "index", "versadoNative"]);
});
test("ongeldige popstate of onbekende navigatie opent geen remote pagina", () => {
  const window = browser(), router = new NativeNavigator(window); router.listen(); router.push("/privacy");
  window.entries[0] = { hash: "#/adminbackend", state: { versadoNative: 1, index: 0 } };
  router.back(); assert.equal(router.getSnapshot().href, "/dashboard");
  assert.throws(() => router.push("//evil.invalid"), /native_route_unavailable/);
  assert.equal(router.getSnapshot().href, "/dashboard");
});
test("herladen en dezelfde bestemming maken geen dubbele geschiedenisitems", () => {
  const window = browser(), router = new NativeNavigator(window), initial = router.getSnapshot();
  router.push("/dashboard"); assert.equal(router.getSnapshot(), initial);
  router.refresh(); assert.equal(router.getSnapshot().revision, 1); assert.equal(window.entries.length, 1);
});

test("resetlinks leveren alleen een bewijs in geheugen; lokale geschiedenis blijft vrij van geheimen", () => {
  const token = "R".repeat(43), base = "https://versado.app";
  assert.equal(nativePasswordResetLink(`${base}/reset-password?token=${token}`, base), token);
  for (const raw of [ `${base}.evil.invalid/reset-password?token=${token}`, `http://versado.app/reset-password?token=${token}`, `${base}:444/reset-password?token=${token}`, `https://name:password@versado.app/reset-password?token=${token}`, `${base}/reset-password?token=${token}#secret`, `${base}/reset-password?token=${token}&token=${token}`, `${base}/reset-password?token=${token}&next=/adminbackend`, `${base}/reset-password?token=short`, `${base}/privacy?token=${token}`, `${base}/reset-password?token=${token} `, `${base}/reset-password?token=${"X".repeat(2049)}` ]) assert.equal(nativePasswordResetLink(raw, base), null, raw);
  const window = browser(), router = new NativeNavigator(window);
  router.push("/reset-password"); assert.equal(window.location.hash, "#/reset-password");
  assert.ok(!JSON.stringify(window.entries).includes(token));
  assert.equal(nativeDeepLink(`${base}/reset-password?token=${token}`, base), null);
});

test("bevestigingslinks blijven strikt gescheiden van resetlinks en lokale URL-opslag", () => {
  const base = "https://versado.app", token = "V".repeat(43), url = `${base}/verify-email?token=${token}`;
  assert.equal(nativeEmailConfirmationLink(url, base), token); assert.equal(nativePasswordResetLink(url, base), null);
  assert.equal(nativeEmailConfirmationLink(`${base}/reset-password?token=${token}`, base), null);
  for (const raw of [`https://evil.invalid/verify-email?token=${token}`, `${url}&next=/adminbackend`, `${url}&token=${token}`, `${url}#secret`, `${base}/verify-email?token=invalid`]) assert.equal(nativeEmailConfirmationLink(raw, base), null);
  const window = browser(), router = new NativeNavigator(window);router.push("/verify-email");assert.equal(window.location.hash, "#/verify-email");assert.ok(!JSON.stringify(window.entries).includes(token));
});

test("contentkiezer onthoudt alleen de lokale vertrekroute en wist die bij afmelden; diagnostiek is geen externe deeplink", () => {
  const window = browser("#/lesson/chapter-a"), router = new NativeNavigator(window);
  router.push("/content"); assert.equal(router.contentDeparture(), "/lesson/chapter-a");
  router.replace("/lesson/chapter-b"); router.push("/content"); assert.equal(router.contentDeparture(), "/lesson/chapter-b");
  router.replace("/login"); assert.equal(router.contentDeparture(), "/dashboard");
  assert.equal(nativeRoute("/diagnostics"), "/diagnostics");
  assert.equal(nativeDeepLink("https://dev.versado.app/diagnostics", "https://dev.versado.app"), null);
  assert.equal(nativeDeepLink("https://dev.versado.app/content", "https://dev.versado.app"), "/content");
  assert.ok(window.entries.every(entry => !JSON.stringify(entry.state).includes("chapter-a") || entry.hash === "#/lesson/chapter-a"));
});
