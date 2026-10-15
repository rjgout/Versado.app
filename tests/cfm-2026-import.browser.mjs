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
    // De echte hoofdtitel van les 03 verwijst naar beide hoofdstukken.
    await page.locator('[data-reference-key="ref-b-title1-0"]').click();
    await dialog.locator("[data-reference-passages] button").first().waitFor();
    assert.equal(
      await dialog.locator("[data-reference-passages] button").count(),
      2,
    );
    await dialog.locator("[data-reference-passages] button").nth(1).click();
    await dialog.getByText("Genesis 2 · nl · otb", { exact: true }).waitFor();
    assert.ok(
      await dialog.evaluate((d) => d.contains(document.activeElement)),
      "Passagekeuze behoudt focus in de modal",
    );
    await page.screenshot({
      path: `${output}/cfm-compound-${width}-${scheme}.png`,
    });
    await dialog
      .getByRole("button", { name: "Meer lezen", exact: true })
      .click();
    await page.locator("[data-scripture-readonly]").waitFor();
    assert.ok(page.url().includes(`/scripture/${flow.secondChapterId}`));
    await page.locator("#vers-25").waitFor({ state: "attached" });
    await page
      .getByRole("button", { name: "Terug naar les", exact: true })
      .click();
    await page.locator("[data-study-reader]").waitFor();
    assert.ok(page.url().includes(flow.href));

    assert.deepEqual(errors, []);
    results.push({
      width,
      scheme,
      text,
      realImportedLesson: true,
      internalOtbPreview: true,
      moreAndReturn: true,
      compoundSecondChapterAndReturn: true,
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
    // Een echte gebruikersscroll beëindigt het initiële leeshervatten.
    // Alleen scrollIntoView kan daarmee racen en vervolgens worden teruggezet.
    await page.keyboard.press("PageDown");
    const cell = table.locator("td").first();
    await cell.click({ trial: true });
    // Wacht op de daadwerkelijke compositie na tekstvergroting en de lange
    // scrollsprong; DOM-aanwezigheid alleen bewijst geen zichtbare tabel.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    assert.ok(
      await cell.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const x = (Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2;
        const header =
          parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(
              "--header-height",
            ),
          ) || 0;
        const y =
          (Math.max(header + 1, r.top) + Math.min(innerHeight, r.bottom)) / 2;
        return (
          r.bottom > 0 &&
          r.top < innerHeight &&
          el.contains(document.elementFromPoint(x, y))
        );
      }),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    assert.ok((await page.locator("table td").count()) > 0);
    const screenshot = await page.screenshot({
      path: `${output}/cfm-table-320-large.png`,
    });
    const pixels = await sharp(screenshot).stats();
    assert.ok(
      pixels.channels.some((c) => c.stdev > 5),
      "De tabelopname mag geen leeg achtergrondvlak zijn",
    );
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
  for (const selection of flow.selections) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: flow.token, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(base + selection.href);
    await page.locator("[data-study-reader]").waitFor();
    await page.locator(`[data-reference-key="${selection.reference}"]`).click();
    const dialog = page.locator("dialog[open]");
    await dialog.locator("[data-reference-passages] button").first().waitFor();
    assert.equal(
      await dialog.locator("[data-reference-passages] button").count(),
      selection.choices,
    );
    await dialog
      .locator("[data-reference-passages] button")
      .nth(selection.index)
      .click();
    await dialog
      .locator('[data-reference-passages] button[aria-pressed="true"]')
      .nth(0)
      .waitFor();
    await page.waitForFunction(
      ({ i }) =>
        document
          .querySelectorAll("[data-reference-passages] button")
          [i]?.getAttribute("aria-pressed") === "true",
      { i: selection.index },
    );
    await dialog.getByRole("button", {name:"Meer lezen",exact:true}).waitFor();
    if (selection.previewNumbers)
      assert.deepEqual(
        await dialog.locator("[data-reference-preview] sup").allTextContents(),
        selection.previewNumbers.map(String),
      );
    await page.screenshot({
      path: `${output}/cfm-selection-${selection.book}-${selection.chapter}.png`,
    });
    await dialog
      .getByRole("button", { name: "Meer lezen", exact: true })
      .click();
    await page.locator("[data-scripture-readonly]").waitFor();
    assert.ok(page.url().includes(`/scripture/${selection.chapterId}`));
    await page
      .locator(`#vers-${selection.verses}`)
      .waitFor({ state: "attached" });
    await page
      .getByRole("button", { name: "Terug naar les", exact: true })
      .click();
    await page.locator("[data-study-reader]").waitFor();
    assert.ok(page.url().includes(selection.href));
    results.push({
      width: 390,
      wholeBookOrLargeRange: true,
      choices: selection.choices,
      selected: selection.index,
      moreAndReturn: true,
    });
    await context.close();
  }
  for (const external of flow.externals) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: flow.token, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(base + external.href);
    await page.locator("[data-study-reader]").waitFor();
    await page.locator(`[data-reference-key="${external.anchor}"]`).click();
    const link = page.locator('dialog[open] a[target="_blank"]');
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), external.url);
    assert.match(await link.getAttribute("rel"), /noopener/);
    await page.screenshot({
      path: `${output}/cfm-external-${external.url.endsWith(".pdf") ? "pdf" : "video"}.png`,
    });
    await page.keyboard.press("Escape");
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    const banner = page.getByAltText(
      "Meer voor onderwijs aan kinderen — Nu bekijken.",
    );
    await banner.scrollIntoViewIfNeeded();
    await page.waitForFunction(() =>
      Array.from(document.images).some(
        (i) =>
          i.alt === "Meer voor onderwijs aan kinderen — Nu bekijken." &&
          i.complete &&
          i.naturalWidth > 0,
      ),
    );
    assert.equal(await banner.count(), 1);
    results.push({
      width: 390,
      externalOriginalUrl: true,
      kind: external.url.endsWith(".pdf") ? "PDF" : "VIDEO",
      accessibleBanner: true,
    });
    await context.close();
  }
  {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    await context.addCookies([
      { name: SESSION_COOKIE, value: flow.token, url: base },
    ]);
    const page = await context.newPage();
    await page.goto(base + flow.ntHref);
    await page.locator("[data-study-reader]").waitFor();
    await page.locator('[data-reference-key="ref-b-p2-1"]').click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("status").waitFor();
    await dialog
      .getByText("Deze verwijzing kan nog niet betrouwbaar worden geopend.", { exact: true })
      .waitFor();
    assert.equal(
      await dialog
        .getByRole("button", { name: "Meer lezen", exact: true })
        .count(),
      0,
    );
    results.push({ width: 390, newTestamentNoOtbFallback: true });
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
