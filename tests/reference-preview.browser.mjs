import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../src/lib/db.ts";
import { getT } from "../src/lib/i18n/index.ts";
import { SESSION_COOKIE } from "../src/lib/auth.ts";
import {
  referenceFixture,
  assertReferenceTestEnvironment,
} from "./fixtures/reference-content.mjs";
const base = assertReferenceTestEnvironment(),
  require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const output = "/tmp/versado-reference-preview-browser";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.CHROMIUM_PATH,
});
const results = [],
  errors = [];
async function context(f, size, scheme = "light") {
  const c = await browser.newContext({
    viewport: size,
    colorScheme: scheme,
    hasTouch: size.width < 500 || size.height < 500,
  });
  await c.addCookies([
    { name: SESSION_COOKIE, value: f.owner.token, url: base },
  ]);
  const page = await c.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return { c, page };
}
async function open(page) {
  const button = page.getByRole("button", {
    name: "1 Nephi 1:1–3",
    exact: true,
  });
  await delay(1200);
  await button.scrollIntoViewIfNeeded();
  await button.evaluate((element) =>
    element.addEventListener(
      "click",
      () => {
        window.__referenceOpenY = scrollY;
      },
      { capture: true, once: true },
    ),
  );
  if (page.viewportSize().width < 500 || page.viewportSize().height < 500)
    await button.tap();
  else await button.click();
  await page
    .locator("dialog[open] [data-reference-preview]")
    .getByText(/Ik, Nephi/)
    .waitFor();
  const y = await page.evaluate(() => window.__referenceOpenY);
  return { button, y };
}
try {
  for (const size of [
    { width: 320, height: 844 },
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
    { width: 844, height: 390 },
  ]) {
    for (const scheme of ["light", "dark"])
      for (const scale of [100, 200]) {
        const f = await referenceFixture(),
          t = getT("nl"),
          { c, page } = await context(f, size, scheme);
        await page.goto(base + f.href);
        await page.locator("[data-study-reader]").waitFor();
        if (scale === 200)
          await page.addStyleTag({
            content: "html {font-size:200% !important}",
          });
        if (size.width === 320 && scale === 200)
          await page.evaluate(() => {
            for (const [key, value] of Object.entries({
              top: 20,
              bottom: 16,
              left: 8,
              right: 8,
            }))
              document.documentElement.style.setProperty(
                `--vs-safe-area-${key}`,
                `${value}px`,
              );
          });
        const { button, y } = await open(page);
        assert.ok(
          await page.evaluate(() =>
            document
              .querySelector("dialog[open]")
              .contains(document.activeElement),
          ),
        );
        assert.ok(
          await page
            .locator("dialog[open] h2")
            .evaluate((e) => e.scrollHeight <= e.clientHeight + 1),
          "korte passagekop blijft volledig zichtbaar bij grote tekst",
        );
        const box = await page.locator("dialog[open]").boundingBox();
        assert.ok(
          box.x >= 0 &&
            box.y >= 0 &&
            box.x + box.width <= size.width + 1 &&
            box.y + box.height <= size.height + 1,
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        );
        await page
          .getByRole("button", {
            name: t("referencePreview.more"),
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${output}/${size.width}-${scheme}-${scale}.png`,
        });
        const modalY = await page.evaluate(() => scrollY);
        await page.keyboard.press("Escape");
        await page.locator("dialog[open]").waitFor({ state: "detached" });
        const closedY = await page.evaluate(() => scrollY);
        if (Math.abs(closedY - y) > 1)
          console.log(
            JSON.stringify({
              scrollMismatch: {
                before: y,
                modal: modalY,
                after: closedY,
                viewport: size,
                scheme,
                scale,
                button: await button.boundingBox(),
              },
            }),
          );
        assert.ok(
          Math.abs((await page.evaluate(() => scrollY)) - y) <= 1,
          "close preserves document position",
        );
        assert.ok(await button.evaluate((e) => e === document.activeElement));
        results.push({
          viewport: size,
          scheme,
          text: scale,
          preview: true,
          focusRestore: true,
          noOverflow: true,
        });
        await c.close();
      }
  }
  for (const lang of ["nl", "en", "de", "fr", "es"]) {
    const f = await referenceFixture(lang),
      t = getT(lang),
      { c, page } = await context(f, { width: 320, height: 844 });
    await page.goto(base + f.href);
    await page.addStyleTag({ content: "html {font-size:200% !important}" });
    await open(page);
    assert.equal(
      await page
        .getByRole("button", { name: t("referencePreview.more"), exact: true })
        .count(),
      1,
    );
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(() =>
        document.querySelector("dialog[open]").contains(document.activeElement),
      ),
    );
    await page.keyboard.press("Escape");
    await c.close();
    results.push({ uiLanguage: lang, largeText: true, keyboard: true });
  }
  // Echte uitstap, herladen, tabgebonden terugkeer en een conflict vanaf een ander toestel.
  {
    const f = await referenceFixture(),
      t = getT("nl"),
      { c, page } = await context(f, { width: 390, height: 844 });
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: f.owner.user.id },
    });
    await page.goto(base + f.href);
    const { y } = await open(page);
    await page
      .getByRole("button", { name: t("referencePreview.more"), exact: true })
      .click();
    await page.locator("[data-scripture-readonly]").waitFor();
    assert.match(page.url(), /returnKey=/);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }))
        .activeContentCollectionId,
      "content_bom",
    );
    await page.goBack();
    await page.locator("[data-study-reader]").waitFor();
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }))
        .activeContentCollectionId,
      "content_bom",
    );
    await page.goForward();
    await page.locator("[data-scripture-readonly]").waitFor();
    await page.reload();
    await page
      .getByRole("button", {
        name: t("referencePreview.backToLesson"),
        exact: true,
      })
      .last()
      .click();
    await page.locator("[data-study-reader]").waitFor();
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }))
        .activeContentCollectionId,
      f.collection.id,
    );
    await delay(900);
    assert.ok(
      Math.abs((await page.evaluate(() => scrollY)) - y) < 150,
      "return restores saved position",
    );
    await open(page);
    await page
      .getByRole("button", { name: t("referencePreview.more"), exact: true })
      .click();
    await page.locator("[data-scripture-readonly]").waitFor();
    await prisma.user.update({
      where: { id: f.owner.user.id },
      data: { activeContentCollectionId: f.collection.id },
    });
    await prisma.user.update({
      where: { id: f.owner.user.id },
      data: { activeContentCollectionId: "content_bom" },
    });
    await page
      .getByRole("button", {
        name: t("referencePreview.backToLesson"),
        exact: true,
      })
      .last()
      .click();
    await page
      .getByRole("alert")
      .filter({ hasText: t("referencePreview.returnFailed") })
      .waitFor();
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: f.owner.user.id },
    });
    for (const k of ["xpTotal", "hintBalance", "activeCourseId"])
      assert.equal(after[k], before[k]);
    assert.equal(
      await prisma.readingSession.count({ where: { userId: f.owner.user.id } }),
      0,
    );
    assert.equal(
      await prisma.contentProgress.count({
        where: { userId: f.owner.user.id },
      }),
      0,
    );
    assert.equal(
      await page
        .getByRole("link", {
          name: t("contentSwitcher.picker.title"),
          exact: true,
        })
        .getAttribute("href"),
      "/content",
      "conflict houdt een veilige uitgang naar de huidige bronkeuze beschikbaar",
    );
    await page.screenshot({ path: output + "/return-conflict-mobile.png" });
    await c.close();
    results.push({
      moreAndReturn: true,
      refresh: true,
      abaConflict: true,
      noRewards: true,
    });
  }
  {
    const f = await referenceFixture(),
      t = getT("nl"),
      { c, page } = await context(f, { width: 390, height: 844 });
    await page.goto(base + f.href);
    await page.route("**/api/study-references", (route) => route.abort());
    await page
      .getByRole("button", { name: "1 Nephi 1:1–3", exact: true })
      .click();
    await page.locator("dialog[open]").getByRole("alert").waitFor();
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }))
        .activeContentCollectionId,
      f.collection.id,
    );
    await page.unroute("**/api/study-references");
    await page
      .getByRole("button", { name: t("studyReader.retry"), exact: true })
      .click();
    await page
      .locator("[data-reference-preview]")
      .getByText(/Ik, Nephi/)
      .waitFor();
    await page.keyboard.press("Escape");
    await c.close();
    results.push({ networkErrorAndRetry: true });
  }
  {
    const f = await referenceFixture(),
      t = getT("nl"),
      { c, page } = await context(f, { width: 390, height: 844 });
    await page.goto(base + f.href);
    await page.locator("[data-study-reader]").waitFor();
    let moreRequests = 0;
    page.on("request", (request) => {
      if (
        request.url().endsWith("/api/study-references") &&
        request.postDataJSON()?.action === "more"
      )
        moreRequests++;
    });
    await page.route("**/api/reading-position*", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: 503,
            json: { error: "synthetic storage failure" },
          })
        : route.continue(),
    );
    await open(page);
    await page
      .getByRole("button", { name: t("referencePreview.more"), exact: true })
      .click();
    await page
      .locator("dialog[open]")
      .getByRole("alert")
      .filter({ hasText: t("referencePreview.saveFailed") })
      .waitFor();
    assert.equal(moreRequests, 0);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }))
        .activeContentCollectionId,
      f.collection.id,
    );
    await page.screenshot({ path: output + "/save-failure-mobile.png" });
    await page.unroute("**/api/reading-position*");
    await page.keyboard.press("Escape");
    await c.close();
    results.push({ failedSaveBlocksMore: true });
  }
  {
    const f = await referenceFixture(),
      t = getT("nl"),
      { c, page } = await context(f, { width: 390, height: 844 });
    await page.goto(base + f.href);
    let lose = true;
    await page.route("**/api/study-references", async (route) => {
      const more = route.request().postDataJSON()?.action === "more",
        response = await route.fetch();
      if (more && lose) {
        lose = false;
        await route.abort();
      } else await route.fulfill({ response });
    });
    await open(page);
    await page
      .getByRole("button", { name: t("referencePreview.more"), exact: true })
      .click();
    await page
      .locator("dialog[open]")
      .getByRole("alert")
      .filter({ hasText: t("referencePreview.moreUnknown") })
      .waitFor();
    const changed = await prisma.user.findUniqueOrThrow({
      where: { id: f.owner.user.id },
    });
    assert.equal(changed.activeContentCollectionId, "content_bom");
    await page
      .getByRole("button", { name: t("referencePreview.more"), exact: true })
      .click();
    await page
      .locator("dialog[open]")
      .getByRole("alert")
      .filter({ hasText: t("referencePreview.selectionConflict") })
      .waitFor();
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }))
        .contentSelectionVersion,
      changed.contentSelectionVersion,
    );
    await page.screenshot({ path: output + "/lost-response-mobile.png" });
    await page.keyboard.press("Escape");
    await c.close();
    results.push({ lostMoreResponse: true, retryDoesNotOverwrite: true });
  }
  {
    const f = await referenceFixture(),
      t = getT("nl"),
      { c, page } = await context(f, { width: 390, height: 844 });
    await page.goto(base + f.href);
    await open(page);
    await page
      .getByRole("button", { name: t("referencePreview.more"), exact: true })
      .click();
    await page.locator("[data-scripture-readonly]").waitFor();
    const prior = page.url();
    await page
      .getByRole("button", {
        name: t("referencePreview.backToLesson"),
        exact: true,
      })
      .last()
      .click();
    await page.locator("[data-study-reader]").waitFor();
    let committed = false;
    await page.route("**/api/study-references", async (route) => {
      const response = await route.fetch();
      if (route.request().postDataJSON()?.action === "more") {
        committed = true;
        await delay(1500);
      }
      try {
        await route.fulfill({ response });
      } catch {
        /* Verwachte abort door de echte reader-unmount. */
      }
    });
    await open(page);
    await page
      .getByRole("button", { name: t("referencePreview.more"), exact: true })
      .click();
    for (let i = 0; i < 100 && !committed; i++) await delay(50);
    assert.equal(committed, true);
    await prisma.user.update({
      where: { id: f.owner.user.id },
      data: { activeContentCollectionId: "content_podcasts" },
    });
    await page.goBack();
    await page.locator("[data-scripture-readonly]").waitFor();
    await delay(2000);
    assert.equal(
      page.url(),
      prior,
      "laat Meer-lezen-antwoord mag een nieuwe geschiedeniskeuze niet terugdraaien",
    );
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }))
        .activeContentCollectionId,
      "content_podcasts",
    );
    await page.screenshot({ path: output + "/late-more-history-mobile.png" });
    await c.close();
    results.push({ lateMoreCannotNavigate: true, newerChoicePreserved: true });
  }
  {
    const f = await referenceFixture(),
      t = getT("nl"),
      { c, page } = await context(f, { width: 390, height: 844 });
    await page.goto(base + f.href);
    await open(page);
    await page
      .getByRole("button", { name: t("referencePreview.more"), exact: true })
      .click();
    await page.locator("[data-scripture-readonly]").waitFor();
    const prior = page.url();
    await page
      .getByRole("button", {
        name: t("referencePreview.backToLesson"),
        exact: true,
      })
      .last()
      .click();
    await page.locator("[data-study-reader]").waitFor();
    let pickerPending = false,
      moreRequests = 0;
    page.on("request", (r) => {
      if (
        r.url().endsWith("/api/study-references") &&
        r.postDataJSON()?.action === "more"
      )
        moreRequests++;
    });
    await page.route("**/api/content-context?view=picker", async (route) => {
      const response = await route.fetch();
      pickerPending = true;
      await delay(1500);
      try {
        await route.fulfill({ response });
      } catch {}
    });
    await open(page);
    await page
      .getByRole("button", { name: t("referencePreview.more"), exact: true })
      .click();
    for (let i = 0; i < 100 && !pickerPending; i++) await delay(50);
    assert.equal(pickerPending, true);
    await page.goBack();
    await page.locator("[data-scripture-readonly]").waitFor();
    await delay(2000);
    assert.equal(page.url(), prior);
    assert.equal(
      moreRequests,
      0,
      "na verlaten van de reader wordt geen uitgestelde bronmutatie meer verstuurd",
    );
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: f.owner.user.id } }))
        .activeContentCollectionId,
      f.collection.id,
    );
    await c.close();
    results.push({ latePickerDoesNotStartMore: true });
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      cases: results.length,
      results,
      pageErrors: errors,
      realDevicesTested: false,
    }),
  );
} finally {
  writeFileSync(
    output + "/results.json",
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
  await prisma.$disconnect();
}
