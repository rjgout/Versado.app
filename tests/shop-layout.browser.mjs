// Echte winkel-UI op de lokale wegwerpdatabase van layout-audit/test-isolated.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";

const database = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (process.env.DATABASE_URL !== process.env.LEARNING_TEST_DATABASE_URL || database.hostname !== "127.0.0.1" || database.pathname !== "/versado_layout_test") throw new Error("Gebruik uitsluitend de lokale wegwerpdatabase");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.env.LAYOUT_TEST_BASE_URL ?? "http://localhost:3110";
const output = process.env.LAYOUT_TEST_OUTPUT ?? "/tmp/versado-shop-browser";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const users = [];
try {
  for (const [width, height, scale, language, theme] of [
    [390, 844, 100, "nl", "dark"], [320, 640, 100, "nl", "dark"],
    [740, 360, 100, "nl", "dark"], [1280, 900, 100, "nl", "light"],
    [390, 844, 200, "de", "dark"],
  ]) {
    const user = await prisma.user.create({ data: {
      email: `shop-${randomUUID()}@test.invalid`, handle: `Winkel${randomUUID().slice(0, 6)}`, discriminator: "00", passwordHash: "synthetic",
      xpTotal: 5065, hintBalance: 81, freezeCount: 6, uiLanguage: language,
      onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), kompasOffersEnabled: false,
    } });
    users.push(user.id);
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme, serviceWorkers: "block" });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    await context.addInitScript((value) => { localStorage.setItem("theme", value); }, theme);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/shop`);
    const triggers = page.getByRole("combobox");
    await triggers.nth(1).waitFor();
    if (scale !== 100) await page.addStyleTag({ content: `html { font-size: ${scale}% !important; }` });
    await page.waitForTimeout(300);
    const centered = await page.locator('main img[src="/icons/freeze.webp"]').first().evaluate((image) => {
      const row = image.parentElement;
      const box = row.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(row);
      const content = range.getBoundingClientRect();
      return Math.abs((content.left + content.right) / 2 - (box.left + box.right) / 2);
    });
    assert.ok(centered <= 1, `reeksbevriezing niet gecentreerd: ${centered}`);
    for (const trigger of [triggers.nth(0), triggers.nth(1)]) {
      await trigger.evaluate((element) => {
        element.scrollIntoView({ block: "center" });
        const nav = document.querySelector("[data-main-nav]");
        const bottom = nav?.getClientRects().length ? nav.getBoundingClientRect().top : innerHeight;
        window.scrollBy(0, element.getBoundingClientRect().bottom - bottom + 12);
      });
      await trigger.click();
      const list = page.getByRole("listbox"); await list.waitFor();
      const geometry = await list.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const headers = [...document.querySelectorAll("[data-sticky-header]")].filter((el) => el.getClientRects().length);
        const nav = document.querySelector("[data-main-nav]");
        const top = Math.max(0, ...headers.map((el) => el.getBoundingClientRect().bottom));
        const bottom = nav?.getClientRects().length ? nav.getBoundingClientRect().top : innerHeight;
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + Math.min(box.height / 2, 24));
        return { top: box.top, bottom: box.bottom, header: top, nav: bottom, portal: element.parentElement === document.body, onTop: element.contains(hit), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      assert.ok(geometry.portal && geometry.onTop, JSON.stringify(geometry));
      assert.ok(geometry.top >= geometry.header && geometry.bottom <= geometry.nav, JSON.stringify(geometry));
      assert.ok(geometry.overflow <= 1, JSON.stringify(geometry));
      await page.screenshot({ path: `${output}/shop-${width}-${scale}-${language}-${(await trigger.getAttribute("aria-controls"))?.replaceAll(":", "")}.png` });
      await page.getByRole("option", { name: "10", exact: true }).click();
      await list.waitFor({ state: "hidden" });
      assert.match(await trigger.textContent(), /10/);
      await trigger.press("ArrowDown"); await trigger.press("ArrowDown"); await trigger.press("Enter");
      assert.match(await trigger.textContent(), /2/);
      await trigger.click(); await trigger.press("Escape");
      assert.equal(await page.getByRole("listbox").count(), 0);
      await trigger.click(); await page.mouse.click(4, Math.floor(height / 2));
      assert.equal(await page.getByRole("listbox").count(), 0);
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Winkel: keuzelijsten blijven boven de onderbalk, selectie/toetsenbord/sluiten werken, voorraad is gecentreerd; 320px, landscape, desktop en 200% Duitse tekst slagen.");
} finally {
  await browser.close();
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
}
