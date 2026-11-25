import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, statSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { AppNavigationProvider, type AppLinkProps } from "../src/components/navigation/AppNavigation";
import { I18nProvider } from "../src/components/I18nProvider";
import { messagesFor } from "../src/lib/i18n";
import { PRIMARY_NAV } from "../src/lib/navigation";
import { NATIVE_PRIMARY_NAV, nativeAppleLoginUIAvailable } from "../src/lib/native/shell";
import { nativeAccountSchema, nativeShellHeaderSchema } from "../src/lib/native/contract";
import { nativeStaticAssets } from "../scripts/native/assets";
import AppShellFrame from "../src/components/shell/AppShellFrame";
import AppShellHeader from "../src/components/shell/AppShellHeader";
import HeaderAvatarView from "../src/components/shell/HeaderAvatarView";
import SubpageBackBarView from "../src/components/shell/SubpageBackBarView";
import UserBadgesView from "../src/components/shell/UserBadgesView";
import UserAvatarView from "../src/components/versado/UserAvatarView";
import { EMPTY_AVATAR_APPEARANCE } from "../src/lib/avatarTypes";

function render(children: ReactNode, language: "nl" | "en" | "de" | "fr" | "es" = "nl") {
  const Link = ({ replace, ...props }: AppLinkProps) => { void replace; return <a {...props} />; };
  const adapter = { pathname: "/dashboard", push() {}, replace() {}, refresh() {}, back() {}, canGoBack: () => false, Link };
  return renderToStaticMarkup(<I18nProvider language={language} messages={messagesFor(language)}><AppNavigationProvider adapter={adapter}>{children}</AppNavigationProvider></I18nProvider>);
}
const header = { version: 1, xp: 12345, streak: 7, studiedToday: true, tier: "BRONZE", avatar: EMPTY_AVATAR_APPEARANCE } as const;
test("shellcontract: additief voor bestaande clients/servers, ongeldige waarden worden geweigerd", () => {
  const account = { id: "actor-a", handle: "Actora", uiLanguage: "nl", onboardingRequired: false, appleLinked: false, passwordLoginEnabled: true };
  assert.equal(nativeAccountSchema.parse(account).shellHeader, undefined);
  assert.deepEqual(nativeAccountSchema.parse({ ...account, shellHeader: header }).shellHeader, header);
  for (const shellHeader of [{ ...header, version: 2 }, { ...header, xp: 1.2 }, { ...header, streak: "7" }, { ...header, tier: "UNKNOWN" }]) assert.equal(nativeShellHeaderSchema.safeParse(shellHeader).success, false);
});
test("gedeelde shell: web behoudt vier bestemmingen; native toont uitsluitend de werkelijke Vandaag-route", () => {
  for (const [items, expected] of [[PRIMARY_NAV, 4], [NATIVE_PRIMARY_NAV, 1]] as const) {
    const html = render(<AppShellFrame header={<AppShellHeader authenticated homeHref="/dashboard" brand="Versado" destinations={items} />} showNavigation destinations={items}><h1>Inhoud</h1></AppShellFrame>);
    assert.match(html, /data-app-shell-main/);
    assert.match(html, /data-sticky-header/);
    assert.match(html, /data-main-nav/);
    assert.equal((html.match(/data-kompas-target="nav-/g) ?? []).length, expected * 2);
    if (expected === 1) for (const route of ["/courses", "/live", "/friends"]) assert.ok(!html.includes(`href="${route}"`));
  }
  const html = render(<AppShellFrame header={<span>Login</span>} showNavigation={false}><h1>Login</h1></AppShellFrame>);
  assert.ok(!html.includes("data-main-nav"));
});
test("dezelfde avatar-/badgepresentatie in vijf talen; native statuschips hebben geen dode links", () => {
  for (const language of ["nl", "en", "de", "fr", "es"] as const) {
    const values = { streak: 7, xp: 12345, studiedToday: true, tier: "BRONZE" as const };
    const web = render(<UserBadgesView {...values} />, language);
    const native = render(<UserBadgesView {...values} interactive={false} />, language);
    for (const src of ["/icons/streak-flame.webp", "/icons/xp.webp", "/icons/divisions/bronze.webp"]) assert.ok(web.includes(src) && native.includes(src));
    for (const href of ["/streak", "/xp", "/competition"]) assert.ok(web.includes(`href="${href}"`) && !native.includes(`href="${href}"`));
    assert.equal((native.match(/role="img"/g) ?? []).length, 3);
    const avatar = render(<HeaderAvatarView avatar={<UserAvatarView id="actor-a" handle="Actora" appearance={EMPTY_AVATAR_APPEARANCE} />} />, language);
    assert.match(avatar, /href="\/profile"/);
    assert.match(avatar, />AC</);
  }
});
test("gedeelde terugbalk houdt de bestaande terugknop, ondertitel en centrale layoutmarkering", () => {
  const html = render(<SubpageBackBarView title="Hoofdstuk" subtitle="Mijn cursus" onBack={() => {}} />);
  assert.match(html, /data-subpage-back-bar/); assert.match(html, /aria-label="Terug"/); assert.match(html, /Mijn cursus/);
});
test("native assets: compacte registerassets bestaan lokaal en blijven begrensd", () => {
  const assets = nativeStaticAssets();
  assert.equal(assets.length, new Set(assets).size);
  assert.ok(assets.includes("/icons/native/versado-flame.png"));
  assert.ok(assets.includes("/icons/streak-flame-empty.webp"));
  let bytes = 0;
  for (const asset of assets) { assert.ok(asset.startsWith("/") && !asset.includes("..") && !asset.includes("://")); assert.ok(existsSync(`public${asset}`), asset); bytes += statSync(`public${asset}`).size; }
  assert.ok(bytes < 10 * 1024 * 1024, `Alleen compacte shellassets, niet de hele characterbibliotheek: ${bytes}`);
});
test("Apple-login: configuratie zonder afzonderlijke UI-vrijgave toont geen knop", () => {
  assert.equal(nativeAppleLoginUIAvailable(true, []), false);
  assert.equal(nativeAppleLoginUIAvailable(false, ["apple-sign-in-ui-v1"]), false);
  assert.equal(nativeAppleLoginUIAvailable(true, ["apple-sign-in-ui-v1"]), true);
});
