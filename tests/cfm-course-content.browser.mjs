// Bronisolatie in de echte API en browser, inclusief verkeerd gekoppelde historische CFM-cursussen.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { dailyTextFixture, dailyTextTestEnvironment } from "./fixtures/daily-text.ts";
import { ensureCfmCourses } from "../src/lib/studyContent/cfmCourses.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { getSubscribedCourseSummaries } from "../src/lib/courseSummaries.ts";
import { getT } from "../src/lib/i18n/index.ts";

const base = dailyTextTestEnvironment(), f = await dailyTextFixture();
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.CHROMIUM_PATH });
const output = "/tmp/versado-cfm-content-browser"; mkdirSync(output, { recursive: true });
const user = await prisma.user.create({ data: { email: `${randomUUID()}@cfm-content.test.invalid`, handle: `Bron${randomUUID().slice(0,8)}`, discriminator: "00", passwordHash: "synthetic", activeContentCollectionId: f.cfm.id, contentLanguage: "nl", uiLanguage: "nl", timeZone: "UTC", avatarCharacterId: "nephi", emailVerifiedAt: new Date(), onboardingSeenAt: new Date(), onboardingProfilePrivacyAt: new Date(), kompasOffersEnabled: false } });
const bySource = new Map();
try {
  await ensureCfmCourses(prisma, f.cfm);
  const genuine = await prisma.course.findMany({ where: { contentCollectionId: f.cfm.id }, orderBy: { type: "asc" } });
  assert.equal(genuine.length, 2);
  await prisma.userCourseProgress.create({ data: { userId: user.id, courseId: genuine[0].id } });
  for (const source of [f.own, f.other, f.empty]) {
    const chapter = source.id === f.own.id ? f.ownChapter : source.id === f.other.id ? f.otherChapter : null;
    const chapters = chapter ? { create: { chapterId: chapter.id, order: 0 } } : undefined;
    const course = await prisma.course.create({ data: { slug: randomUUID(), name: `EIGEN CURSUS ${source.id}`, type: "FREE_CHOICE", contentCollectionId: source.id, chapters } });
    const offer = await prisma.course.create({ data: { slug: randomUUID(), name: `EIGEN AANBOD ${source.id}`, type: "FREE_CHOICE", contentCollectionId: source.id, chapters } });
    await prisma.userCourseProgress.create({ data: { userId: user.id, courseId: course.id } });
    const before = await prisma.course.count({ where: { contentCollectionId: source.id } });
    await ensureCfmCourses(prisma, source);
    assert.equal(await prisma.course.count({ where: { contentCollectionId: source.id } }), before, "geen nieuwe CFM-cursussen bij andere content");
    const bad = await prisma.course.create({ data: { slug: randomUUID(), name: "VERKEERDE CFM KAART", type: "STUDY_STEPS", contentCollectionId: source.id } });
    const badOffer = await prisma.course.create({ data: { slug: randomUUID(), name: "VERKEERD CFM AANBOD", type: "STUDY_FREE", contentCollectionId: source.id } });
    await prisma.userCourseProgress.create({ data: { userId: user.id, courseId: bad.id } });
    bySource.set(source.id, { course, offer, bad, badOffer });
  }
  const snapshot = await prisma.userCourseProgress.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "UTC", serviceWorkers: "block" });
  await context.addCookies([{ name: SESSION_COOKIE, value: await createSessionToken(user.id), url: base }]);
  const page = await context.newPage(), errors = []; page.on("pageerror", e => errors.push(e.message));
  for (const source of [f.own, f.other, f.empty]) {
    const items = bySource.get(source.id);
    await prisma.user.update({ where: { id: user.id }, data: { activeContentCollectionId: source.id, activeCourseId: items.bad.id } });
    for (const path of ["/api/courses", "/api/courses/catalog"]) {
      const response = await page.request.get(`${base}${path}`); assert.equal(response.status(), 200);
      const data = await response.json();
      assert.ok(data.courses.every(c => !["STUDY_STEPS", "STUDY_FREE"].includes(c.type)), `${path}: CFM niet bij ${source.id}`);
    }
    const summaries = await getSubscribedCourseSummaries({ ...user, activeCourseId: items.bad.id }, source.id, getT("nl"));
    assert.ok(!summaries.some(c => ["STUDY_STEPS", "STUDY_FREE"].includes(c.type)));
    const denied = await page.request.post(`${base}/api/courses/${items.badOffer.id}/subscribe`);
    assert.equal(denied.status(), 404, "een oude kaart kan CFM niet alsnog bij andere content toevoegen");
    await page.goto(`${base}/courses`); await page.getByText(items.course.name, { exact: true }).waitFor();
    assert.equal(await page.getByText("VERKEERDE CFM KAART", { exact: true }).count(), 0);
    await page.getByRole("button", { name: /Cursus toevoegen/ }).click();
    await page.getByText(items.offer.name, { exact: true }).waitFor();
    assert.equal(await page.getByText("VERKEERD CFM AANBOD", { exact: true }).count(), 0);
    assert.equal(await page.locator("[data-cfm-today-primary]").count(), 0);
    await page.screenshot({ path: `${output}/${source.id}.png` });
    for (const suffix of ["", "/pad", "/archief"]) {
      const response = await page.request.get(`${base}/courses/${items.bad.id}${suffix}`);
      assert.equal(new URL(response.url()).pathname, "/courses");
    }
  }
  // De echte kiezer: CFM wordt zichtbaar bij zijn eigen content en verdwijnt bij het terugwisselen.
  for (const source of [f.cfm, f.own, f.other, f.cfm]) {
    await page.locator('[data-kompas-target="content-switcher"] a').click();
    await page.locator(`[data-content-work="${source.work}"] button`).click();
    await page.waitForURL("**/courses");
    const response = await page.request.get(`${base}/api/courses`), data = await response.json();
    assert.equal(data.courses.some(c => ["STUDY_STEPS", "STUDY_FREE"].includes(c.type)), source.id === f.cfm.id);
    if (source.id !== f.cfm.id) await page.getByText(bySource.get(source.id).course.name, { exact: true }).waitFor();
  }
  await page.getByRole("button", { name: /Cursus toevoegen/ }).click();
  await page.getByText(genuine[1].name, { exact: true }).waitFor();
  await page.locator('[data-kompas-target="learn-add"]').evaluate(el => { el.dataset.testKept = "yes"; });
  // Een contentwissel van een ander tabblad, zonder remount: ook het al open aanbod moet omschakelen.
  const switched = await page.request.put(`${base}/api/content-context`, { headers: { Origin: base }, data: { contentCollectionId: f.own.id } });
  assert.equal(switched.status(), 200);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.getByText(bySource.get(f.own.id).offer.name, { exact: true }).waitFor();
  assert.equal(await page.getByText(genuine[1].name, { exact: true }).count(), 0, "geen bewaard CFM-aanbod na contentwissel");
  assert.equal(await page.locator('[data-kompas-target="learn-add"]').getAttribute("data-test-kept"), "yes", "test behoudt de bestaande cursuscomponent");
  assert.deepEqual(await prisma.userCourseProgress.findMany({ where: { userId: user.id }, orderBy: { id: "asc" } }), snapshot, "inschrijvingen en voortgang blijven intact");
  assert.deepEqual(errors, []);
  await context.close();
  console.log("CFM alleen bij eigen content: cursuslijst, aanbod, links en toevoegen; echte contentwissels en open catalogus zonder remount; voortgang behouden.");
} finally { await browser.close(); await prisma.$disconnect(); }
