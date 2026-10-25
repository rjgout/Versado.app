import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { getT } from "../src/lib/i18n/index.ts";
import { dailyTextFixture, dailyTextTestEnvironment, QUOTE } from "./fixtures/daily-text.ts";

const base = dailyTextTestEnvironment();
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const output = "/tmp/versado-daily-text-browser"; mkdirSync(output, { recursive: true });
try {
  const f = await dailyTextFixture();
  for (const [language, scale] of [["nl",100],["de",200]]) {
    const t = getT(language);
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@daily-text-browser.test.invalid`, passwordHash: "synthetic", handle: `Dagtekst${randomUUID().slice(0,8)}`, discriminator: "00", timeZone: "UTC", uiLanguage: language, contentLanguage: "nl", activeContentCollectionId: f.own.id, avatarCharacterId: "nephi", emailVerifiedAt: new Date(), onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), kompasOffersEnabled: false } });
    const context = await browser.newContext({ viewport: { width: 320, height: 844 }, timezoneId: "UTC", colorScheme: "dark", serviceWorkers: "block" });
    await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
    if (scale === 200) await context.addInitScript(() => document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = "200%"; }));
    const page = await context.newPage(), errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(`${base}/profile?view=notifications`);
    let select = page.getByRole("combobox", { name: t("profile.dailyTextSource") });
    await select.waitFor(); await select.scrollIntoViewIfNeeded();
    assert.match(await select.innerText(), /Kom dan en volg Mij/);
    await select.click();
    const option = page.getByRole("option", { name: "Andere Schriftbron", exact: true });
    const bounds = await option.boundingBox(); assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 321);
    const saved = page.waitForResponse(r => r.url().endsWith("/api/account") && r.request().method() === "PATCH");
    await option.click(); assert.equal((await saved).status(), 200);
    await page.reload(); select = page.getByRole("combobox", { name: t("profile.dailyTextSource") });
    await select.waitFor(); assert.match(await select.innerText(), /Andere Schriftbron/);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).dailyTextSource, f.other.work);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await select.scrollIntoViewIfNeeded();
    const labelFits = await select.locator("[data-daily-text-source-label]").evaluate(label => label.scrollWidth <= label.clientWidth + 1 && label.scrollHeight <= label.clientHeight + 1);
    assert.ok(labelFits, "de gekozen bronnaam wordt ook bij 200% tekst volledig weergegeven");
    await page.screenshot({ path: `${output}/profile-${language}-${scale}.png` });
    await page.route("**/api/account", route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "synthetic" }) }));
    await select.click(); await page.getByRole("option", { name: "Eigen Schriftbron", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: t("profile.dailyTextSourceSaveFailed") }).waitFor();
    assert.match(await select.innerText(), /Andere Schriftbron/, "mislukte opslag toont geen onopgeslagen keuze");
    await page.unroute("**/api/account");
    await page.goto(`${base}/dashboard`);
    await page.getByText("ALLEEN-EIGEN-BRON", { exact: true }).waitFor();
    await page.getByText("ALLEEN-EIGEN-BRON", { exact: true }).scrollIntoViewIfNeeded();
    assert.equal(await page.getByText("ALLEEN-ANDERE-BRON", { exact: true }).count(), 0, "Vandaag gebruikt niet de meldingsvoorkeur");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${output}/today-${language}-${scale}.png` });
    await prisma.user.update({ where: { id: user.id }, data: { activeContentCollectionId: f.empty.id } });
    await prisma.contentCollection.update({ where: { id: f.bible.id }, data: { enabled: false } });
    try {
      await page.reload();
      await page.getByText(QUOTE, { exact: true }).waitFor();
      await page.getByText(QUOTE, { exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/cfm-${language}-${scale}.png` });
      await page.getByRole("link", { name: t("dashboard.readMore"), exact: true }).click();
      await page.locator("#study-day-quote").waitFor();
      assert.equal(new URL(page.url()).searchParams.get("weergave"), "volledig");
      assert.match(await page.locator("#study-day-quote").innerText(), /Synthetisch citaat uit de actuele weekles/);
    } finally { await prisma.contentCollection.update({ where: { id: f.bible.id }, data: { enabled: true } }); }
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Dagtekst: profielbron opslaan/herladen, fout en herstel, Vandaag onafhankelijk; 320px en 200% Duitse tekst geslaagd.");
} finally { await browser.close(); await prisma.$disconnect(); }
