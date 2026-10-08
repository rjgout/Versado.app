// Beheer (/adminbackend): één structuur (hoofdpagina met groepen, subpagina's met de
// bestaande blokken), gedeelde bouwstenen, en de beveiliging ongewijzigd. Op
// broncode-contracten; de echte weergave controleer je met de browseraudit.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const file = path.join(dir, name);
  return statSync(file).isDirectory() ? walk(file) : [file];
});

const GROUPS = ["gebruikers", "content", "spellen", "communicatie", "systeem"];
const ADMIN_BLOCKS = [
  "AdminUsersClient", "AdminDeployClient", "ReseedClient", "AdminContentSwitcherClient", "FeedbackAdminClient", "EmailSettingsClient",
  "AdminLeagueSettingsClient", "AdminFsyClient", "AdminLiveGamesClient", "AdminGameSettingsClient", "AdminAlleskennerClient", "AdminChangelogClient",
  "AdminCoursesClient", "AdminBrandingClient",
];

test("elke beheerpagina controleert eerst of de gebruiker beheerder is", () => {
  const pages = ["src/app/adminbackend/page.tsx", ...GROUPS.map((g) => `src/app/adminbackend/${g}/page.tsx`)];
  for (const page of pages) {
    const source = read(page);
    assert.match(source, /await requireAdminPage\(\)/, `${page} mist de beheerderscontrole`);
    // De controle komt vóór elke gegevensopvraging.
    assert.ok(source.indexOf("requireAdminPage()") < (source.indexOf("prisma.") === -1 ? Infinity : source.indexOf("prisma.")), `${page} haalt gegevens op vóór de controle`);
  }
  const guard = read("src/lib/adminGuard.ts");
  assert.match(guard, /if \(!user\) redirect\("\/login"\)/);
  assert.match(guard, /if \(!user\.isAdmin\) redirect\("\/dashboard"\)/);
  // De bestaande voorbeeldpagina houdt zijn eigen controle.
  assert.match(read("src/app/adminbackend/content-preview/page.tsx"), /if \(!user\.isAdmin\) redirect\("\/dashboard"\)/);
});

test("alle beheer-API's controleren nog steeds isAdmin", () => {
  const routes = walk(path.join(root, "src/app/api/admin")).filter((file) => file.endsWith("route.ts"));
  assert.ok(routes.length >= 10);
  for (const route of routes) assert.match(readFileSync(route, "utf8"), /isAdmin/, `${route} mist een isAdmin-controle`);
});

test("alle bestaande beheerblokken zijn bereikbaar via precies één groepspagina", () => {
  const pages = GROUPS.map((g) => read(`src/app/adminbackend/${g}/page.tsx`)).join("\n");
  for (const block of ADMIN_BLOCKS) {
    const count = pages.split(`<${block}`).length - 1;
    assert.equal(count, 1, `${block} staat ${count} keer op een beheerpagina`);
  }
  // De hoofdpagina is alleen een overzicht: geen beheerblokken meer in één lange pagina.
  const hub = read("src/app/adminbackend/page.tsx");
  for (const block of ADMIN_BLOCKS) assert.ok(!hub.includes(`<${block}`), `${block} hoort niet op de hoofdpagina`);
  for (const g of GROUPS) assert.ok(hub.includes(`/adminbackend/${g}`), `hoofdpagina verwijst niet naar ${g}`);
});

