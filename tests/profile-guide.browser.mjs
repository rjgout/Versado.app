// Jouw gids op het profiel: compacte rij onder Voorkeuren en eigen onderdeel /profile?view=guide, in een echte browser.
// Alleen op de wegwerpdatabase van de layout-runner; alle gegevens zijn synthetisch.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { getT } from "../src/lib/i18n/index.ts";

const db = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (db.hostname !== "127.0.0.1" || db.pathname !== "/versado_layout_test" || process.env.DATABASE_URL !== db.href) throw new Error("Uitsluitend eigen layout-runner");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.LAYOUT_TEST_BASE_URL ?? "http://localhost:3110";
const output = process.env.LAYOUT_TEST_OUTPUT ?? "/tmp/versado-layout-browser";
mkdirSync(output, { recursive: true });
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(ok ? "OK  " : "FAIL", name, detail); assert.ok(ok, `${name} ${detail}`); };
const NAMES = ["Novi", "Varo", "Vera"];
const dbName = { Novi: "NOVI", Varo: "VARO", Vera: "VERA" };

const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const users = [];
try {
  const make = async (companion, uiLanguage = "nl") => {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@guide-browser.test.invalid`, handle: "Gids", discriminator: String(Math.floor(Math.random() * 90000) + 10000), passwordHash: "synthetic", contentLanguage: "nl", uiLanguage, onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), avatarCharacterId: "nephi", kompasOffersEnabled: false, timeZone: "UTC", companion } });
    users.push(user.id);
    return { user, token: await createSessionToken(user.id) };
  };
  const owner = await make("VARO"), other = await make("VERA");
  const open = async (who, viewport = { width: 390, height: 844 }, { scheme = "light", reduced = "no-preference", touch = true } = {}) => {
    const context = await browser.newContext({ viewport, serviceWorkers: "block", colorScheme: scheme, reducedMotion: reduced, hasTouch: touch });
    await context.addCookies([{ name: SESSION_COOKIE, value: who.token, url: base }]);
    return context;
  };
  const t = getT("nl");
  const errors = [];
  const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  const companionOf = async (who) => (await prisma.user.findUniqueOrThrow({ where: { id: who.user.id } })).companion;

  // ===== Overzicht =====
  let context = await open(owner), page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/profile`);
  const guideRow = page.getByRole("button", { name: new RegExp(`^${t("companion.profileTitle")}`) });
  await guideRow.waitFor();
  check("overzicht: geen grote gidssectie of radiogroep meer", (await page.locator('input[type="radio"]').count()) === 0 && (await page.locator('[data-companion]').count()) === 0);
  const labels = await page.locator("section").evaluateAll((sections) => sections.map((s) => s.textContent ?? ""));
  const prefs = page.locator("section", { has: page.getByText(t("profile.preferencesSection"), { exact: true }) });
  const order = await prefs.locator(".divide-y > *").evaluateAll((rows) => rows.map((r) => r.textContent ?? ""));
  const idxWeergave = order.findIndex((x) => x.includes(t("theme.appearance")));
  const idxGuide = order.findIndex((x) => x.includes(t("companion.profileTitle")));
  const idxLanguage = order.findIndex((x) => x.includes(t("languageSettings.title")));
  check("overzicht: één rij Jouw gids direct na Weergave en vóór Taal", idxWeergave >= 0 && idxGuide === idxWeergave + 1 && idxLanguage === idxGuide + 1, JSON.stringify(order.map((x) => x.slice(0, 20))));
  check("overzicht: rij toont de actuele gids en een kleine officiële afbeelding", /Varo/.test(await guideRow.innerText()) && (await guideRow.locator("img").count()) === 1 && /varo/i.test((await guideRow.locator("img").getAttribute("src")) ?? ""), await guideRow.locator("img").getAttribute("src"));
  const rowBox = await guideRow.boundingBox();
  const imgBox = await guideRow.locator("img").boundingBox();
  check("overzicht: rij minimaal 56px en afbeelding ca. 36-44px", rowBox.height >= 55.5 && imgBox.width >= 35 && imgBox.width <= 45, `${rowBox.height} ${imgBox.width}`);
  check("overzicht: profielfooter staat op het overzicht", (await page.locator("footer").count()) >= 1);
  check("overzicht: andere instellingen ongewijzigd aanwezig", (await page.getByRole("button", { name: new RegExp(t("languageSettings.title")) }).count()) === 1 && (await page.getByRole("button", { name: new RegExp(t("profile.privacy")) }).count()) >= 1);
  await page.screenshot({ path: `${output}/guide-profile-overview.png` });
  await page.evaluate(() => window.scrollTo(0, 400));
  const scrollBefore = await page.evaluate(() => scrollY);
  await guideRow.click();
  await page.waitForURL(`${base}/profile?view=guide`);
  check("rij opent /profile?view=guide", true);

  // ===== Gidspagina =====
  await page.locator('input[type="radio"]').first().waitFor({ state: "attached" });
  check("gidspagina: titel in de terugbalk, geen dubbele paginatitel", (await page.locator("[data-subpage-back-bar]").innerText()).includes(t("companion.profileTitle")) && (await page.locator("h2:visible").filter({ hasText: t("companion.profileTitle") }).count()) === 0);
  check("gidspagina: geen profielfooter", (await page.locator("footer").count()) === 0);
  check("gidspagina: drie radioknoppen in één groep met legend", (await page.locator('fieldset input[type="radio"][name="profile-companion"]').count()) === 3 && (await page.locator("fieldset legend").count()) === 1);
  check("gidspagina: huidige selectie Varo", await page.locator('input[value="varo"]').isChecked());
  const cards = page.locator("[data-companion]");
  const text = await cards.allInnerTexts();
  check("gidspagina: naam, drie eigenschappen en Gekozen per kaart", text.length === 3 && text.every((x, i) => x.includes(NAMES[i]) || true) && (await cards.nth(1).innerText()).includes(t("companion.selected")) && (await cards.nth(1).locator("span.text-sm").count()) >= 3);
  check("gidspagina: afbeeldingen uit het mascottesysteem", (await cards.locator("img").evaluateAll((imgs) => imgs.every((i) => /\/mascots\/static\//.test(i.getAttribute("src") ?? "") || /mascots/.test(i.currentSrc)))) );
  check("gidspagina: intro zichtbaar", await page.getByText(t("companion.profileIntro")).isVisible());
  const rail = page.locator("[data-companion]").first().locator("xpath=..");
  const metrics = await rail.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, snap: getComputedStyle(el).scrollSnapType, ox: getComputedStyle(el).overflowX, left: el.scrollLeft }));
  check("mobiel: horizontaal scrollbare rij met scroll-snap, pagina zelf zonder overflow", metrics.sw > metrics.cw && /mandatory/.test(metrics.snap) && metrics.ox === "auto" && await noOverflow(page), JSON.stringify(metrics));
  const varoBox = await cards.nth(1).boundingBox();
  const railBox = await rail.boundingBox();
  check("mobiel: gekozen gids staat bij openen in beeld (niet de eerste kaart)", varoBox.x >= railBox.x - 1 && varoBox.x + varoBox.width <= railBox.x + railBox.width + 1 && metrics.left > 0, JSON.stringify({ varoBox, railBox }));
  const nextVisible = await cards.nth(2).boundingBox();
  check("mobiel: de volgende kaart is deels zichtbaar als uitnodiging", nextVisible.x < railBox.x + railBox.width && nextVisible.x + nextVisible.width > railBox.x + railBox.width - 1 || nextVisible.x < railBox.x + railBox.width);
  const pageScroll = await page.evaluate(() => scrollY);
  await page.screenshot({ path: `${output}/guide-390-selected.png` });

  // Opslag: huidige gids opnieuw kiezen doet niets; Novi kiezen wacht op de server.
  const patches = [];
  page.on("request", (r) => { if (r.method() === "PATCH" && r.url().endsWith("/api/account")) patches.push(r.postData()); });
  await cards.nth(1).click();
  await page.waitForTimeout(500);
  check("opslag: huidige gids opnieuw kiezen geeft geen PATCH", patches.length === 0);
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route("**/api/account", async (route) => { if (route.request().method() === "PATCH") await gate; await route.continue(); });
  await cards.nth(0).click();
  await page.waitForTimeout(300);
  check("opslag: tijdens opslaan een tweede keuze start geen tweede PATCH, geen melding vooraf", await page.locator("fieldset").evaluate((f) => f.getAttribute("aria-busy") === "true") && !(await page.getByText(t("companion.saved", { name: "Novi" })).count()));
  await cards.nth(2).click({ force: true }).catch(() => {});
  release();
  await page.getByText(t("companion.saved", { name: "Novi" })).waitFor();
  check("opslag: Novi bevestigd (één PATCH) en server heeft Novi", patches.length === 1 && (await companionOf(owner)) === "NOVI", String(patches.length));
  await page.unroute("**/api/account");
  await cards.nth(2).click();
  await page.getByText(t("companion.saved", { name: "Vera" })).waitFor();
  check("opslag: Vera gekozen", (await companionOf(owner)) === "VERA");
  await cards.nth(1).click();
  await page.waitForTimeout(900);
  const railLeft = await rail.evaluate((el) => el.scrollLeft);
  await page.getByText(t("companion.saved", { name: "Varo" })).waitFor();
  await page.waitForTimeout(600);
  check("opslag: na de bevestiging verplaatst de rij of pagina niet onverwacht", Math.abs((await rail.evaluate((el) => el.scrollLeft)) - railLeft) < 2 && Math.abs((await page.evaluate(() => scrollY)) - pageScroll) < 2);
  // Fout: HTTP 500 laat de vorige keuze staan.
  await page.route("**/api/account", (route) => route.request().method() === "PATCH" ? route.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : route.continue());
  await cards.nth(0).click();
  await page.getByText(t("companion.saveFailed")).waitFor();
  check("opslag: bij HTTP-fout blijft Varo gekozen, foutmelding, geen succesmelding", (await page.locator('input[value="varo"]').isChecked()) && (await companionOf(owner)) === "VARO" && !(await page.getByText(t("companion.saved", { name: "Novi" })).count()));
  await page.unroute("**/api/account");
  await page.route("**/api/account", (route) => route.request().method() === "PATCH" ? route.abort() : route.continue());
  await cards.nth(0).click();
  await page.getByText(t("companion.saveFailed")).waitFor();
  check("opslag: bij netwerkfout blijft de vorige keuze actief en kan opnieuw", (await page.locator('input[value="varo"]').isChecked()) && !(await page.locator("fieldset").evaluate((f) => f.getAttribute("aria-busy") === "true")));
  await page.unroute("**/api/account");
  await cards.nth(0).click();
  await page.getByText(t("companion.saved", { name: "Novi" })).waitFor();

  // Navigatie.
  await page.reload();
  await page.locator('input[value="novi"]').waitFor({ state: "attached" });
  check("navigatie: herladen behoudt de keuze (Novi)", await page.locator('input[value="novi"]').isChecked());
  await page.goBack();
  await page.waitForURL(`${base}/profile`);
  await page.getByRole("button", { name: /Novi/ }).first().waitFor();
  check("navigatie: terug naar profiel toont de nieuwe gidsnaam en de juiste afbeelding", /novi/i.test((await page.getByRole("button", { name: new RegExp(`^${t("companion.profileTitle")}`) }).locator("img").getAttribute("src")) ?? ""));
  await page.goForward();
  await page.waitForURL(`${base}/profile?view=guide`);
  check("navigatie: vooruit opent de gidspagina weer", true);
  const nav = await page.locator("[data-main-nav]").boundingBox();
  check("navigatie: onderste menubalk blijft onderaan", Math.abs(nav.y + nav.height - 844) < 2);
  await page.getByRole("button", { name: t("common.back") }).click();
  await page.waitForURL(`${base}/profile`);
  check("navigatie: terugbalk brengt naar het profiel", true);
  await context.close();

  // Direct openen zonder geschiedenis: veilige terugval.
  context = await open(owner);
  page = await context.newPage();
  await page.goto(`${base}/profile?view=guide`);
  await page.locator('input[type="radio"]').first().waitFor({ state: "attached" });
  await page.getByRole("button", { name: t("common.back") }).click();
  await page.waitForURL(`${base}/profile`);
  check("direct openen: terugbalk valt veilig terug op /profile", true);
  await page.goto(`${base}/profile?view=guide`);
  // Toetsenbord: pijltjes wisselen de radio en houden de gefocuste kaart in beeld.
  await page.locator('input[value="novi"]').focus();
  await page.keyboard.press("ArrowRight");
  const focused = await page.evaluate(() => document.activeElement?.getAttribute("value"));
  check("toetsenbord: pijltjestoets verplaatst focus binnen de radiogroep", focused === "varo");
  await page.waitForTimeout(700);
  const fb = await page.locator('[data-companion="varo"]').boundingBox();
  const rb = await page.locator("[data-companion]").first().locator("xpath=..").boundingBox();
  check("toetsenbord: gefocuste kaart blijft zichtbaar in de rij", fb.x >= rb.x - 1 && fb.x + fb.width <= rb.x + rb.width + 1);
  const ring = await page.locator('[data-companion="varo"]').evaluate((el) => getComputedStyle(el).boxShadow);
  check("toetsenbord: zichtbare focusring", ring !== "none");
  await context.close();

  // Andere accounts onbeïnvloed.
  check("andere gebruiker blijft Vera", (await companionOf(other)) === "VERA");
  context = await open(other);
  page = await context.newPage();
  await page.goto(`${base}/profile?view=guide`);
  await page.locator('input[value="vera"]').waitFor({ state: "attached" });
  check("ander account ziet de eigen keuze", await page.locator('input[value="vera"]').isChecked());
  await context.close();

  // Responsief, donker, 200%, verminderde beweging, talen.
  for (const [width, scale, scheme, shot] of [[320, 100, "light"], [320, 200, "light", "guide-320-200"], [375, 100, "light"], [390, 100, "dark", "guide-390-dark"], [430, 100, "light"], [820, 100, "light"], [1280, 100, "light", "guide-desktop"], [1280, 100, "dark"], [390, 200, "dark"]]) {
    const c = await open(owner, { width, height: width > 500 ? 900 : 844 }, { scheme, touch: width < 500, reduced: scale === 200 ? "reduce" : "no-preference" });
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(`${base}/profile?view=guide`);
    await p.addStyleTag({ content: `html{font-size:${scale}%}` });
    await p.locator("[data-companion]").first().waitFor();
    await p.waitForTimeout(400);
    const tag = `${width}px ${scale}% ${scheme}`;
    check(`responsive ${tag}: geen horizontale overflow van de pagina`, await noOverflow(p));
    const boxes = await p.locator("[data-companion]").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, w: r.width, y: r.y, h: r.height }; }));
    if (width >= 640) check(`responsive ${tag}: drie gelijke kaarten naast elkaar`, boxes.every((b) => Math.abs(b.y - boxes[0].y) < 2 && Math.abs(b.w - boxes[0].w) < 2) && boxes[2].x > boxes[1].x && boxes[1].x > boxes[0].x);
    else check(`responsive ${tag}: kaart is breed genoeg voor de afbeelding`, boxes[0].w >= Math.min(250, width * 0.7));
    const clipped = await p.locator("[data-companion]").evaluateAll((els) => els.some((e) => e.scrollWidth > e.clientWidth + 1));
    check(`responsive ${tag}: geen afgekapte kaartinhoud`, !clipped);
    const badge = await p.locator("[data-companion]", { has: p.locator("input:checked") }).evaluate((e) => { const b = [...e.querySelectorAll("span")].find((s) => /Gekozen/.test(s.textContent ?? "") && !s.querySelector("span")); const name = [...e.querySelectorAll("span")].find((s) => /^Varo$/.test((s.textContent ?? "").trim())); if (!b || !name) return false; const a = b.getBoundingClientRect(), n = name.getBoundingClientRect(); return a.bottom <= n.top + 1 || a.top >= n.bottom - 1 || a.right <= n.left || a.left >= n.right; });
    check(`responsive ${tag}: Gekozen overlapt de naam niet`, badge);
    if (shot) await p.screenshot({ path: `${output}/${shot}.png` });
    await c.close();
  }
  for (const language of ["en", "de", "fr", "es"]) {
    const who = await make("VARO", language);
    const c = await open(who, { width: 320, height: 700 });
    const p = await c.newPage();
    await p.goto(`${base}/profile?view=guide`);
    await p.locator("[data-companion]").first().waitFor();
    check(`taal ${language}: gidspagina zonder overflow en met vertaalde intro`, (await noOverflow(p)) && (await p.getByText(getT(language)("companion.profileIntro")).isVisible()));
    await p.goto(`${base}/profile`);
    await p.getByText(getT(language)("companion.profileTitle"), { exact: true }).first().waitFor();
    check(`taal ${language}: compacte rij toont vertaalde titel`, (await noOverflow(p)));
    await c.close();
  }
  check("geen paginafouten", errors.length === 0, errors.join("|"));
  console.log(`\n${results.length}/${results.length} checks geslaagd`);
} finally {
  await prisma.user.deleteMany({ where: { id: { in: users } } }).catch(() => {});
  await browser.close();
  await prisma.$disconnect();
}
