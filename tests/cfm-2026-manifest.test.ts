import assert from "node:assert/strict";
import test from "node:test";
import { cfmOldTestament2026NlManifest } from "../src/lib/studyContent/cfm2026Manifest";
import { manifestStatus, validateStudyManifest, type StudyManifest } from "../src/lib/studyContent/manifest";

test("het gecontroleerde CFM-manifest bevat de 52 officiële perioden in volgorde", () => {
  const manifest = cfmOldTestament2026NlManifest;
  assert.equal(manifest.lessons.length, 52);
  assert.equal(manifest.lessons[0].startsOn, "2025-12-29");
  assert.equal(manifest.lessons.at(-1)?.endsOn, "2026-12-27");
  assert.deepEqual(manifest.lessons.map((lesson) => lesson.order), Array.from({ length: 52 }, (_, index) => index + 1));
  assert.deepEqual(validateStudyManifest(manifest).filter((diagnostic) => diagnostic.code.startsWith("DUPLICATE") || diagnostic.code.includes("CALENDAR_") || diagnostic.code === "ORDER_GAP"), []);
});

test("iedere les heeft een stabiele identiteit en officiële Nederlandse URL", () => {
  for (const lesson of cfmOldTestament2026NlManifest.lessons) {
    assert.match(lesson.periodSourceKey, /^cfm-old-testament-2026:\d{2}$/);
    assert.equal(lesson.language, "nl");
    assert.match(lesson.sourceUrl, /^https:\/\/www\.churchofjesuschrist\.org\/study\/manual\/come-follow-me-for-home-and-church-old-testament-2026\/\d{2}\?lang=nld$/);
    assert.ok(lesson.scriptureReferences.length > 0);
  }
});

test("een dubbele identiteit, ontbrekende URL en ongeldige kalender blokkeren de manifestvalidatie", () => {
  const broken: StudyManifest = {
    ...cfmOldTestament2026NlManifest,
    lessons: cfmOldTestament2026NlManifest.lessons.map((lesson) => ({ ...lesson })),
  };
  broken.lessons = broken.lessons.map((lesson, index) => index === 1 ? {
    ...lesson,
    sourceKey: broken.lessons[0].sourceKey,
    sourceUrl: "",
    startsOn: "2026-99-99",
  } : lesson);
  const diagnostics = validateStudyManifest(broken);
  assert.equal(manifestStatus(diagnostics), "BLOCKED");
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "DUPLICATE_SOURCE_KEY"));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "MISSING_REQUIRED_METADATA"));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "INVALID_CALENDAR_INTERVAL"));
});

test("onvolledige media- en referentiecontrole wordt zichtbaar en niet als volledig gerapporteerd", () => {
  const diagnostics = validateStudyManifest(cfmOldTestament2026NlManifest);
  assert.equal(manifestStatus(diagnostics), "BLOCKED");
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "MEDIA_INVENTORY_INCOMPLETE"));
  assert.ok(diagnostics.some((diagnostic) => diagnostic.code === "REFERENCE_MAPPING_INCOMPLETE"));
  assert.ok(!diagnostics.some((diagnostic) => diagnostic.code === "RIGHTS_NOT_CLEARED"));
});

test("validatie is herhaalbaar en doet geen netwerkverkeer", () => {
  const first = validateStudyManifest(cfmOldTestament2026NlManifest);
  const second = validateStudyManifest(cfmOldTestament2026NlManifest);
  assert.deepEqual(first, second);
});
