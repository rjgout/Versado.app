// Persoonlijke zichtbaarheid van Vandaag → Ga verder: de server bepaalt de
// volgorde; verbergen mag voortgang nooit veranderen en is per gebruiker.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { compactContinueItems, continueVisibilityKey, visibleContinueItems, type ContinueItem } from "../src/lib/today";
import { introResumeHref, kidsResumeHref, podcastResumeHref, readingResumeHref } from "../src/lib/courseResume";
import { I18nProvider } from "../src/components/I18nProvider";
import { getT, messagesFor } from "../src/lib/i18n";

const localRequire = Module.createRequire(import.meta.url);
localRequire.cache[localRequire.resolve("next/image")] = {
  exports: { __esModule: true, default: (props: { alt?: string }) => h("img", { alt: props.alt ?? "" }) },
} as unknown as NodeJS.Module;
const ContinueSection = localRequire("../src/components/today/ContinueSection").default as typeof import("../src/components/today/ContinueSection").default;

const activityAt = "2026-10-08T12:00:00.000Z";
const sample = (key: string, at = activityAt): ContinueItem => ({
  key,
  visibilityKey: continueVisibilityKey(key, at),
  kind: "course",
  title: key,
  position: null,
  positionSeconds: null,
  progress: null,
  href: "/courses/example",
  context: "Test",
  at,
  artwork: [],
});

test("verborgen Ga-verder-kaarten blijven weg, zonder de servervolgorde van de rest te wijzigen", () => {
  const first = sample("course-a");
  const second = sample("course-b");
  const third = sample("course-c");
  assert.deepEqual(visibleContinueItems([first, second, third], new Set([second.visibilityKey])).map((item) => item.key), ["course-a", "course-c"]);
});

test("nieuwe activiteit maakt dezelfde inhoud weer relevant", () => {
  const oldState = sample("course-a");
  const resumed = sample("course-a", "2026-10-09T12:00:00.000Z");
  assert.notEqual(oldState.visibilityKey, resumed.visibilityKey);
  assert.deepEqual(visibleContinueItems([resumed], new Set([oldState.visibilityKey])).map((item) => item.key), ["course-a"]);
});

test("Ga verder houdt maximaal drie meest recente kaarten over en laat na verbergen de volgende doorschuiven", () => {
  const items = [
    sample("course-old", "2026-10-01T12:00:00.000Z"),
    sample("course-second", "2026-10-02T12:00:00.000Z"),
    sample("course-third", "2026-10-03T12:00:00.000Z"),
    sample("course-new", "2026-10-04T12:00:00.000Z"),
  ];

  assert.deepEqual(compactContinueItems(items, new Set()).map((item) => item.key), ["course-new", "course-third", "course-second"]);
  assert.deepEqual(
    compactContinueItems(items, new Set([items[3].visibilityKey])).map((item) => item.key),
    ["course-third", "course-second", "course-old"]
  );
});

test("alleen bestaande concrete detailroutes gelden als hervatpunt", () => {
  assert.equal(
    readingResumeHref({ courseId: "course", type: "FRONT_TO_BACK", currentChapterId: "alma-32", currentLessonId: null }),
    "/lesson/alma-32?cursus=course"
  );
  assert.equal(
    readingResumeHref({ courseId: "course", type: "BY_BOOK", currentChapterId: "alma-32", currentLessonId: null }),
    "/lesson/alma-32?cursus=course"
  );
  assert.equal(
    readingResumeHref({ courseId: "course", type: "READING_LESSONS", currentChapterId: null, currentLessonId: "lesson-32" }),
    "/reading-lesson/lesson-32"
  );
  assert.equal(readingResumeHref({ courseId: "course", type: "READING_LESSONS", currentChapterId: null, currentLessonId: null }), null);
  assert.equal(readingResumeHref({ courseId: "course", type: "KIDS", currentChapterId: null, currentLessonId: null }), null);
  assert.equal(kidsResumeHref("story-1"), "/kids/story-1");
  assert.equal(introResumeHref("intro-1"), "/intro/intro-1");
  assert.equal(podcastResumeHref("episode-1", "CONTENT"), "/podcast/episode-1/CONTENT");
  assert.equal(podcastResumeHref("episode-1", "BOM_CONNECTION"), "/podcast/episode-1/BOM_CONNECTION");
  assert.equal(podcastResumeHref("episode-1", null), null);
});

test("Ga verder hergebruikt het kaartmenu zonder sleepbediening", () => {
  const item = sample("course-a");
  const html = renderToStaticMarkup(
    h(I18nProvider, {
      language: "nl",
      messages: messagesFor("nl"),
      children: h(ContinueSection, { items: [item], language: "nl" }),
    })
  );
  assert.match(html, /aria-label="Beheer course-a"[^>]*aria-haspopup="menu"/);
  assert.equal(getT("nl")("today.hideContinue"), "Verbergen uit Ga verder");
  assert.match(html, /card-title-link/);
  assert.doesNotMatch(html, /course-a verplaatsen/);
});

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";
const emailA = `today-continue-a-${Date.now()}@test.invalid`;
const emailB = `today-continue-b-${Date.now()}@test.invalid`;
let prisma: typeof import("../src/lib/db").prisma;
let courseId: string;

before(async () => {
  if (skip) return;
  prisma = (await import("../src/lib/db")).prisma;
  courseId = (await prisma.course.findFirstOrThrow({ where: { enabled: true }, select: { id: true } })).id;
});

after(async () => {
  if (skip) return;
  await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  await prisma.$disconnect();
});

test("verborgen Ga-verder-kaart is persoonlijk en laat cursusvoortgang intact", { skip }, async () => {
  const [first, second] = await Promise.all([
    prisma.user.create({ data: { email: emailA, passwordHash: "x", handle: "Vandaag A", discriminator: "01" } }),
    prisma.user.create({ data: { email: emailB, passwordHash: "x", handle: "Vandaag B", discriminator: "02" } }),
  ]);
  const key = continueVisibilityKey(`course-${courseId}`, activityAt);
  await prisma.userCourseProgress.create({ data: { userId: first.id, courseId, subscribed: true, comboCount: 4 } });
  await prisma.userListOrder.create({ data: { userId: first.id, listKey: "today-continue", itemKey: key, order: 0, hidden: true } });

  assert.equal(await prisma.userListOrder.count({ where: { userId: first.id, listKey: "today-continue", itemKey: key, hidden: true } }), 1);
  assert.equal(await prisma.userListOrder.count({ where: { userId: second.id, listKey: "today-continue", itemKey: key } }), 0);
  assert.equal((await prisma.userCourseProgress.findUniqueOrThrow({ where: { userId_courseId: { userId: first.id, courseId } } })).comboCount, 4);
});
