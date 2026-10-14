// Echte productiebuild; uitsluitend eigen synthetische PostgreSQL/mediavolume.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { createStudyImport, executeStudyImport } from "../src/lib/studyContent/imports.ts";
import { publishStudyRevision } from "../src/lib/studyContent/publication.ts";
import { studyLessonContentKey } from "../src/lib/studyContent/readStatus.ts";
import { getT } from "../src/lib/i18n/index.ts";

const db = new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL ?? "http://invalid");
const base = process.env.CONTENT_ACCESS_TEST_BASE_URL;
if (db.hostname !== "127.0.0.1" || db.pathname !== "/versado_content_access_test" || new URL(base).hostname !== "127.0.0.1" || process.env.DATABASE_URL !== db.href)
  throw Error("Eigen runner vereist");
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const output = "/tmp/versado-study-read-browser";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const results = [], errors = [];

async function fixture(language = "nl") {
  const user = await prisma.user.create({
    data: { email: `${randomUUID()}@study-read-browser.invalid`, passwordHash: "test-only", handle: `B${randomUUID().slice(0, 8)}`, discriminator: "00", uiLanguage: language, hintBalance: 8, xpTotal: 42, timeZone: "UTC" },
  });
  const key = `synthetic-study-${randomUUID()}`;
  await prisma.contentWork.create({ data: { key, kind: "STUDY_PROGRAM" } });
  await prisma.contentCollection.create({ data: { id: key, slug: key, name: "Synthetische leesles", work: key, editionKey: "fixture-v1", language: "nl", icon: "", publicationState: "PUBLISHED", visibleToUsers: true } });
  const admin = await prisma.user.create({ data: { email: `${randomUUID()}@study-read-admin.invalid`, passwordHash: "test-only", handle: `A${randomUUID().slice(0, 8)}`, discriminator: "00", isAdmin: true } });
  const actor = { id: admin.id, isAdmin: true };
  const run = await createStudyImport(actor, key, "sample");
  await executeStudyImport(actor, run.id);
  const item = await prisma.contentImportItem.findFirstOrThrow({ where: { runId: run.id }, include: { edition: true } });
  await publishStudyRevision(actor, { editionId: item.lessonEditionId, revisionId: item.revisionId, importRunId: run.id, expectedVersion: item.edition.publicationVersion, actionId: randomUUID(), kind: "PUBLISH" });
  return {
    user, key, editionId: item.lessonEditionId, lessonId: item.edition.lessonId,
    revisionId: item.revisionId, token: await createSessionToken(user.id), t: getT(language),
    href: `/study-lesson/${item.edition.lessonId}/${key}`,
  };
}
async function context(f, width, height, scheme) {
  const value = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, timezoneId: "UTC", isMobile: width < 500, hasTouch: width < 500 || width === 844, serviceWorkers: "block" });
  await value.addCookies([{ name: SESSION_COOKIE, value: f.token, url: base }]);
  return value;
}
async function open(page, f) {
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}${f.href}`);
  await page.locator("[data-study-reader-body]").waitFor();
  await page.getByRole("button", { name: f.t("studyReader.markRead"), exact: true }).waitFor();
}
async function checkCase(width, height, scheme, text = 100) {
  const f = await fixture();
  const c = await context(f, width, height, scheme);
  const page = await c.newPage();
  await open(page, f);
  if (text === 200) {
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1, top: document.querySelector("[data-study-reader]").getBoundingClientRect().top, header: document.querySelector("[data-sticky-header]").getBoundingClientRect().bottom }));
  assert.equal(geometry.overflow, false);
  assert.ok(geometry.top >= geometry.header - 1);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(await prisma.contentProgress.count({ where: { userId: f.user.id } }), 0, "openen maakt geen READ");
  await page.getByRole("button", { name: f.t("studyReader.markRead"), exact: true }).click();
  await page.locator('[data-study-read-status="read"]').waitFor();
  const edition = await prisma.studyLessonEdition.findUniqueOrThrow({ where: { id: f.editionId }, include: { lesson: { include: { period: true } } } });
  const key = studyLessonContentKey({ workKey: edition.workKey, periodId: edition.lesson.periodId, sourceKey: edition.lesson.sourceKey });
  const row = await prisma.contentProgress.findUnique({ where: { userId_contentKey: { userId: f.user.id, contentKey: key } } });
  assert.equal(row?.readStatus, "READ");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: f.user.id } });
  assert.equal(user.xpTotal, 42);
  await page.reload();
  await page.locator('[data-study-read-status="read"]').waitFor();
  await page.screenshot({ path: `${output}/study-read-${width}-${scheme}-${text}.png`, fullPage: true });
  results.push({ viewport: { width, height }, scheme, text, readPersisted: true, noOverflow: true });
  await c.close();
}

try {
  for (const [width, height] of [[320, 844], [390, 844], [1280, 900], [844, 390]])
    for (const scheme of ["light", "dark"])
      for (const text of [100, 200]) await checkCase(width, height, scheme, text);
  for (const language of ["nl", "en", "de", "fr", "es"]) {
    const f = await fixture(language), c = await context(f, 320, 844, "light"), page = await c.newPage();
    await open(page, f);
    const button = page.getByRole("button", { name: f.t("studyReader.markRead"), exact: true });
    for (let attempt = 0; attempt < 40 && !(await button.isEnabled()); attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(await button.isEnabled(), true, "markeeractie is via toetsenbord beschikbaar");
    await button.focus();
    await page.keyboard.press("Enter");
    await page.locator('[data-study-read-status="read"]').waitFor();
    results.push({ language, keyboard: true, readPersisted: true });
    await c.close();
  }
  const f = await fixture(), c = await context(f, 390, 844, "light"), page = await c.newPage();
  await open(page, f);
  let calls = 0;
  await page.route("**/api/study-read", async (route) => {
    calls += 1;
    if (calls === 1) return route.abort("failed");
    return route.continue();
  });
  await page.getByRole("button", { name: f.t("studyReader.markRead"), exact: true }).click();
  await page.getByRole("status").filter({ hasText: f.t("studyReader.readFailed") }).waitFor();
  assert.equal(await prisma.contentProgress.count({ where: { userId: f.user.id } }), 0);
  await page.getByRole("button", { name: f.t("studyReader.markRead"), exact: true }).click();
  await page.locator('[data-study-read-status="read"]').waitFor();
  results.push({ networkRetry: true, noFalseSavedState: true });
  await c.close();
  assert.deepEqual(errors, []);
  writeFileSync(`${output}/results.json`, JSON.stringify({ cases: results.length, results, pageErrors: errors, realDevicesTested: false }, null, 2));
  console.log(JSON.stringify({ cases: results.length, results, pageErrors: errors, realDevicesTested: false }));
} finally {
  await browser.close();
  await prisma.$disconnect();
}
