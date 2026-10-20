import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { activeStepIndex, type StepProgressState } from "../src/lib/studyContent/stepProgress";
import { PERSONAL_STUDY_STEPS } from "../src/lib/studyContent/personalStudy";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const steps = Array.from({ length: PERSONAL_STUDY_STEPS }, (_, i) => ({ index: i + 1, fingerprint: `fp${i + 1}` }));
const state = (done: number[], lastOpenedIndex: number | null = null, started: number[] = []): StepProgressState => ({
  steps: steps.map((s) => ({ index: s.index, fingerprint: s.fingerprint, status: done.includes(s.index) ? "COMPLETED" : started.includes(s.index) ? "IN_PROGRESS" : "NOT_STARTED", completedAt: null })),
  lastOpenedIndex,
  completedCount: done.length,
  allCompleted: done.length === PERSONAL_STUDY_STEPS,
});

test("de oude stappenpagina leidt rechtstreeks naar de stap waar de gebruiker verder kan", () => {
  assert.equal(activeStepIndex(steps, state([])), 1, "nieuwe week: de eerste stap");
  assert.equal(activeStepIndex(steps, state([1, 2])), 3, "eerste onafgeronde stap");
  assert.equal(activeStepIndex(steps, state([1], 4, [4])), 4, "laatst geopende, nog niet klare stap");
  assert.equal(activeStepIndex(steps, state([1, 4], 4, [])), 2, "een afgeronde laatst geopende stap telt niet");
  assert.equal(activeStepIndex(steps, state([1, 2, 3, 4, 5, 6], 3)), 6, "alles af: de laatste stap met de uitnodiging om te markeren");
  assert.equal(activeStepIndex(steps, state([1, 2, 3, 4, 5], 6)), 6);
});

test("Stap voor stap heeft geen tussenpagina en geen driepuntjesmenu meer", () => {
  assert.equal(existsSync(new URL("../src/components/study/StepOverview.tsx", import.meta.url)), false, "StepOverview is verwijderd");
  const overviewRoute = read("src/app/study-lesson/[lessonId]/[collectionId]/stappen/page.tsx");
  assert.match(overviewRoute, /redirect\(`\$\{base\}\/stappen\/\$\{activeStepIndex\(/);
  assert.doesNotMatch(overviewRoute, /StepOverview/);
  const reader = read("src/components/study/StudyReader.tsx");
  // Het menu bestaat alleen buiten de stapweergave (Vrije studie en de volledige les).
  assert.match(reader, /pageMode !== "step" && \(\s*<div className="flex items-center justify-end gap-2">\s*<HeaderMenu>/);
  assert.doesNotMatch(reader, /cfmStudy\.backToOverview/);
  assert.doesNotMatch(reader, /\$\{base\}\/stappen`\}/, "geen link meer naar het stappenoverzicht in de lezer");
  const week = read("src/components/study/CfmWeekPath.tsx");
  assert.doesNotMatch(week, /\$\{base\}\/stappen`/, "de weekkaart linkt rechtstreeks naar de stappen, niet naar een overzicht");
  assert.match(week, /href=\{`\$\{base\}\/stappen\/\$\{step\.index\}`\}/);
});

test("stapnavigatie: geen vorige stap bij stap 1, bij stap 6 terug naar het leerpad", () => {
  const reader = read("src/components/study/StudyReader.tsx");
  assert.match(reader, /\{stepNumber > 1 && \(\s*<Link href=\{`\$\{base\}\/stappen\/\$\{stepNumber - 1\}`\}[^>]*data-step-prev/);
  assert.match(reader, /stepNumber < PERSONAL_STUDY_STEPS \? \(\s*<Link href=\{`\$\{base\}\/stappen\/\$\{stepNumber \+ 1\}`\}[^>]*data-step-next/);
  assert.match(reader, /data-step-to-path/);
  assert.match(reader, /personal\.coursePath \?\? "\/courses"/);
});

test("de hoofdterugknop heeft een expliciete bestemming: niet-zacht in de stap, zacht in Vrije studie", () => {
  const step = read("src/app/study-lesson/[lessonId]/[collectionId]/stappen/[stap]/page.tsx");
  assert.match(step, /cfmCourseBackTarget\(prisma, parsed\.data\.collectionId, "STEPS"/);
  assert.match(step, /<ReaderBackTarget href=\{back\.href\} parent=\{back\.name\} \/>/, "geen soft: nooit router.back()");
  const free = read("src/app/study-lesson/[lessonId]/[collectionId]/page.tsx");
  assert.match(free, /cfmCourseBackTarget\(prisma, parsed\.data\.collectionId, "FREE"/);
  assert.match(free, /<ReaderBackTarget href=\{back\.href\} parent=\{back\.name\} soft \/>/);
  // De terugbalk zelf: een niet-zachte override forceert de bestemming (router.replace) en gebruikt dus geen browsergeschiedenis.
  const bar = read("src/components/SubpageBackBar.tsx");
  assert.match(bar, /forceFallback: page\?\.forceFallback \|\| \(Boolean\(override\) && !override\?\.soft\)/);
  // De bestemming is het leerpad van de cursus, niet een willekeurige lijst.
  const courses = read("src/lib/studyContent/cfmCourses.ts");
  assert.match(courses, /href: `\/courses\/\$\{course\.id\}\/pad`/);
});

test("stapvoortgang en leespositie blijven aan de stap en de revisie hangen, niet aan de navigatie", () => {
  const reader = read("src/components/study/StudyReader.tsx");
  assert.match(reader, /completeStep/);
  assert.match(reader, /data-complete-step/);
  assert.match(reader, /studyReader\.updateAvailable/, "de melding over een nieuwere leespositie/versie blijft");
  const stepRoute = read("src/app/study-lesson/[lessonId]/[collectionId]/stappen/[stap]/page.tsx");
  assert.match(stepRoute, /markCfmCourseStarted\(prisma, user\.id, parsed\.data\.collectionId, "STEPS"\)/);
});