test("beheerblokken gebruiken de gedeelde sectie en geen losse kaartstijl of oude knoppen meer", () => {
  for (const block of ADMIN_BLOCKS) {
    const source = read(`src/components/${block}.tsx`);
    assert.doesNotMatch(source, /<details className="group card/, `${block}: oude losse sectie`);
    assert.doesNotMatch(source, /className="btn-(primary|secondary)/, `${block}: oude knopklasse`);
    assert.doesNotMatch(source, /\bdark:(text|bg|border)-slate-/, `${block}: losse donkere slate-kleur`);
    assert.doesNotMatch(source, /\b(text|bg|border)-(red|green|gold|brand)-\d/, `${block}: kleur buiten de tokens`);
  }
  for (const block of ADMIN_BLOCKS.filter((b) => b !== "AdminBrandingClient" && b !== "AdminCoursesClient")) {
    assert.match(read(`src/components/${block}.tsx`), /AdminSection/, `${block} gebruikt AdminSection niet`);
  }
});

test("ingrijpende acties vragen om bevestiging en zijn als gevaar gemarkeerd", () => {
  const reseed = read("src/components/ReseedClient.tsx");
  assert.match(reseed, /await confirm\(t\("adminHub\.reseedConfirm"\), \{ destructive: true/);
  assert.match(reseed, /tone="danger"/);
  assert.match(reseed, /dangerButton/);
  const deploy = read("src/components/AdminDeployClient.tsx");
  assert.match(deploy, /await confirm\(t\("adminHub\.deployConfirm"/);
  assert.match(deploy, /tone="danger"/);
  // Een gebruiker verwijderen en een wachtwoord resetten vroegen al om bevestiging en blijven dat doen.
  const users = read("src/components/AdminUsersClient.tsx");
  assert.match(users, /await confirm\(\s*t\("adminUsers\.confirmDelete"/);
  assert.match(users, /await confirm\(t\("adminUsers\.confirmReset"/);
  assert.match(users, /dangerOutlineButton/);
});

test("de gebruikerslijst scrolt binnen een eigen vak en is doorzoekbaar", () => {
  const users = read("src/components/AdminUsersClient.tsx");
  assert.match(users, /<AdminTable/);
  assert.match(users, /<SearchField/);
  const table = read("src/components/admin/AdminTable.tsx");
  assert.match(table, /overflow-x-auto/);
  assert.match(table, /tabIndex=\{0\}/);
  assert.match(table, /role="region"/);
});

test("elke beheergroep heeft een terugbalk naar de hoofdpagina en de hoofdpagina naar het profiel", () => {
  const bar = read("src/components/SubpageBackBar.tsx");
  assert.match(bar, /pathname === "\/adminbackend"\) return \{ fallback: "\/profile"/);
  for (const g of GROUPS) assert.ok(bar.includes(`"/adminbackend/${g}"`), `${g} ontbreekt in ADMIN_SUBPAGES`);
  assert.match(bar, /fallback: "\/adminbackend", title: adminSubpage/);
  assert.match(bar, /\/adminbackend\/content-preview/);
  // De voorbeeldpagina heeft geen eigen terugknop naast de balk.
  assert.doesNotMatch(read("src/app/adminbackend/content-preview/page.tsx"), /← Beheer/);
});

test("alle teksten van de beheerhoofdpagina staan in alle vijf de talen", () => {
  const keys = ["usersTitle", "contentTitle", "gamesTitle", "commsTitle", "systemTitle", "reseedConfirm", "deployConfirm", "dangerNote"];
  for (const lang of ["nl", "en", "de", "fr", "es"]) {
    const source = read(`src/lib/i18n/messages/${lang}.ts`);
    const group = source.slice(source.search(/"?adminHub"?: \{/));
    for (const key of keys) assert.match(group.slice(0, 6000), new RegExp(`"?${key}"?: "`), `${lang}: adminHub.${key} ontbreekt`);
  }
});

test("de gedeelde beheerbouwstenen bestaan en gebruiken alleen tokens", () => {
  for (const file of ["AdminSection", "AdminCategoryCard", "AdminTable", "AdminNotice", "AdminPageHeader"]) {
    assert.ok(existsSync(path.join(root, `src/components/admin/${file}.tsx`)), `${file} ontbreekt`);
    assert.doesNotMatch(read(`src/components/admin/${file}.tsx`), /\b(bg|text|border)-(slate|red|green|gold|brand)-/, `${file}: kleur buiten de tokens`);
  }
});
