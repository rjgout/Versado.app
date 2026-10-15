import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../src/lib/db.ts";
import sharp from "sharp";
import { SESSION_COOKIE } from "../src/lib/auth.ts";
import { assertReferenceTestEnvironment } from "./fixtures/reference-content.mjs";
const base = assertReferenceTestEnvironment();
const flow = JSON.parse(
  await fs.readFile(
    path.join(
      path.dirname(process.env.CONTENT_MIGRATION_TEST_STATE),
      "cfm-flow.json",
    ),
    "utf8",
  ),
);
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.CHROMIUM_PATH,
});
const output = "/tmp/versado-cfm-import-browser";
await fs.mkdir(output, { recursive: true });
const before = await prisma.user.findUniqueOrThrow({
  where: { id: flow.userId },
});
const rewardCounts = () =>
  Promise.all([
    prisma.readingSession.count({ where: { userId: flow.userId } }),
    prisma.contentProgress.count({ where: { userId: flow.userId } }),
    prisma.activityFeedItem.count({ where: { userId: flow.userId } }),
  ]);
const counts = await rewardCounts(),
  results = [];
try {
  for (const [width, height, scheme, text] of [
    [320, 844, "light", 200],
    [390, 844, "dark", 100],
    [1280, 900, "light", 100],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: scheme,
      hasTouch: width < 500,
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: flow.token, url: base },
    ]);
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + flow.href);
    await page.locator("[data-study-reader]").waitFor();
    if (text === 200)
      await page.addStyleTag({ content: "html{font-size:200% !important}" });
    const button = page.locator('[data-reference-key="ref-b-p1-1"]');
    await button.scrollIntoViewIfNeeded();
    await delay(1200);
    await button.evaluate((el) =>
      el.addEventListener(
        "click",
        () => {
          window.__cfmPreviewY = scrollY;
        },
        { once: true, capture: true },
      ),
    );
    await button.click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByText(/De aarde nu was woest/).waitFor();
    assert.ok(await dialog.evaluate((d) => d.contains(document.activeElement)));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    await page.screenshot({
      path: `${output}/cfm-preview-${width}-${scheme}.png`,
    });
    const y = await page.evaluate(() => window.__cfmPreviewY);
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    assert.ok(Math.abs((await page.evaluate(() => scrollY)) - y) <= 2);
    await button.click();
    await dialog.getByText(/De aarde nu was woest/).waitFor();
    await dialog
      .getByRole("button", { name: "Meer lezen", exact: true })
      .click();
    await page.locator("[data-scripture-readonly]").waitFor();
    assert.match(page.url(), /\/scripture\/.*returnKey=/);
    await page
      .getByRole("button", { name: "Terug naar les", exact: true })
      .click();
    await page.locator("[data-study-reader]").waitFor();
    assert.ok(page.url().includes(flow.href));
    await page.screenshot({
      path: `${output}/cfm-return-${width}-${scheme}.png`,
    });
    assert.deepEqual(errors, []);
    results.push({
      width,
      scheme,
      text,
      realImportedLesson: true,
      internalOtbPreview: true,
      moreAndReturn: true,
      noOverflow: true,
    });
    await context.close();
  }
  {
    const context = await browser.newContext({
      viewport: { width: 320, height: 844 },
      hasTouch: true,
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: flow.token, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(base + flow.tableHref);
    await page.locator("[data-study-reader]").waitFor();
    await page.addStyleTag({ content: "html{font-size:200% !important}" });
    const table = page.locator("table").first();
    await table.scrollIntoViewIfNeeded();
    // Wacht op de daadwerkelijke compositie na tekstvergroting en de lange
    // scrollsprong; DOM-aanwezigheid alleen bewijst geen zichtbare tabel.
    await page.evaluate(() => new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    ));
    assert.ok(await table.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(innerWidth - 1, Math.max(1, r.left + 20));
      const y = Math.min(innerHeight - 1, Math.max(1, r.top + 20));
      return r.bottom > 0 && r.top < innerHeight && el.contains(document.elementFromPoint(x, y));
    }));
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.ok((await page.locator("table td").count()) > 0);
    const screenshot = await page.screenshot({ path: `${output}/cfm-table-320-large.png` });
    const pixels = await sharp(screenshot).stats();
    assert.ok(pixels.channels.some((c) => c.stdev > 5), "De tabelopname mag geen leeg achtergrondvlak zijn");
    results.push({
      width: 320,
      text: 200,
      realSourceTable: true,
      noOverflow: true,
    });
    await context.close();
  }
  for (const lesson of flow.longLessons) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: flow.token, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(base + lesson.href);
    await page.locator("[data-study-reader]").waitFor();
    await delay(1200);
    await page.locator(`[data-reference-key="${lesson.reference}"]`).click();
    const dialog = page.locator("dialog[open]");
    await dialog.locator("[data-reference-preview-truncated]").waitFor();
    assert.equal(
      await dialog.locator("[data-reference-preview] sup").count(),
      40,
    );
    await page.screenshot({ path: `${output}/cfm-long-${lesson.verses}.png` });
    await dialog
      .getByRole("button", { name: "Meer lezen", exact: true })
      .click();
    await page.locator("[data-scripture-readonly]").waitFor();
    await page.locator(`#vers-${lesson.verses}`).waitFor({ state: "attached" });
    await page
      .getByRole("button", { name: "Terug naar les", exact: true })
      .click();
    await page.locator("[data-study-reader]").waitFor();
    assert.ok(page.url().includes(lesson.href));
    results.push({
      width: 390,
      longChapter: lesson.verses,
      previewVerses: 40,
      fullChapterAndReturn: true,
    });
    await context.close();
  }
  const after = await prisma.user.findUniqueOrThrow({
    where: { id: flow.userId },
  });
  for (const key of ["xpTotal", "hintBalance", "activeCourseId"])
    assert.equal(after[key], before[key]);
  assert.equal(after.activeContentCollectionId, flow.collectionId);
  assert.deepEqual(await rewardCounts(), counts);
  console.log(
    JSON.stringify({
      cases: results.length,
      results,
      noRewards: true,
      realDevicesTested: false,
    }),
  );
} finally {
  await fs.writeFile(
    output + "/browser-results.json",
    JSON.stringify(results, null, 2),
  );
  await browser.close();
  await prisma.$disconnect();
}
