// Werkelijke productie-UI/API; uitsluitend de eigen lokale wegwerpdatabase.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { getOrCreateTodayGame, wordGamePeriod } from "../src/lib/wordGame.ts";
import { buyWordGameHint } from "../src/lib/wordGameHints.ts";
import { getT } from "../src/lib/i18n/index.ts";

const database = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL || database.hostname !== "127.0.0.1" || database.pathname !== "/versado_word_hint_test") throw new Error("Gebruik uitsluitend de Woord-van-de-Dag-wegwerpdatabase");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.WORD_HINT_TEST_BASE_URL ?? "http://localhost:3121";
const output = process.env.WORD_HINT_TEST_OUTPUT ?? "/tmp/versado-word-hint-browser";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const errors = [], results = [], users = [];
let page;
const timeZone = Date.now() - wordGamePeriod(new Date(), "UTC").releasedAt.getTime() > 7_200_000 ? "UTC" : "Etc/GMT+12";
async function account(balance) {
  const user = await prisma.user.create({ data: { email: `word-browser-${randomUUID()}@test.invalid`, passwordHash: "x", handle: "Woordtest", discriminator: randomUUID().slice(0, 8), hintBalance: balance, xpTotal: 100, isAdmin: true, timeZone, uiLanguage: "nl", contentLanguage: "nl", activeContentCollectionId: "content_bom", onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date() } });
  users.push(user.id); return user;
}
async function contextFor(user, viewport = { width: 390, height: 844 }, dark = false) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 768, hasTouch: viewport.width < 1024, timezoneId: timeZone, colorScheme: dark ? "dark" : "light", serviceWorkers: "block" });
  await context.addInitScript((value) => localStorage.setItem("bom-theme", value), dark ? "dark" : "light");
  await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
  return context;
}
async function ready(context) {
  page = await context.newPage(); page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/word-game`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-word-hints]").waitFor();
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue("--header-height").trim() !== "");
  return page;
}
async function balance(userId) { return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).hintBalance; }
async function gameRecord(userId) { return prisma.wordGame.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } }); }
async function readableModal() {
  const words = await page.getByRole("dialog").evaluate((node) => {
    const broken = [];
    for (const element of node.querySelectorAll("h2, button")) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) for (const match of walker.currentNode.textContent.matchAll(/[\p{L}\p{N}]+/gu)) {
        const range = document.createRange(); range.setStart(walker.currentNode, match.index); range.setEnd(walker.currentNode, match.index + match[0].length);
        if (range.getClientRects().length > 1) broken.push(match[0]);
      }
      if (element.scrollWidth > element.clientWidth + 1) broken.push(element.textContent);
    }
    return broken;
  });
  assert.deepEqual(words, [], "Modalwoorden blijven heel en binnen hun element bij tekstvergroting");
}
try {
  await prisma.contentCollection.update({ where: { id: "content_bom" }, data: { enabled: true, visibleToUsers: true } });
  const player = await account(2); const context = await contextFor(player);
  // Geen socketherstel in deze ene verlies-van-response-test: de UI moet zelf
  // dezelfde idempotente aankoop kunnen herhalen. Realtime wordt apart getest.
  await context.route("**/socket.io/**", (route) => route.abort());
  await ready(context); const t = getT("nl");
  const hintButton = () => page.getByRole("button", { name: t("wordOfTheDay.hintUse"), exact: true });
  const dialog = () => page.getByRole("dialog");
  const initial = await (await context.request.get(`${base}/api/word-game`)).json();
  assert.equal(initial.word, null); assert.deepEqual(initial.hints.candidates, []); assert.equal(initial.hints.level, 0);
  assert.equal((await context.request.post(`${base}/api/word-game/hint`, { data: { gameId: initial.id, expectedLevel: 0, actionId: randomUUID(), now: "2099-01-01", candidates: ["nephi"] } })).status(), 400);
  const anonymous = await browser.newContext(); assert.equal((await anonymous.request.post(`${base}/api/word-game/hint`, { data: {} })).status(), 401); await anonymous.close();
  let requests = 0; page.on("request", (request) => { if (request.url().endsWith("/api/word-game/hint")) requests++; });
  for (const close of ["cancel", "escape", "cross"]) {
    await hintButton().click(); await dialog().waitFor();
    assert.ok((await dialog().innerText()).includes("716"));
    for (let i = 0; i < 7; i++) { await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab"); assert.equal(await dialog().evaluate((node) => node.contains(document.activeElement)), true); }
    if (close === "escape") await page.keyboard.press("Escape");
    else await dialog().getByRole("button", { name: t(close === "cancel" ? "common.cancel" : "wordOfTheDay.hintClose"), exact: true }).click();
    await page.waitForFunction(() => !document.querySelector("dialog[open]"));
    assert.equal(await hintButton().evaluate((node) => document.activeElement === node), true);
  }
  assert.equal(requests, 0); assert.equal(await balance(player.id), 2);
  let lost = true; const actionIds = [];
  await context.route("**/api/word-game/hint", async (route) => {
    actionIds.push(route.request().postDataJSON().actionId);
    if (lost) { lost = false; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort("failed"); }
    else await route.continue();
  });
  await hintButton().click();
  await dialog().getByRole("button", { name: t("wordOfTheDay.hintConfirm"), exact: true }).evaluate((node) => { node.click(); node.click(); });
  await dialog().getByRole("alert").waitFor(); assert.equal(await balance(player.id), 1); assert.equal(requests, 1);
  await dialog().getByRole("button", { name: t("wordOfTheDay.hintConfirm"), exact: true }).click();
  await page.locator("[data-word-dictionary]").waitFor(); assert.equal(actionIds.length, 2); assert.equal(actionIds[0], actionIds[1]); assert.equal(await balance(player.id), 1);
  assert.equal(await page.locator("[data-word-dictionary] li").count(), 716);
  assert.ok((await page.locator("[data-word-hint-stock]").innerText()).includes("1"));
  await page.screenshot({ path: `${output}/dictionary-390.png`, fullPage: true });
  await hintButton().click(); assert.equal(requests, 2); assert.equal(await page.locator("dialog[open]").count(), 0);
  assert.match(await page.locator("[data-word-hints] [role=status]").innerText(), /minuten.*seconden/);
  const record = await gameRecord(player.id); const wrong = JSON.parse(record.hintPools).lists[0].find((word) => word !== record.word);
  await page.getByRole("searchbox", { name: t("wordOfTheDay.hintSearch") }).fill(wrong);
  await page.getByRole("button", { name: t("wordOfTheDay.hintSelect", { word: wrong }), exact: true }).click();
  const input = page.locator('input[maxlength="5"]'); assert.equal(await input.inputValue(), wrong); assert.equal(JSON.parse((await gameRecord(player.id)).guesses).length, 0);
  const guessed = page.waitForResponse((response) => response.url().endsWith("/api/word-game/guess") && response.status() === 200);
  await page.getByRole("button", { name: t("wordOfTheDay.guess"), exact: true }).click(); await guessed;
  assert.equal(JSON.parse((await gameRecord(player.id)).guesses).length, 1);
  await page.reload(); await page.locator("[data-word-hints]").waitFor();
  assert.ok((await page.locator("[data-word-hints]").innerText()).includes("716"));
  await context.clearCookies(); await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(player.id), url: base }]); await page.reload(); await page.locator("[data-word-hints]").waitFor();
  assert.equal((await gameRecord(player.id)).hintLevel, 1); assert.equal(await balance(player.id), 1);
  // Alleen de wegwerpfixture veroudert de klok; er is geen productie-testoverride.
  await prisma.user.update({ where: { id: player.id }, data: { wordGameLastHintAt: new Date(Date.now() - 3_600_001) } });
  await page.reload(); await page.locator("[data-word-hints]").waitFor(); await hintButton().click();
  assert.ok((await dialog().innerText()).includes("180"));
  await dialog().getByRole("button", { name: t("wordOfTheDay.hintConfirm"), exact: true }).click();
  await page.locator("[data-word-dictionary]").waitFor(); assert.equal(await page.locator("[data-word-dictionary] li").count(), 180); assert.equal(await balance(player.id), 0);
  await page.getByRole("link", { name: t("wordOfTheDay.hintShop"), exact: true }).click(); await page.waitForURL("**/shop");
  await page.goto(`${base}/word-game`); await page.locator("[data-word-hints]").waitFor(); assert.equal((await gameRecord(player.id)).hintLevel, 2);
  await page.locator('input[maxlength="5"]').fill(record.word); const win = page.waitForResponse((response) => response.url().endsWith("/api/word-game/guess") && response.status() === 200);
  await page.getByRole("button", { name: t("wordOfTheDay.guess"), exact: true }).click(); await win;
  await page.getByText(t("wordOfTheDay.won"), { exact: true }).waitFor(); assert.equal(await hintButton().count(), 0);
  await page.getByRole("button", { name: t("wordOfTheDay.hintOpen"), exact: true }).click(); assert.equal(await page.locator("[data-word-dictionary] li").count(), 180);
  const completed = await gameRecord(player.id); assert.equal(completed.xpEarned, 45); assert.equal(completed.status, "WON");
  await context.close();

  const reader = await account(8); const readerGame = await getOrCreateTodayGame(reader.id, timeZone);
  await buyWordGameHint(reader.id, { gameId: readerGame.id, expectedLevel: 0, actionId: randomUUID() }, wordGamePeriod(new Date(), timeZone).releasedAt);
  const viewports = [[320, 844], [375, 844], [390, 844], [430, 932], [768, 1024], [1280, 900], [844, 390]];
  for (const [width, height] of viewports) for (const dark of [false, true]) for (const font of [100, 200]) {
    await prisma.user.update({ where: { id: reader.id }, data: { uiLanguage: "nl" } });
    const ctx = await contextFor(reader, { width, height }, dark); await ready(ctx);
    await page.addStyleTag({ content: `html{font-size:${font}%}` });
    await page.getByRole("button", { name: t("wordOfTheDay.hintOpen"), exact: true }).click();
    const list = page.locator("[data-word-dictionary] > div");
    assert.equal(await page.locator("[data-word-dictionary] li button").evaluateAll((nodes) => new Set(nodes.map((node) => node.className)).size), 1);
    const bounded = await list.evaluate((node) => ({ height: node.clientHeight, total: node.scrollHeight, overflow: getComputedStyle(node).overflowY }));
    assert.ok(bounded.total > bounded.height); assert.equal(bounded.overflow, "auto");
    const before = await list.evaluate((node) => node.scrollTop); await list.focus(); await page.keyboard.press("PageDown");
    await page.waitForFunction(() => document.querySelector("[data-word-dictionary] > div").scrollTop > 0); assert.equal(before, 0);
    await page.getByRole("button", { name: t("wordOfTheDay.hintUse"), exact: true }).click(); await dialog().waitFor();
    const layout = await dialog().evaluate((node) => {
      const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 80));
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, viewportWidth: innerWidth, viewportHeight: innerHeight, width: document.documentElement.scrollWidth, modalOnTop: node.contains(hit), focusInside: node.contains(document.activeElement) };
    });
    assert.ok(layout.x >= -1 && layout.right <= width + 1 && layout.y >= -1 && layout.bottom <= height + 1, JSON.stringify({ width, height, dark, font, layout }));
    assert.ok(layout.width <= width + 1); assert.equal(layout.modalOnTop, true); assert.equal(layout.focusInside, true);
    await readableModal();
    const confirm = dialog().getByRole("button", { name: t("wordOfTheDay.hintConfirm"), exact: true }); await confirm.scrollIntoViewIfNeeded();
    assert.equal(await confirm.evaluate((node) => { const r = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true);
    results.push({ width, height, dark, font, layout, bounded });
    if ((width === 390 && font === 100 && !dark) || (width === 320 && font === 200 && !dark) || (width === 1280 && font === 100 && dark)) await page.screenshot({ path: `${output}/confirmation-${width}-${font}-${dark ? "dark" : "light"}.png` });
    await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector("dialog[open]")); assert.equal(await balance(reader.id), 7); await ctx.close();
  }
  for (const lang of ["en", "de", "fr", "es"]) {
    await prisma.user.update({ where: { id: reader.id }, data: { uiLanguage: lang } });
    const ctx = await contextFor(reader, { width: 320, height: 844 }); await ready(ctx); await page.addStyleTag({ content: "html{font-size:200%}" }); const translate = getT(lang);
    await page.getByRole("button", { name: translate("wordOfTheDay.hintUse"), exact: true }).click(); await dialog().waitFor();
    assert.ok((await dialog().innerText()).includes("180")); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= 321), true, `Geen overflow bij ${lang} op 320 px met 200% tekst`);
    await readableModal();
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await dialog().getByRole("button", { name: translate("wordOfTheDay.hintConfirm"), exact: true }).evaluate((node) => getComputedStyle(node).transitionDuration), "1e-05s");
    await page.keyboard.press("Escape"); await ctx.close();
  }
  // Realtime: één apparaat betaalt, een tweede open apparaat ververst beide datasets.
  await prisma.user.update({ where: { id: reader.id }, data: { uiLanguage: "nl" } });
  const a = await contextFor(reader), b = await contextFor(reader); await ready(a); const pageB = await ready(b);
  await pageB.waitForFunction(() => document.querySelector("[data-word-hint-stock]")?.textContent.includes("7"));
  await new Promise((resolve) => setTimeout(resolve, 1800));
  const next = await a.request.post(`${base}/api/word-game/hint`, { data: { gameId: readerGame.id, expectedLevel: 1, actionId: randomUUID() } }); assert.equal(next.status(), 200);
  await pageB.waitForFunction(() => document.querySelector("[data-word-hint-stock]")?.textContent.includes("6") && document.querySelector("[data-word-hints]")?.textContent.includes("180"), { timeout: 15000 });
  await a.close(); await b.close();
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/results.json`, JSON.stringify({ results, functional: ["cancel", "escape", "focus", "lost-response", "double-click", "same-actionId", "cooldown", "guess-during-cooldown", "reload", "login", "shop", "completion", "realtime-two-devices", "all-translations"], errors }, null, 2));
  console.log(`Woordhints: ${results.length} viewport/thema/tekstcombinaties, vier andere talen en volledige betaal-/speelflow geslaagd.`);
} catch (error) {
  if (page && !page.isClosed()) {
    const layout = await page.evaluate(() => ({ innerWidth, viewport: visualViewport?.width, elements: [...document.querySelectorAll("body *")].map((node) => { const r = node.getBoundingClientRect(), css = getComputedStyle(node); return { tag: node.tagName, class: node.className, text: node.textContent?.slice(0, 80), x: r.x, width: r.width, right: r.right, fontSize: css.fontSize, padding: css.padding }; }).filter((node) => node.right > innerWidth - 10 || node.width > innerWidth - 10) }));
    writeFileSync(`${output}/failure-layout.json`, JSON.stringify(layout, null, 2));
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {}); writeFileSync(`${output}/failure.html`, await page.content().catch(() => ""));
  }
  throw error;
} finally { await browser.close(); await prisma.user.deleteMany({ where: { id: { in: users } } }); await prisma.$disconnect(); }
