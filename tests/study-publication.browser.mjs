// Gerenderde Next.js-productiebuild, uitsluitend de eigen wegwerpdatabase.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { getT } from "../src/lib/i18n/index.ts";
const database = new URL(
    process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid",
  ),
  base = process.env.CONTENT_ACCESS_TEST_BASE_URL;
if (
  database.hostname !== "127.0.0.1" ||
  database.pathname !== "/versado_content_access_test" ||
  new URL(base).hostname !== "127.0.0.1"
)
  throw new Error("Eigen runner vereist");
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright"),
  output = "/tmp/versado-study-publication-browser";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  args: ["--no-sandbox"],
  executablePath: process.env.CHROMIUM_PATH,
});
const results = [],
  errors = [];
async function fixtures(language = "nl") {
  const user = await prisma.user.create({
    data: {
      email: `${randomUUID()}@study-browser.invalid`,
      passwordHash: "test-only",
      handle: `B${randomUUID().slice(0, 8)}`,
      discriminator: "00",
      isAdmin: true,
      uiLanguage: language,
      timeZone: "UTC",
      hintBalance: 8,
      xpTotal: 42,
    },
  });
  const key = `synthetic-study-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  const collection = await prisma.contentCollection.create({
    data: {
      id: key,
      slug: key,
      name: "Synthetische lange gecontroleerde studiebron voor beheer en publicatie",
      work: key,
      editionKey: "fixture-v1",
      language: "nl",
      icon: "",
      visibleToUsers: true,
      publicationState: "PUBLISHED",
    },
  });
  return { user, collection, token: await createSessionToken(user.id) };
}
async function contextFor(f, width, scheme = "light", height = 844) {
  const c = await browser.newContext({
    viewport: { width, height },
    colorScheme: scheme,
    hasTouch: width < 500 || width === 844,
    isMobile: width < 500,
    serviceWorkers: "block",
  });
  await c.addCookies([{ name: SESSION_COOKIE, value: f.token, url: base }]);
  return c;
}
async function eventually(fn, label) {
  for (let i = 0; i < 100; i++) {
    const value = await fn();
    if (value) return value;
    await delay(200);
  }
  throw new Error(`Niet bereikt: ${label}`);
}
// De testimport staat bewust onder de ingeklapte "Technische details".
async function openTech(page, t) {
  const control = page.getByLabel(t("studyPublishing.collection"), { exact: true });
  if (await control.isVisible()) return;
  await page.locator("summary", { hasText: t("studyPublishing.program.techTitle") }).click();
  await control.waitFor();
}
async function importUi(page, f, key = "sample") {
  const t = getT(f.user.uiLanguage);
  await openTech(page, t);
  await page
    .getByLabel(t("studyPublishing.collection"), { exact: true })
    .selectOption(f.collection.id);
  await page
    .getByLabel(t("studyPublishing.fixture"), { exact: true })
    .selectOption(key);
  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/admin/study-publications") &&
      r.request().method() === "POST",
  );
  await page
    .getByRole("button", {
      name: t("studyPublishing.importAction"),
      exact: true,
    })
    .click();
  const response = await responsePromise;
  assert.equal(response.request().postDataJSON().collectionId, f.collection.id);
  assert.equal(response.status(), 202);
  const accepted = await response.json();
  const run = await eventually(
    async () =>
      prisma.contentImportRun.findFirst({
        where: {
          id: accepted.runId,
          collectionId: f.collection.id,
          sourceVersion: `synthetic-${key}-v1`,
          status: "DRAFT_READY",
        },
      }),
    "import klaar",
  );
  const item = await prisma.contentImportItem.findFirstOrThrow({
    where: { runId: run.id },
  });
  await page
    .locator(`[data-study-edition="${item.lessonEditionId}"]`)
    .waitFor();
  return { run, item };
}
async function preview(page, item, t) {
  const section = page.locator(
    `[data-study-edition="${item.lessonEditionId}"]`,
  );
  await section
    .getByRole("button", { name: t("studyPublishing.preview"), exact: true })
    .click();
  await page.locator("[data-study-revision-content]").waitFor();
  await eventually(
    async () =>
      page
        .locator("#study-revision-preview")
        .getByRole("button", {
          name: t("studyPublishing.publish"),
          exact: true,
        })
        .count(),
    "publicatieknop",
  );
}
async function confirm(page, label) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.waitFor();
  assert.equal(await modal.evaluate((d) => d.matches(":modal")), true);
  await modal.getByRole("button", { name: label, exact: true }).click();
  await modal.waitFor({ state: "hidden" });
}
try {
  for (const width of [320, 390, 1280, 844])
    for (const scheme of ["light", "dark"]) {
      const f = await fixtures(),
        t = getT("nl"),
        context = await contextFor(
          f,
          width,
          scheme,
          width === 1280 ? 900 : width === 844 ? 390 : 844,
        ),
        page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      const before = await prisma.user.findUniqueOrThrow({
        where: { id: f.user.id },
      });
      await page.goto(`${base}/adminbackend/content/study-publications`);
      await page.locator("[data-study-publications]").waitFor();
      const bounds = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        top: document
          .querySelector("[data-study-publications]")
          .getBoundingClientRect().top,
        header: document
          .querySelector("[data-sticky-header]")
          .getBoundingClientRect().bottom,
      }));
      assert.equal(bounds.overflow, false);
      assert.ok(bounds.top >= bounds.header - 1, JSON.stringify(bounds));
      await page.screenshot({
        path: `${output}/${width}-${scheme}-overview.png`,
      });
      const first = await importUi(page, f);
      await preview(page, first.item, t);
      assert.equal(await page.locator("[data-study-block]").count(), 9);
      assert.equal(
        await page.locator("[data-study-revision-content] blockquote").count(),
        1,
      );
      assert.equal(
        await page.locator("[data-study-revision-content] figure").count(),
        1,
      );
      await page
        .locator("[data-study-revision-content] figure img")
        .scrollIntoViewIfNeeded();
      await page.waitForFunction(() => {
        const image = document.querySelector(
          "[data-study-revision-content] figure img",
        );
        return image?.complete && image.naturalWidth === 8;
      });
      assert.ok(
        await page
          .locator("[data-study-revision-content] figure img")
          .evaluate((img) => img.complete && img.naturalWidth === 8),
      );
      const publish = page.getByRole("button", {
        name: t("studyPublishing.publish"),
        exact: true,
      });
      await publish.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press("Tab");
        assert.equal(
          await dialog.evaluate((d) => d.contains(document.activeElement)),
          true,
        );
      }
      await page.screenshot({
        path: `${output}/${width}-${scheme}-confirmation.png`,
      });
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden" });
      assert.equal(
        (
          await prisma.studyLessonEdition.findUniqueOrThrow({
            where: { id: first.item.lessonEditionId },
          })
        ).publicationVersion,
        0,
      );
      assert.equal(
        await publish.evaluate((b) => document.activeElement === b),
        true,
      );
      await confirm(page, t("studyPublishing.publish"));
      await eventually(
        async () =>
          (
            await prisma.studyLessonEdition.findUniqueOrThrow({
              where: { id: first.item.lessonEditionId },
            })
          ).publicationVersion === 1,
        "eerste publicatie",
      );
      const updated = await importUi(page, f, "updated");
      await eventually(
        async () =>
          page
            .locator(`[data-study-edition="${first.item.lessonEditionId}"]`)
            .getByRole("heading")
            .innerText()
            .then((x) => x.includes("versie twee")),
        "nieuw concept in UI",
      );
      await preview(page, updated.item, t);
      await page.locator("#study-revision-preview").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${width}-${scheme}-diff.png` });
      assert.ok(
        (await page.locator("#study-revision-preview").innerText()).includes(
          "Gewijzigd",
        ),
      );
      await confirm(page, t("studyPublishing.publish"));
      await eventually(
        async () =>
          (
            await prisma.studyLessonEdition.findUniqueOrThrow({
              where: { id: first.item.lessonEditionId },
            })
          ).publicationVersion === 2,
        "tweede publicatie",
      );
      const section = page.locator(
        `[data-study-edition="${first.item.lessonEditionId}"]`,
      );
      await section.locator("summary").click();
      await section.getByRole("button", { name: /^#1 ·/ }).click();
      await page
        .getByRole("button", {
          name: t("studyPublishing.rollback"),
          exact: true,
        })
        .waitFor();
      await confirm(page, t("studyPublishing.rollback"));
      const rollback = await eventually(async () => {
        const e = await prisma.studyLessonEdition.findUniqueOrThrow({
          where: { id: first.item.lessonEditionId },
        });
        return e.publicationVersion === 3 ? e : null;
      }, "rollback");
      assert.equal(rollback.publishedRevisionId, first.item.revisionId);
      await page.reload();
      await page.locator("[data-study-publications]").waitFor();
      assert.deepEqual(
        await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } }),
        before,
      );
      assert.equal(
        await prisma.studyPublicationAction.count({
          where: { lessonEditionId: first.item.lessonEditionId },
        }),
        3,
      );
      results.push({
        width,
        scheme,
        fullSyntheticFlow: true,
        modalFocusTrap: true,
        escapeNoMutation: true,
        refresh: true,
        geometry: bounds,
      });
      await context.close();
    }
  // Tekstvergroting en lange vertalingen: geen overflow, native dialog boven shell.
  for (const language of ["nl", "en", "de", "fr", "es"])
    for (const scheme of ["light", "dark"]) {
      const f = await fixtures(language),
        context = await contextFor(f, 320, scheme),
        page = await context.newPage();
      await page.goto(`${base}/adminbackend/content/study-publications`);
      await page.locator("[data-study-publications]").waitFor();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "32px";
        document.documentElement.style.setProperty(
          "--vs-safe-area-top",
          "20px",
        );
        document.documentElement.style.setProperty(
          "--vs-safe-area-bottom",
          "34px",
        );
      });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        language,
      );
      const t = getT(language),
        first = await importUi(page, f);
      await preview(page, first.item, t);
      // Ook met lessenlijst en preview open blijft het document binnen het scherm (anders zoomt een mobiele browser uit).
      const wide = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > 321 && !el.closest("[data-main-nav],[data-sticky-header]") && getComputedStyle(el).position !== "fixed"; }).slice(0, 14).map((el) => `${el.tagName}.${String(el.className).slice(0, 50)}:${Math.round(el.getBoundingClientRect().left)}-${Math.round(el.getBoundingClientRect().right)}:${(el.textContent || "").slice(0, 30)}`));
      assert.deepEqual(wide, [], `horizontale overflow ${language}`);
      await page
        .getByRole("button", {
          name: t("studyPublishing.publish"),
          exact: true,
        })
        .click();
      const modal = page.getByRole("dialog");
      await modal.waitFor();
      const box = await modal.boundingBox();
      assert.ok(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= 320 &&
          box.y + box.height <= 844,
        `${language} ${scheme} ${JSON.stringify(box)} ${await page.evaluate(() => JSON.stringify({ iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, vv: window.visualViewport && [visualViewport.width, visualViewport.height, visualViewport.scale] }))}`,
      );
      await page.screenshot({
        path: `${output}/320-${scheme}-${language}-200-text.png`,
      });
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "hidden" });
      results.push({
        width: 320,
        scheme,
        language,
        textScale: 200,
        overflow: false,
        dialogBounds: box,
      });
      await context.close();
    }
  const f = await fixtures(),
    context = await contextFor(f, 390),
    page = await context.newPage(),
    t = getT("nl");
  await page.goto(`${base}/adminbackend/content/study-publications`);
  await page.locator("[data-study-publications]").waitFor();
  await page.route("**/api/admin/study-publications", (route) =>
    route.request().method() === "POST" ? route.abort() : route.continue(),
  );
  await openTech(page, t);
  await page
    .getByLabel(t("studyPublishing.collection"), { exact: true })
    .selectOption(f.collection.id);
  await page
    .getByRole("button", {
      name: t("studyPublishing.importAction"),
      exact: true,
    })
    .click();
  await page.locator("[data-study-publications]").getByRole("alert").waitFor();
  assert.equal(
    await prisma.contentImportRun.count({
      where: { collectionId: f.collection.id },
    }),
    0,
  );
  await page.screenshot({ path: `${output}/390-failed-request.png` });
  await page.unroute("**/api/admin/study-publications");
  const failed = await importUi(page, f, "unresolved");
  await preview(page, failed.item, t);
  assert.equal(
    await page
      .getByRole("button", { name: t("studyPublishing.publish"), exact: true })
      .isDisabled(),
    true,
  );
  assert.ok(
    (await page.locator("#study-revision-preview").innerText()).includes(
      t("studyPublishing.unresolved"),
    ),
  );
  await page.screenshot({ path: `${output}/390-unresolved.png` });
  await context.close();
  results.push({
    failedRequestNoWrite: true,
    retryRecoverable: true,
    unresolvedReferenceBlocksPublication: true,
  });
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify({
      studyPublicationBrowserFlows: results.length,
      physicalIosAndroid: false,
      screenshots: output,
      errors,
    }),
  );
} catch (error) {
  let n = 0;
  for (const c of browser.contexts())
    for (const p of c.pages())
      if (!p.isClosed())
        await p
          .screenshot({ path: `${output}/failure-${n++}.png`, fullPage: false })
          .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await prisma.$disconnect();
}
