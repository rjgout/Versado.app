// Werkelijke productie-UI en API op de wegwerpdatabase van de layout-runner.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { GAME_CATALOG } from "../src/lib/gameCatalog.ts";
import { getT } from "../src/lib/i18n/index.ts";

const db = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (db.hostname !== "127.0.0.1" || db.pathname !== "/versado_layout_test" || process.env.DATABASE_URL !== db.href) throw new Error("Uitsluitend eigen layout-runner");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.LAYOUT_TEST_BASE_URL ?? "http://localhost:3110";
const output = process.env.LAYOUT_TEST_OUTPUT ?? "/tmp/versado-layout-browser";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const courses = [], achievements = [], errors = [];
let user, book, context;
let checks = 0;
function check(name, condition) { assert.ok(condition, name); console.log(`OK  ${name}`); checks++; }
async function eventually(read, expected) {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (JSON.stringify(value) === JSON.stringify(expected)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.deepEqual(await read(), expected);
}
try {
  await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { enabled: true, visibleToUsers: true } });
  book = await prisma.book.create({ data: { slug: `cards-${randomUUID()}`, key: `cards/${randomUUID()}`, name: "Synthetisch kaartboek", order: 100, contentCollectionId: "content_bom" } });
  const chapter = await prisma.chapter.create({ data: { bookId: book.id, number: 1, order: 1, verses: { create: { number: 1, text: "Synthetische tekst voor kaarttests." } } } });
  for (let i = 0; i < 4; i++) courses.push(await prisma.course.create({ data: {
    slug: `cards-${randomUUID()}`, name: `Kaartcursus ${i}`, description: "Een synthetische cursus met voortgang en een kaartafbeelding.",
    type: "FREE_CHOICE", order: i, contentCollectionId: "content_bom", chapters: { create: { chapterId: chapter.id, order: 1 } },
  } }));
  user = await prisma.user.create({ data: { email: `${randomUUID()}@cards.test.invalid`, handle: "Kaarttester", discriminator: "00", passwordHash: "synthetic", activeContentCollectionId: "content_bom", activeCourseId: courses[0].id, contentLanguage: "nl", uiLanguage: "nl", onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), avatarCharacterId: "nephi", kompasOffersEnabled: false, timeZone: "UTC" } });
  for (const course of courses) await prisma.userCourseProgress.create({ data: { userId: user.id, courseId: course.id, subscribed: true, currentChapterId: chapter.id, comboCount: 3 } });
  for (const name of ["Kaartprestatie A", "Kaartprestatie B"]) {
    const achievement = await prisma.achievement.create({ data: { slug: `cards-${randomUUID()}`, name, description: "Synthetische prestatie", icon: "" } });
    achievements.push(achievement);
    await prisma.userAchievement.create({ data: { userId: user.id, achievementId: achievement.id } });
    await prisma.featuredAchievement.create({ data: { userId: user.id, achievementId: achievement.id, position: achievements.length - 1 } });
  }
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block" });
  await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const t = getT("nl");
  const itemKey = href => GAME_CATALOG.find(game => game.href === href)?.id ?? href.split("/").at(-1);
  const cards = () => page.locator("main article");
  const titleLinks = () => page.locator("main article .card-title-link");
  const hrefs = () => titleLinks().evaluateAll(links => links.map(link => link.getAttribute("href")));
  const menuButton = card => card.getByRole("button", { name: /^Beheer / });
  async function open(path) {
    await page.goto(`${base}${path}`);
    await titleLinks().first().waitFor();
    await page.waitForFunction(() => document.querySelector("[data-sticky-header]") && document.documentElement.style.getPropertyValue("--header-height"));
  }
  async function action(card, label) {
    await menuButton(card).click();
    await page.getByRole("menuitem", { name: t(label), exact: true }).click();
  }
  async function stored(key) {
    return prisma.userListOrder.findMany({ where: { userId: user.id, listKey: key, hidden: false }, orderBy: { order: "asc" } }).then(rows => rows.map(row => row.itemKey));
  }
  for (const [path, key] of [["/courses", "courses"], ["/live", "games"]]) {
    await open(path);
    const original = await hrefs();
    check(`${key}: meerdere echte kaarten`, original.length >= 3);
    check(`${key}: geen sleepgreep of dnd-kit-instructies`, await page.locator("main .lucide-grip-vertical, main [aria-roledescription=sortable], [id^=DndDescribedBy], [id^=DndLiveRegion]").count() === 0);
    const offset = key === "courses" ? 1 : 0;
    const targetHref = original[offset];
    const card = () => cards().filter({ has: page.locator(`a.card-title-link[href="${targetHref}"]`) });
    if (key === "courses") {
      await menuButton(cards().first()).click();
      check("actieve cursus biedt uitsluitend verbergen", await page.getByRole("menuitem").count() === 1 && await page.getByRole("menuitem", { name: t("cards.hide") }).count() === 1);
      await page.keyboard.press("Escape");
      check("actieve cursus houdt hervatten en voortgang", await cards().first().getByRole("link", { name: /Ga verder/ }).count() === 1 && await cards().first().getByRole("progressbar").count() === 1);
    }
    // iPhone Safari: een tik geeft een knop geen focus en laat het eerder gefocuste element blur-en zonder relatedTarget.
    // Chromium-touch bewijst geen echte iPhone, maar deze emulatie reproduceert het enige verschil dat het menu brak
    // (een onBlur-sluiting vóór de click); op de oude code verdwijnt het menu en loopt de actie niet.
    await page.evaluate(() => {
      window.__safariTap?.forEach(([type, handler]) => document.removeEventListener(type, handler, true));
      const onPointerDown = () => { const active = document.activeElement; if (active && active !== document.body) active.blur(); };
      const onMouseDown = event => { if (event.target instanceof Element && event.target.closest("button")) event.preventDefault(); };
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("mousedown", onMouseDown, true);
      window.__safariTap = [["pointerdown", onPointerDown], ["mousedown", onMouseDown]];
    });
    const tap = async locator => {
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    };
    await tap(menuButton(card()));
    await page.getByRole("menu").waitFor();
    const menuBox = await page.getByRole("menu").boundingBox();
    const headerBox = await page.locator("[data-sticky-header]").boundingBox();
    const navBox = await page.locator("[data-main-nav]").boundingBox();
    check(`${key}: touch-tik opent een zichtbaar menu tussen de vaste balken`, menuBox.y >= headerBox.y + headerBox.height - 1 && (!navBox || navBox.height === 0 || menuBox.y + menuBox.height <= navBox.y + 1));
    const hit = await page.getByRole("menuitem", { name: t("cards.moveDown"), exact: true }).evaluate(el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return el === top || el.contains(top);
    });
    check(`${key}: menu-item ligt bovenaan (geen kaart ervoor)`, hit);
    await tap(page.getByRole("menuitem", { name: t("cards.moveDown"), exact: true }));
    const movedByTouch = [...original]; [movedByTouch[offset], movedByTouch[offset + 1]] = [movedByTouch[offset + 1], movedByTouch[offset]];
    await eventually(hrefs, movedByTouch);
    await eventually(() => stored(key), movedByTouch.map(itemKey));
    check(`${key}: touch-tik verplaatst de kaart ondanks blur zonder relatedTarget`, true);
    await tap(menuButton(card()));
    await page.getByRole("menu").waitFor();
    await tap(page.getByRole("menuitem", { name: t("cards.moveUp"), exact: true }));
    await eventually(hrefs, original);
    await eventually(() => stored(key), original.map(itemKey));
    await tap(menuButton(card()));
    await page.getByRole("menu").waitFor();
    await page.touchscreen.tap(5, 300);
    await page.getByRole("menu").waitFor({ state: "detached" });
    check(`${key}: touch-tik buiten het menu sluit het`, true);
    await page.evaluate(() => { window.__safariTap?.forEach(([type, handler]) => document.removeEventListener(type, handler, true)); });
    await menuButton(card()).focus();
    await page.keyboard.press("ArrowDown");
    check(`${key}: eerste positie begrenst omhoog`, await page.getByRole("menuitem", { name: t("cards.moveUp") }).isDisabled());
    check(`${key}: openen focust eerste beschikbare actie`, await page.getByRole("menuitem", { name: t("cards.moveDown") }).evaluate(el => el === document.activeElement));
    await page.keyboard.press("End");
    check(`${key}: End focust verbergen`, await page.getByRole("menuitem", { name: t("cards.hide") }).evaluate(el => el === document.activeElement));
    await page.keyboard.press("Home");
    const scrollBefore = await page.evaluate(() => scrollY);
    await page.keyboard.press("Enter");
    const moved = [...original]; [moved[offset], moved[offset + 1]] = [moved[offset + 1], moved[offset]];
    await eventually(hrefs, moved);
    await eventually(() => stored(key), moved.map(itemKey));
    check(`${key}: verplaatsen navigeert niet`, new URL(page.url()).pathname === path);
    check(`${key}: focus na verplaatsen bij dezelfde kaart`, await menuButton(card()).evaluate(el => el === document.activeElement));
    check(`${key}: scrollpositie stabiel`, Math.abs((await page.evaluate(() => scrollY)) - scrollBefore) < 2);
    await page.reload(); await titleLinks().first().waitFor(); await eventually(hrefs, moved);
    checks++; console.log(`OK  ${key}: volgorde blijft na herladen`);
    await action(card(), "cards.moveUp");
    await eventually(hrefs, original);
    await eventually(() => stored(key), original.map(itemKey));
    await menuButton(cards().last()).click();
    check(`${key}: laatste positie begrenst omlaag`, await page.getByRole("menuitem", { name: t("cards.moveDown") }).isDisabled());
    await page.keyboard.press("Escape");
    check(`${key}: Escape herstelt focus`, await menuButton(cards().last()).evaluate(el => el === document.activeElement));
    // Geen slepen met een muis/vinger op inhoud of afbeelding en geen opslagrequest.
    let puts = 0;
    const onRequest = request => { if (request.method() === "PUT" && request.url().endsWith("/api/list-order")) puts++; };
    page.on("request", onRequest);
    await card().scrollIntoViewIfNeeded();
    const rect = await card().boundingBox();
    await page.mouse.move(rect.x + 10, rect.y + 90); await page.mouse.down();
    await page.mouse.move(rect.x + 15, rect.y + 200, { steps: 10 }); await page.mouse.up();
    check(`${key}: kaartinhoud activeert geen drag of opslag`, puts === 0 && JSON.stringify(await hrefs()) === JSON.stringify(original));
    page.off("request", onRequest);
    // Mislukte opslag draait de optimistische verplaatsing terug, met melding.
    await page.route("**/api/list-order", route => route.request().method() === "PUT" ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" }) : route.continue());
    await action(card(), "cards.moveDown");
    await page.getByRole("alert").filter({ hasText: t("cards.saveFailed") }).waitFor();
    await eventually(hrefs, original);
    check(`${key}: foutmelding en rollback zonder databasewijziging`, JSON.stringify(await stored(key)) === JSON.stringify(original.map(itemKey)));
    await page.unroute("**/api/list-order");
    // Terwijl opslag onderweg is mag een tweede menuactie niet schrijven.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route("**/api/list-order", async route => {
      if (route.request().method() === "PUT") { await gate; }
      await route.continue();
    });
    await action(card(), "cards.moveDown");
    await menuButton(card()).click();
    check(`${key}: gelijktijdige lokale menuacties geblokkeerd`, (await page.getByRole("menuitem").evaluateAll(items => items.every(item => item.disabled))));
    await page.keyboard.press("Escape"); release();
    await eventually(() => stored(key), moved.map(itemKey));
    await page.unroute("**/api/list-order");
    await action(card(), "cards.hide");
    const hiddenOrder = moved.filter(href => href !== targetHref);
    await eventually(hrefs, hiddenOrder);
    await page.reload(); await titleLinks().first().waitFor(); await eventually(hrefs, hiddenOrder);
    checks++; console.log(`OK  ${key}: verbergen blijft na herladen`);
    const pickerLabel = t(key === "courses" ? "courses.addCourse" : "gamesHub.addGame");
    await page.getByRole("button", { name: new RegExp(`^${pickerLabel}`) }).click();
    const hiddenName = key === "courses" ? courses[1].name : t("pages.wordSearch");
    const hiddenRow = page.locator("main li").filter({ has: page.getByText(hiddenName, { exact: true }) });
    // Het eerste zichtbare spel hangt af van de bestaande beschikbaarheidsinstellingen.
    const actualRow = key === "courses" ? hiddenRow : page.locator("main li").filter({ has: page.getByRole("button", { name: t("courses.add"), exact: true }) }).first();
    await actualRow.getByRole("button", { name: t("courses.add"), exact: true }).click();
    await eventually(hrefs, [...hiddenOrder, targetHref]);
    await page.reload(); await titleLinks().first().waitFor(); await eventually(hrefs, [...hiddenOrder, targetHref]);
    checks++; console.log(`OK  ${key}: toevoegen achteraan blijft na herladen`);
    if (key === "courses") {
      const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const progress = await prisma.userCourseProgress.findUniqueOrThrow({ where: { userId_courseId: { userId: user.id, courseId: courses[1].id } } });
      check("actieve cursus en bestaande voortgang blijven behouden", current.activeCourseId === courses[0].id && progress.comboCount === 3 && progress.subscribed);
    }
    // Een tweede tab schrijft via dezelfde bestaande API; herladen leest de laatste opslag.
    const second = await context.newPage();
    await second.goto(`${base}${path}`);
    const latest = await hrefs();
    const reversed = key === "courses" ? [latest[0], ...latest.slice(1).reverse()] : [...latest].reverse();
    const response = await second.request.put(`${base}/api/list-order`, { data: { listKey: key, itemKeys: reversed.map(itemKey) } });
    assert.equal(response.status(), 200);
    await page.reload(); await titleLinks().first().waitFor(); await eventually(hrefs, reversed);
    check(`${key}: herladen ziet laatst opgeslagen voorkeur uit andere tab`, true);
    await second.close();
    await Promise.all([page.waitForURL(url => url.pathname !== path), titleLinks().first().click()]);
    check(`${key}: kaartnavigatie intact`, new URL(page.url()).pathname !== path);
  }
  // Verborgen voorkeuren uit andere content mogen door herschikken niet verdwijnen.
  await prisma.userListOrder.create({ data: { userId: user.id, listKey: "games", itemKey: "hidden-other-content", hidden: true, order: 999 } });
  await open("/live");
  await action(cards().first(), "cards.moveDown");
  await eventually(() => stored("games"), (await hrefs()).map(itemKey));
  check("verborgen spel uit andere content blijft verborgen", (await prisma.userListOrder.findUniqueOrThrow({ where: { userId_listKey_itemKey: { userId: user.id, listKey: "games", itemKey: "hidden-other-content" } } })).hidden);
  // Smal, vergrote tekst, lange vertaling, licht/donker en desktop.
  for (const language of ["nl", "de"]) {
    await prisma.user.update({ where: { id: user.id }, data: { uiLanguage: language } });
    const tr = getT(language);
    for (const [width, font, scheme, height = 844] of [[320, 100, "light"], [320, 200, "dark"], [320, 200, "dark", 568], [1280, 100, "light"]]) {
      await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme: scheme });
      for (const path of ["/courses", "/live"]) {
        await open(path);
        await page.evaluate(font => { document.documentElement.style.fontSize = `${16 * font / 100}px`; }, font);
        const trigger = cards().last().getByRole("button", { name: tr("cards.menu", { title: await cards().last().locator(".card-title-link").innerText() }), exact: true });
        await trigger.scrollIntoViewIfNeeded(); await trigger.click();
        const menu = page.getByRole("menu"); await menu.waitFor();
        await page.waitForFunction(() => { const el = document.querySelector('[role="menu"]'); if (!el) return false; const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.top >= 0 && r.bottom <= innerHeight + 1; });
        check(`${path}/${language}/${width}/${font}: menu past en geen horizontale overflow`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const box = await trigger.boundingBox(); check(`${path}/${language}/${width}/${font}: menuaanraakvlak`, box.width >= 44 && box.height >= 44);
        await page.keyboard.press("End");
        check(`${path}/${language}/${width}x${height}/${font}: toetsenbordfocus zichtbaar in menu`, await page.evaluate(() => {
          const item = document.activeElement.getBoundingClientRect();
          const menu = document.querySelector('[role="menu"]').getBoundingClientRect();
          return item.top >= menu.top - 1 && item.bottom <= menu.bottom + 1;
        }));
        await page.screenshot({ path: `${output}/cards-${path.slice(1)}-${language}-${width}x${height}-${font}.png` });
        await page.keyboard.press("Escape");
        check(`${path}/${language}/${width}/${font}: focusherstel`, await trigger.evaluate(el => el === document.activeElement));
        await trigger.press("Enter"); await page.getByRole("menu").waitFor(); await page.keyboard.press("Tab");
        check(`${path}/${language}/${width}/${font}: Tab verlaat menu`, await page.getByRole("menu").count() === 0 && await page.evaluate(() => document.activeElement !== document.body));
      }
    }
  }
  // De gedeelde SortableList blijft werkelijk bruikbaar buiten Leren/Spelen.
  await prisma.user.update({ where: { id: user.id }, data: { uiLanguage: "nl" } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/profile?view=achievements`);
  const handle = page.getByRole("button", { name: "Kaartprestatie A verplaatsen", exact: true, includeHidden: true });
  await handle.waitFor(); await handle.scrollIntoViewIfNeeded(); await handle.focus(); await handle.press("Space");
  await eventually(() => handle.getAttribute("aria-pressed"), "true");
  await page.waitForFunction(() => [...document.querySelectorAll("[aria-live]")].some(el => el.textContent.includes("plek 1 van 2")));
  const overlay = page.locator('main div[style*="position: fixed"]').filter({ has: page.locator(".lucide-grip-vertical") });
  await overlay.waitFor();
  check("profielsleepkaart blijft onder de vaste navigatie", await overlay.evaluate(element => Number(getComputedStyle(element).zIndex) < Number(getComputedStyle(document.querySelector("[data-sticky-header]")).zIndex)));
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => [...document.querySelectorAll("[aria-live]")].some(el => el.textContent.includes("gaat naar plek 2")));
  await page.keyboard.press("Space");
  await eventually(() => handle.getAttribute("aria-pressed"), null);
  await page.getByRole("button", { name: t("profile.saveFeaturedAchievements"), exact: true }).click();
  await eventually(() => prisma.featuredAchievement.findMany({ where: { userId: user.id }, orderBy: { position: "asc" } }).then(rows => rows.map(row => row.achievementId)), [achievements[1].id, achievements[0].id]);
  check("profiel behoudt werkende sleepgreep, toetsenbord en opslag", true);
  check("geen JavaScript-paginafouten", errors.length === 0);
  console.log(`\n${checks}/${checks} kaartbeheercontroles geslaagd`);
} finally {
  await context?.close(); await browser.close();
  if (user) await prisma.user.delete({ where: { id: user.id } });
  await prisma.course.deleteMany({ where: { id: { in: courses.map(course => course.id) } } });
  if (book) await prisma.book.delete({ where: { id: book.id } });
  await prisma.achievement.deleteMany({ where: { id: { in: achievements.map(achievement => achievement.id) } } });
  await prisma.$disconnect();
}
