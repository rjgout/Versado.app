// Echte productie-UI en API op de wegwerpdatabase van layout-audit/test-isolated.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { GAME_CATALOG } from "../src/lib/gameCatalog.ts";
import { getT, messagesFor } from "../src/lib/i18n/index.ts";

const database = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL || database.hostname !== "127.0.0.1" || database.pathname !== "/versado_layout_test") throw new Error("Gebruik uitsluitend de lokale wegwerpdatabase");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.LAYOUT_TEST_BASE_URL ?? "http://localhost:3110";
const output = process.env.LAYOUT_TEST_OUTPUT ?? "/tmp/versado-layout-browser";
mkdirSync(output, { recursive: true });
const probe = process.argv.includes("--probe");
const headerOnly = process.argv.includes("--header-only");
const interactionsOnly = process.argv.includes("--interactions-only");
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
let user;
let context, page;
const results = [];
try {
  await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { visibleToUsers: true, enabled: true } });
  await prisma.contentCollection.update({ where: { id: "content_dc" }, data: { visibleToUsers: true, enabled: true } });
  await prisma.contentSwitcherSettings.upsert({ where: { id: "singleton" }, create: { enabled: true }, update: { enabled: true } });
  await prisma.gameSettings.upsert({ where: { id: "singleton" }, create: { wordSearchEnabled: true }, update: { wordSearchEnabled: true } });
  for (const game of GAME_CATALOG) await prisma.gameContentScope.upsert({ where: { gameKey_contentCollectionId: { gameKey: game.id, contentCollectionId: "content_bom" } }, create: { gameKey: game.id, contentCollectionId: "content_bom" }, update: {} });
  const book = await prisma.book.create({ data: { slug: `layout-${randomUUID()}`, key: "bofm/1-ne", name: "1 Nephi", order: 1, contentCollectionId: "content_bom",
    chapters: { create: { number: 1, order: 1, verses: { create: { number: 1, text: "Een korte tekst voor de geïsoleerde layoutcontrole." } } } } }, include: { chapters: true } });
  const courses = [];
  for (let i = 0; i < 5; i++) courses.push(await prisma.course.create({ data: { slug: `layout-${randomUUID()}`, name: ["Hoofdstuk voor hoofdstuk", "Vrije keuze", "Stap voor stap", "Schriftstudie", "Verder lezen"][i], type: "FRONT_TO_BACK", order: i, contentCollectionId: "content_bom", chapters: { create: { chapterId: book.chapters[0].id, order: 0 } } } }));
  user = await prisma.user.create({ data: { email: `layout-${randomUUID()}@test.invalid`, passwordHash: "x", handle: "Layout", discriminator: "00", isAdmin: true,
    activeContentCollectionId: "content_bom", activeCourseId: courses[0].id, uiLanguage: "nl", contentLanguage: "nl", onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), avatarCharacterId: "nephi", kompasOffersEnabled: false,
    courseProgress: { create: courses.map((course) => ({ courseId: course.id, subscribed: true })) } } });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
  await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
  page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  async function ready(path) {
    await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--header-height").trim() !== "");
    await page.evaluate(() => document.fonts.ready);
  }
  for (const path of (interactionsOnly ? [] : ["/dashboard", "/courses", "/live"])) {
    await ready(path);
    const trigger = page.locator('article button[aria-haspopup="menu"]').first();
    if (path !== "/dashboard") await trigger.waitFor();
    await page.evaluate(() => scrollTo(0, 150));
    if (path !== "/dashboard") await trigger.evaluate((button) => { const r = button.getBoundingClientRect(); const h = document.querySelector("[data-sticky-header]").getBoundingClientRect(); scrollTo(0, scrollY + r.top + r.height / 2 - h.height / 2); });
    const state = await page.evaluate((path) => {
      const header = document.querySelector("[data-sticky-header]");
      const button = document.querySelector('article button[aria-haspopup="menu"]');
      const r = button?.getBoundingClientRect();
      const x = r ? r.x + r.width / 2 : innerWidth / 2, y = r ? r.y + r.height / 2 : header.getBoundingClientRect().height / 2;
      const hit = document.elementFromPoint(x, y);
      const ancestry = []; for (let e = button; e; e = e.parentElement) { const s = getComputedStyle(e); ancestry.push({ tag: e.tagName, class: e.className, z: s.zIndex, position: s.position, transform: s.transform, isolation: s.isolation }); }
      return { path, headerZ: getComputedStyle(header).zIndex, headerPosition: getComputedStyle(header).position, headerOnTop: header.contains(hit), hit: hit?.outerHTML.slice(0, 150), ancestry };
    }, path);
    results.push(state);
    if (!probe) assert.equal(state.headerOnTop, true, `${path}: kaart bedekt de header`);
    await page.screenshot({ path: `${output}/${probe ? "before" : "after"}-${path.slice(1)}-390.png` });
  }
  if (!interactionsOnly) {
  await ready("/word-search");
  await page.locator('[role="radiogroup"] button').first().waitFor();
  for (const width of [320, 375, 390, 430]) for (const font of [100, 200]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate((font) => document.documentElement.style.fontSize = `${font === 200 ? 32 : 16}px`, font);
    const state = await page.locator('[role="radiogroup"] button').evaluateAll((buttons) => buttons.map((button) => { const range = document.createRange(); range.selectNodeContents(button); const s = getComputedStyle(button); return { text: button.textContent, rect: button.getBoundingClientRect().toJSON(), lines: range.getClientRects().length, textWidth: range.getBoundingClientRect().width, fontSize: s.fontSize, padding: s.padding, whiteSpace: s.whiteSpace, overflowWrap: s.overflowWrap, wordBreak: s.wordBreak }; }));
    results.push({ width, font, difficulties: state });
    if (!probe && !headerOnly) for (const item of state) { assert.equal(item.lines, 1, `${width}/${font}: ${item.text} afgebroken`); assert.ok(item.textWidth <= item.rect.width + 1); }
    if (width === 390 || width === 320) await page.screenshot({ path: `${output}/${probe ? "before" : "after"}-wordsearch-${width}-${font}.png`, fullPage: true });
  }
  }
  writeFileSync(`${output}/${probe ? "baseline" : "results"}.json`, JSON.stringify(results, null, 2));
  if (probe) {
    assert.ok(results.find((r) => r.path === "/dashboard").headerOnTop);
    assert.ok(results.filter((r) => r.path && r.path !== "/dashboard").every((r) => !r.headerOnTop), "headerregressie niet gereproduceerd");
    assert.ok(results.some((r) => r.difficulties?.some((b) => b.lines > 1)), "woordbreuk niet gereproduceerd");
    console.log("Beide regressies gereproduceerd in de echte productie-UI; computed styles, hit-test en screenshots opgeslagen.");
  } else if (!headerOnly) {
    const views = [[320, 844], [375, 844], [390, 844], [430, 932], [768, 1024], [1280, 900], [844, 390]];
    for (const [width, height] of (interactionsOnly ? [] : views)) for (const scheme of ["light", "dark"]) for (const font of [100, 200]) {
      const tag = `${width}x${height}-${scheme}-${font}`;
      await context.close();
      context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, isMobile: width <= 430 || height === 390, hasTouch: width < 1024, serviceWorkers: "block" });
      await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
      page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
      async function open(path) {
        await ready(path);
        await page.evaluate((font) => {
          document.documentElement.style.fontSize = `${font === 200 ? 32 : 16}px`;
          document.documentElement.style.setProperty("--safe-area-inset-top", "20px");
          document.documentElement.style.setProperty("--safe-area-inset-bottom", "20px");
        }, font);
        await page.waitForFunction(() => Math.abs(document.querySelector("[data-sticky-header]").getBoundingClientRect().height - parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height"))) < 1);
      }
      for (const path of ["/dashboard", "/courses", "/live"]) {
        await open(path);
        const trigger = page.locator('article button[aria-haspopup="menu"]').first();
        if (path !== "/dashboard") await trigger.waitFor();
        const fixed = await page.locator("[data-sticky-header]").evaluate((header) => getComputedStyle(header).position === "fixed");
        if (fixed && path !== "/dashboard") await trigger.evaluate((button) => { const r = button.getBoundingClientRect(); scrollTo(0, scrollY + r.top + r.height / 2 - document.querySelector("[data-sticky-header]").getBoundingClientRect().height / 2); });
        else if (fixed) await page.evaluate(() => scrollTo(0, 150));
        const state = await page.evaluate(() => {
          const header = document.querySelector("[data-sticky-header]"); const h = header.getBoundingClientRect();
          let hits = 0, total = 0;
          if (h.bottom > 0) for (const fx of [.1, .5, .9]) for (const fy of [.25, .75]) { total++; if (header.contains(document.elementFromPoint(innerWidth * fx, Math.max(1, h.top + h.height * fy)))) hits++; }
          const nav = document.querySelector("[data-main-nav]"); const n = nav.getBoundingClientRect();
          return { headerHits: hits, total, headerPosition: getComputedStyle(header).position, headerTop: h.top,
            navBottom: n.height > 0 ? n.bottom : null, navFixed: getComputedStyle(nav).position, width: innerWidth, docWidth: document.documentElement.scrollWidth };
        });
        assert.equal(state.headerHits, state.total, `${tag} ${path}: inhoud boven de header`);
        assert.ok(state.docWidth <= state.width + 1, `${tag} ${path}: horizontale overflow`);
        if (state.navBottom !== null) { assert.ok(Math.abs(state.navBottom - height) < 1); assert.equal(state.navFixed, "fixed"); }
        if (fixed) assert.equal(state.headerTop, 0);
        results.push({ tag, path, ...state });
        // De kiezer is nu een Focus-pagina, geen portal in de header.
        await page.evaluate(() => scrollTo(0, 0));
        await page.locator('[data-kompas-target="content-switcher"] > a').click();
        await page.waitForURL(`${base}/content`);
        await page.locator('[data-content-picker]').waitFor();
        const pickerShell = await page.evaluate(() => ({
          globalHeader: getComputedStyle(document.querySelector('[data-app-global-header]')).display,
          nav: getComputedStyle(document.querySelector('[data-main-nav]')).display,
          back: document.querySelector('[data-subpage-back-bar]').getBoundingClientRect().bottom,
          top: document.querySelector('[data-content-picker] h1').getBoundingClientRect().top,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        }));
        assert.equal(pickerShell.globalHeader, "none"); assert.equal(pickerShell.nav, "none");
        assert.ok(pickerShell.top >= pickerShell.back - 1); assert.equal(pickerShell.overflow, false);
        await page.locator('[data-subpage-back-bar] button').click(); await page.waitForURL(`${base}${path}`);
        if (width === 390 && font === 100) {
          if (path !== "/dashboard") await trigger.evaluate((button) => { const r = button.getBoundingClientRect(); scrollTo(0, scrollY + r.top + r.height / 2 - document.querySelector("[data-sticky-header]").getBoundingClientRect().height / 2); });
          await page.screenshot({ path: `${output}/header-${path.slice(1)}-${tag}.png` });
        }
      }
      await open("/word-search");
      const choices = page.locator('[role="radiogroup"] button'); await choices.first().waitFor();
      const labels = await choices.evaluateAll((buttons) => buttons.map((button) => {
        const range = document.createRange(); range.selectNodeContents(button); const text = range.getBoundingClientRect(); const r = button.getBoundingClientRect();
        return { text: button.textContent, lines: range.getClientRects().length, left: r.left, right: r.right, width: r.width, height: r.height, top: r.top, textLeft: text.left, textRight: text.right };
      }));
      for (const label of labels) {
        assert.equal(label.lines, 1, `${tag}: ${label.text} afgebroken`);
        assert.ok(label.textLeft >= label.left && label.textRight <= label.right, `${tag}: tekst buiten knop`);
        assert.ok(label.height >= 48 && label.left >= 0 && label.right <= width + 1);
      }
      assert.ok(Math.max(...labels.map((label) => label.width)) - Math.min(...labels.map((label) => label.width)) < 1, `${tag}: ongelijke knopbreedtes`);
      for (let i = 0; i < 3; i++) {
        await choices.nth(i).click(); assert.equal(await choices.nth(i).getAttribute("aria-pressed"), "true");
        // De bestaande kleurtransitie moet een frame krijgen na de selectie.
        await page.waitForFunction(() => {
          const buttons = [...document.querySelectorAll('[role="radiogroup"] button')];
          const active = buttons.find((button) => button.getAttribute("aria-pressed") === "true");
          return active && buttons.filter((button) => button !== active).every((button) => getComputedStyle(button).backgroundColor !== getComputedStyle(active).backgroundColor);
        });
        const selected = await choices.evaluateAll((buttons) => buttons.map((b) => ({ pressed: b.getAttribute("aria-pressed"), bg: getComputedStyle(b).backgroundColor })));
        assert.equal(selected.filter((s) => s.pressed === "true").length, 1);
        assert.ok(selected.filter((s) => s.pressed !== "true").every((s) => s.bg !== selected[i].bg));
      }
      const columns = new Set(labels.map((label) => Math.round(label.left))).size;
      assert.ok(width !== 1280 || font !== 100 || columns === 3, "desktop toont niet drie kolommen");
      assert.ok(width !== 320 || columns === 1, "320px moet terugvallen naar één kolom");
      const play = page.getByRole("button", { name: "Spelen", exact: true });
      // Gewoon vensterscrollen naar het vrije gebied tussen de vaste balken.
      // Alleen isVisible() detecteert geen knop die achter de onderbalk staat.
      await play.evaluate((button) => {
        const header = document.querySelector("[data-sticky-header]"); const h = header.getBoundingClientRect();
        const nav = document.querySelector("[data-main-nav]").getBoundingClientRect();
        const top = getComputedStyle(header).position === "fixed" ? h.bottom : 0;
        const bottom = nav.height > 0 ? nav.top : innerHeight;
        const r = button.getBoundingClientRect(); scrollBy(0, r.top - (top + bottom - r.height) / 2);
      });
      assert.ok(await play.evaluate((button) => { const r = button.getBoundingClientRect(); return button.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), `${tag}: Spelen wordt bedekt`);
      const cta = await play.boundingBox(); assert.ok(cta.x >= 0 && cta.x + cta.width <= width + 1 && cta.height >= 44);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      // Heropenen/resize verandert de geselecteerde moeilijkheid niet.
      assert.equal(await choices.nth(2).getAttribute("aria-pressed"), "true");
      results.push({ tag, columns, labels, cta });
      if ([320, 390, 1280].includes(width)) {
        await page.waitForTimeout(250); // Bewijs na de bestaande pressed-/kleurtransitie.
        await page.screenshot({ path: `${output}/wordsearch-controls-${tag}.png` });
        await page.screenshot({ path: `${output}/wordsearch-${tag}.png`, fullPage: true });
      }
    }

    // Kaartacties en kaartmenu's blijven onder de vaste navigatie.
    for (const [width, height] of [[390, 844], [1280, 900]]) {
    await context.close();
    context = await browser.newContext({ viewport: { width, height }, isMobile: width === 390, hasTouch: width === 390, serviceWorkers: "block" });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
    for (const path of ["/courses", "/live"]) {
      await ready(path);
      const cards = page.locator('article').filter({ has: page.locator('button[aria-haspopup="menu"]') });
      await cards.first().waitFor();
      const title = await cards.nth(2).locator(".card-title-link").textContent();
      const card = cards.filter({ has: page.getByRole("link", { name: title, exact: true }) });
      const trigger = card.getByRole("button", { name: `Beheer ${title}`, exact: true });
      await trigger.scrollIntoViewIfNeeded(); await trigger.click();
      const menu = page.getByRole("menu", { name: `Beheer ${title}`, exact: true }); await menu.waitFor();
      await page.keyboard.press("ArrowDown"); assert.equal(await menu.locator(":focus").count(), 1);
      const moved = page.waitForResponse((r) => r.url().includes("/api/list-order") && r.request().method() === "PUT");
      moved.catch(() => {}); // Bij een eerdere UI-fout blijft de buitenste catch het bewijs opslaan.
      await menu.getByRole("menuitem", { name: "Eerder in de lijst", exact: true }).click();
      // Tijdens de herordening én na afloop blijven de balken boven.
      for (let i = 0; i < 4; i++) {
        const frame = await page.evaluate(() => ({ transforms: document.getAnimations().filter((a) => a.playState === "running").length,
          headerOnTop: document.querySelector("[data-sticky-header]").contains(document.elementFromPoint(innerWidth / 2, 30)) }));
        assert.ok(frame.headerOnTop); results.push({ path, reorderFrame: frame }); await page.waitForTimeout(50);
      }
      assert.equal((await moved).status(), 200);
      await page.waitForTimeout(250);
      assert.equal(await page.locator('main .lucide-grip-vertical, main [aria-roledescription="sortable"], [id^="DndLiveRegion"]').count(), 0, "Leren en Spelen bieden geen slepen meer aan");
      await trigger.scrollIntoViewIfNeeded(); await trigger.click(); await menu.waitFor();
      const layering = await trigger.evaluate((button) => ({
        bars: Number(getComputedStyle(document.querySelector("[data-sticky-header]")).zIndex),
        local: Number(getComputedStyle(button.parentElement).zIndex),
      }));
      assert.ok(layering.local < layering.bars, "kaartmenu blijft onder de shell");
      assert.ok(await page.evaluate(() => document.querySelector("[data-sticky-header]").contains(document.elementFromPoint(innerWidth / 2, 25))));
      await page.screenshot({ path: `${output}/card-menu-${path.slice(1)}-header-${width}.png` });
      if (width === 390) {
        assert.ok(await page.evaluate(() => document.querySelector("[data-main-nav]").contains(document.elementFromPoint(195, 820))));
      }
      await page.keyboard.press("Escape"); await menu.waitFor({ state: "detached" });
      results.push({ path, layering });
      await page.reload(); await cards.first().waitFor(); assert.equal(await cards.nth(1).locator(".card-title-link").textContent(), title, "herordening niet bewaard");
    }
    }

    await context.close();
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: "block" });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));

    // Lange vertalingen gebruiken dezelfde labels en layout; geen tekstwijziging.
    for (const language of ["de", "en", "fr", "es"]) {
      await prisma.user.update({ where: { id: user.id }, data: { uiLanguage: language } });
      await ready("/word-search"); await page.setViewportSize({ width: 320, height: 844 });
      await page.evaluate(() => document.documentElement.style.fontSize = "32px");
      const t = messagesFor(language).wordSearch;
      for (const label of [t.easy, t.medium, t.hard]) {
        const button = page.getByRole("button", { name: label, exact: true }); await button.waitFor();
        assert.ok(await button.evaluate((b) => { const range = document.createRange(); range.selectNodeContents(b); const r = b.getBoundingClientRect(), text = range.getBoundingClientRect(); return range.getClientRects().length === 1 && text.left >= r.left && text.right <= r.right && r.right <= innerWidth; }), `${language}: label past niet`);
      }
    }
    await prisma.user.update({ where: { id: user.id }, data: { uiLanguage: "nl" } });

    // Alle moeilijkheden starten en genereren via echte API, daarna echt spelen.
    for (const [level, label, xp] of [["EASY", "Makkelijk", 10], ["MEDIUM", "Gemiddeld", 15], ["HARD", "Moeilijk", 20]]) {
      await page.setViewportSize({ width: 390, height: 844 }); await ready("/live");
      await page.getByRole("link", { name: "Woordzoeker", exact: true }).click();
      await page.locator('[role="radiogroup"]').waitFor();
      await page.locator("[data-subpage-back-bar] button").click(); await page.waitForURL(`${base}/live`);
      await page.getByRole("link", { name: "Woordzoeker", exact: true }).click();
      await page.getByRole("button", { name: label, exact: true }).click();
      const started = page.waitForResponse((r) => r.url().endsWith("/api/word-search") && r.request().method() === "POST");
      await page.getByRole("button", { name: "Spelen", exact: true }).click();
      const response = await started; assert.equal(response.request().postDataJSON().difficulty, level); assert.equal(response.status(), 200);
      const game = await response.json(); assert.equal(game.difficulty, level);
      await page.waitForURL(`${base}/word-search/${game.id}`); await page.getByRole("grid").waitFor();
      assert.equal(await page.getByRole("gridcell").count(), game.size ** 2);
      assert.equal(game.words.some((w) => w.start || w.end), false, "oplossing lekt vóór spelen");
      const stored = await prisma.wordSearchGame.findUniqueOrThrow({ where: { id: game.id } }); const words = JSON.parse(stored.words);
      for (const [index, word] of words.entries()) {
        const first = page.locator(`[data-cell][data-row="${word.start.row}"][data-col="${word.start.col}"]`);
        const last = page.locator(`[data-cell][data-row="${word.end.row}"][data-col="${word.end.col}"]`);
        await page.getByRole("grid").scrollIntoViewIfNeeded(); const a = await first.boundingBox(), b = await last.boundingBox();
        const found = page.waitForResponse((r) => r.url().endsWith(`/word-search/${game.id}/find`));
        if (index === 0 && level === "EASY") {
          const session = await context.newCDPSession(page);
          await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x + a.width / 2, y: a.y + a.height / 2 }] });
          await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
          await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await session.detach();
        } else {
          await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
        }
        const result = await (await found).json(); assert.equal(result.correct, true); assert.equal(result.view.foundWords.length, index + 1);
        await page.waitForFunction((count) => document.querySelectorAll("aside li.line-through").length === count, index + 1);
      }
      await page.getByRole("heading", { name: "Puzzel voltooid! 🎉", exact: true }).waitFor();
      const completed = await prisma.wordSearchGame.findUniqueOrThrow({ where: { id: game.id } }); assert.equal(completed.status, "COMPLETED"); assert.equal(completed.xpEarned, xp);
      const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      const retried = await context.request.post(`${base}/api/word-search/${game.id}/find`, { data: { start: words.at(-1).start, end: words.at(-1).end } }); assert.equal(retried.status(), 200);
      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } }); assert.equal(after.xp, before.xp); assert.equal(after.currentStreak, before.currentStreak);
      const celebration = page.locator('[role="dialog"][aria-labelledby="streak-celebration-title"]');
      assert.equal(await celebration.count(), 0, "de resultaatkaart blijft voorrang houden op de reeksviering");
      await page.getByRole("link", { name: "Terug naar spellen", exact: true }).click(); await page.waitForURL(`${base}/live`);
      if (level === "EASY") {
        // De eerste echte afronding geeft een reeks. Sinds #210 volgt de fullscreen viering pas na het verlaten van de activiteit.
        // Wacht en sluit via de echte bediening; door de overlay heen klikken zou de navigatieregressie verbergen.
        await celebration.waitFor();
        await celebration.getByRole("button", { name: getT("nl")("streakCelebration.close"), exact: true }).click();
        await celebration.waitFor({ state: "detached" });
      }
      results.push({ level, size: game.size, words: words.length, xp: completed.xpEarned, retryWithoutReward: true });
    }
    assert.deepEqual(errors, [], "clientfouten");
    writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
    console.log(`${interactionsOnly ? "Gerichte interacties" : "Browser: 28 viewport/thema/tekstcombinaties, Vandaag/Leren/Spelen"}, kaartmenu/herordenen/navigatie/contentkiezer, vijf talen en alle drie echte Woordzoeker-spellen geslaagd.`);
  }
} catch (error) {
  writeFileSync(`${output}/failure.json`, JSON.stringify({ error: String(error.stack), results }, null, 2));
  if (page) { await page.screenshot({ path: `${output}/failure.png` }); writeFileSync(`${output}/failure.html`, await page.content()); }
  throw error;
} finally {
  await browser.close();
  // De runner verwijdert vervolgens de volledige wegwerpdatabase.
  await prisma.$disconnect();
}
