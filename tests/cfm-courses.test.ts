import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isReadingPathType, isStudyCourseType, modeOfStudyCourse } from "../src/lib/readingCourses";
import { CFM_COLLECTION_ID, CFM_COURSES, cfmCourseSlug } from "../src/lib/studyContent/cfmCourses";
import { localizedCourse } from "../src/lib/courseText";

test("studiecursussen zijn een eigen cursustype met een vaste leeswijze, los van de leescursussen", () => {
  assert.ok(isStudyCourseType("STUDY_STEPS") && isStudyCourseType("STUDY_FREE"));
  assert.ok(!isStudyCourseType("FREE_CHOICE") && !isStudyCourseType("FSY"));
  assert.ok(!isReadingPathType("STUDY_STEPS"), "de hoofdstukroute blijft voor de leescursussen");
  assert.equal(modeOfStudyCourse("STUDY_STEPS"), "STEPS");
  assert.equal(modeOfStudyCourse("STUDY_FREE"), "FREE");
});

test("CFM krijgt precies twee cursussen, Stap voor stap als standaard (eerst)", () => {
  assert.deepEqual(CFM_COURSES.map((c) => c.type), ["STUDY_STEPS", "STUDY_FREE"]);
  assert.equal(new Set(CFM_COURSES.map((c) => c.slug)).size, 2);
  assert.ok(CFM_COURSES[0].order < CFM_COURSES[1].order);
});

test("de cursusnamen zijn vertaald in alle talen en Nederlands toont de databasewaarde", () => {
  const steps = CFM_COURSES[0];
  assert.equal(localizedCourse({ ...steps, work: "cfm-old-testament-2026" }, "nl").name, "Stap voor stap");
  for (const language of ["en", "de", "fr", "es"]) {
    const localized = localizedCourse({ ...steps, work: "cfm-old-testament-2026" }, language);
    assert.ok(localized.name && localized.description, language);
    assert.notEqual(localized.name, "studySteps");
  }
  assert.equal(localizedCourse({ ...CFM_COURSES[1], work: "x" }, "en").name, "Free study");
});

test("de migraties voegen alleen enumwaarden toe en maken de cursussen aan zonder iemand in te schrijven", () => {
  const types = readFileSync("prisma/migrations/20261124120000_study_course_types/migration.sql", "utf8");
  assert.match(types, /ADD VALUE IF NOT EXISTS 'STUDY_STEPS'/);
  assert.match(types, /ADD VALUE IF NOT EXISTS 'STUDY_FREE'/);
  assert.doesNotMatch(types, /INSERT/i, "een nieuwe enumwaarde is pas in een volgende migratie bruikbaar");
  const backfill = readFileSync("prisma/migrations/20261124130000_study_courses_backfill/migration.sql", "utf8");
  assert.match(backfill, /ON CONFLICT \("slug"\) DO NOTHING/);
  assert.doesNotMatch(backfill, /UserCourseProgress|DELETE|UPDATE/i);
});

test("het cursusoverzicht gebruikt voor CFM dezelfde kaarten, hetzelfde toevoegen en verbergen als de leescursussen", () => {
  const page = readFileSync("src/app/courses/page.tsx", "utf8");
  assert.match(page, /lesson\.personal\) \|\| data\.archivedCount > 0\) return <CoursesClient \/>/, "ook als alle weken gearchiveerd zijn blijft de cursuskaart de ingang");
  const client = readFileSync("src/components/CoursesClient.tsx", "utf8");
  assert.match(client, /STUDY_STEPS: "courses\.types\.studySteps"/);
  // Geen tweede cursussysteem: de weekkaarten komen uit dezelfde bouwstenen als de leespaden.
  const week = readFileSync("src/components/study/CfmWeekPath.tsx", "utf8");
  assert.match(week, /from "@\/components\/reading\/pathParts"/);
  const view = readFileSync("src/components/study/CfmCourseView.tsx", "utf8");
  assert.doesNotMatch(view, /CoursePathHeader/, "CFM heeft een lichte kop zonder totaalvoortgang (docs/CFM-PERSOONLIJKE-STUDIE.md §18)");
  assert.match(view, /MyStepNav/);
  assert.doesNotMatch(view, /fixed|sticky/, "geen eigen vaste lagen");
});

test("een week of stap openen maakt de cursus de huidige leerreis, zonder reeks of XP", () => {
  const helper = readFileSync("src/lib/studyContent/cfmCourses.ts", "utf8");
  assert.match(helper, /markCourseStarted/);
  const imports = helper.split("\n").filter((line) => /^import /.test(line)).join("\n");
  assert.doesNotMatch(imports, /streak|xp|learning|contentProgress/i);
});

test("cursusidentiteit: CFM 2026 houdt zijn slugs, een ander jaar krijgt eigen afgeleide slugs", () => {
  assert.equal(cfmCourseSlug({ id: CFM_COLLECTION_ID, slug: "cfm-ot-2026-nl" }, "STUDY_STEPS"), "kom-dan-en-volg-mij-stap-voor-stap");
  assert.equal(cfmCourseSlug({ id: CFM_COLLECTION_ID, slug: "cfm-ot-2026-nl" }, "STUDY_FREE"), "kom-dan-en-volg-mij-vrije-studie");
  const next = { id: "content_cfm_nt_2027_nl", slug: "cfm-nt-2027-nl" };
  const slugs = [cfmCourseSlug(next, "STUDY_STEPS"), cfmCourseSlug(next, "STUDY_FREE")];
  assert.deepEqual(slugs, ["kom-dan-en-volg-mij-cfm-nt-2027-nl-stap-voor-stap", "kom-dan-en-volg-mij-cfm-nt-2027-nl-vrije-studie"]);
  assert.ok(slugs.every((slug) => !CFM_COURSES.some((c) => c.slug === slug)), "geen botsing met 2026");
  // De identiteit hangt niet af van de weergegeven of vertaalde naam.
  assert.equal(cfmCourseSlug(next, "STUDY_STEPS"), cfmCourseSlug(next, "STUDY_STEPS"));
});
