import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { prisma } from "../src/lib/db.ts";
import { SESSION_COOKIE } from "../src/lib/auth.ts";
import { assertReferenceTestEnvironment } from "./fixtures/reference-content.mjs";
const base = assertReferenceTestEnvironment();
const flow = JSON.parse(await fs.readFile(path.join(path.dirname(process.env.CONTENT_MIGRATION_TEST_STATE), "scripture-publication-flow.json"), "utf8"));
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const output = "/tmp/versado-scripture-publication-browser";
await fs.mkdir(output, { recursive: true });
const results = [], beforeLogs = await prisma.contentUpdateRun.count({ where: { kind: "SCRIPTURE_RELEASE" } });
const sizes = [320, 375, 390, 430];
try {
  for (const [index, lang] of ["nl", "en", "de", "fr", "es"].entries()) {
    const messages = (await import(`../src/lib/i18n/messages/${lang}.ts`))[lang].scripturePublication;
    await prisma.user.update({ where: { id: flow.adminId }, data: { uiLanguage: lang } });
    for (const [scheme, scale] of [["light", 100], ["dark", 200]]) {
      const width = sizes[index % sizes.length], context = await browser.newContext({ viewport: { width, height: 852 }, colorScheme: scheme, hasTouch: true });
      await context.addCookies([{ name: SESSION_COOKIE, value: flow.adminToken, url: base }]);
      const page = await context.newPage();
      await page.goto(base + "/adminbackend/content");
      const section = page.locator("[data-scripture-publication]");
      await page.locator("details").filter({ has: section }).locator("summary").first().click();
      const draft = section.locator(`[data-scripture-edition="${flow.draftId}"]`);
      await draft.getByRole("button", { name: messages.publish, exact: true }).waitFor();
      if (scale === 200) await page.addStyleTag({ content: "html{font-size:200% !important}" });
      assert.equal(await section.locator("[data-scripture-edition]").count(), 10);
      await draft.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${lang}/${width}/${scheme}/${scale}`);
      await draft.getByRole("checkbox").focus(); await page.keyboard.press("Space");
      assert.equal(await draft.getByRole("checkbox").isChecked(), true);
      await page.keyboard.press("Space"); assert.equal(await draft.getByRole("checkbox").isChecked(), false);
      await section.getByRole("button", { name: messages.selectGroup, exact: true }).first().click();
      assert.equal(await section.getByRole("checkbox", { checked: true }).count(), 5);
      const bulk = section.getByRole("button", { name: messages.publishSelected.replace("{count}", "5"), exact: true });
      await bulk.click();
      const dialog = page.getByRole("dialog"); await dialog.waitFor();
      assert.equal(await dialog.locator("button").count(), 2);
      assert.equal(await dialog.evaluate(node => node.contains(document.activeElement)), true);
      await page.screenshot({ path: `${output}/confirm-${lang}-${width}-${scheme}-${scale}.png` });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.keyboard.press("Escape"); await dialog.waitFor({ state: "detached" });
      assert.equal(await prisma.contentUpdateRun.count({ where: { kind: "SCRIPTURE_RELEASE" } }), beforeLogs, "Annuleren publiceert niets");
      await draft.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/admin-${lang}-${width}-${scheme}-${scale}.png`, fullPage: true });
      results.push({ lang, width, scheme, textPercent: scale, noOverflow: true, keyboardSelection: true, focusInDialog: true, cancelWithoutMutation: true });
      await context.close();
    }
  }
  // Eén echte bevestiging via de browser, na alle annuleringen. De actuele servercontrole blijft verplicht.
  await prisma.user.update({ where: { id: flow.adminId }, data: { uiLanguage: "nl" } });
  const context = await browser.newContext({ viewport: { width: 390, height: 852 } });
  await context.addCookies([{ name: SESSION_COOKIE, value: flow.adminToken, url: base }]);
  const page = await context.newPage(); await page.goto(base + "/adminbackend/content");
  const section = page.locator("[data-scripture-publication]"); await page.locator("details").filter({ has: section }).locator("summary").first().click();
  const draft = section.locator(`[data-scripture-edition="${flow.draftId}"]`);
  await draft.getByRole("button", { name: "Publiceren", exact: true }).click();
  const saved = page.waitForResponse(r => r.url().endsWith("/api/admin/content-switcher/publication") && r.request().method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "Publiceren", exact: true }).click();
  const response = await saved; assert.equal(response.status(), 200, await response.text());
  await draft.getByText("Gepubliceerd", { exact: true }).waitFor();
  assert.equal(await draft.getByRole("button", { name: "Publiceren", exact: true }).count(), 0);
  assert.equal(await prisma.contentUpdateRun.count({ where: { kind: "SCRIPTURE_RELEASE" } }), beforeLogs + 1);
  await page.reload(); await page.locator("details").filter({ has: section }).locator("summary").first().click();
  await draft.getByText("Gepubliceerd", { exact: true }).waitFor();
  await context.close();
  console.log(JSON.stringify({ scripturePublicationBrowser: "passed", results, realPublishAndReload: true }));
} finally { await fs.writeFile(output + "/browser-results.json", JSON.stringify(results, null, 2)); await browser.close(); await prisma.$disconnect(); }
