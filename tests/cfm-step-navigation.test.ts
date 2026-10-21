import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { activeStepIndex, type StepProgressState } from "../src/lib/studyContent/stepProgress";
import { PERSONAL_STUDY_STEPS } from "../src/lib/studyContent/personalStudy";
import { shouldUseFallback } from "../src/lib/navigationHistory";

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

test("navigatiecontract: de hoofdterugknop volgt de werkelijke herkomst, het leerpad is alleen de terugval", () => {
  const step = read("src/app/study-lesson/[lessonId]/[collectionId]/stappen/[stap]/page.tsx");
  assert.match(step, /cfmCoursePathTarget\(prisma, parsed\.data\.collectionId, "STEPS"/);
  // Zacht: browser-terug naar de herkomst (Vandaag, weekpad, ...); `href` geldt alleen zonder vorige pagina in de app.
  assert.match(step, /<ReaderBackTarget href=\{back\.href\} parent=\{back\.name\} soft studyOrigin \/>/, "Stap voor stap forceert de terugbestemming niet meer");
  const free = read("src/app/study-lesson/[lessonId]/[collectionId]/page.tsx");
  assert.match(free, /cfmCoursePathTarget\(prisma, parsed\.data\.collectionId, "FREE"/);
  assert.match(free, /<ReaderBackTarget href=\{back\.href\} parent=\{back\.name\} soft studyOrigin \/>/);
  // De terugbalk gebruikt alleen een niet-zachte override om te forceren; CFM gebruikt die niet.
  const bar = read("src/components/SubpageBackBar.tsx");
  assert.match(bar, /forceFallback: page\?\.forceFallback \|\| \(Boolean\(override\) && !override\?\.soft\)/);
  const courses = read("src/lib/studyContent/cfmCourses.ts");
  assert.match(courses, /href: `\/courses\/\$\{course\.id\}\/pad`/);
  assert.doesNotMatch(courses, /cfmCourseBackTarget/, "de oude, geforceerde naam is weg");
  // Er is geen tweede navigatielaag: geen returnUrl/redirect-parameter en geen eigen herkomstopslag voor de studieles.
  for (const file of [step, read("src/components/study/StudyReader.tsx")]) assert.doesNotMatch(file, /returnUrl|[?&]returnTo=|searchParams\.get\("(?:terug|return)/i);
});

test("stap-naar-stap vervangt het geschiedenisitem, zodat de hoofdterugknop altijd bij de herkomst uitkomt", () => {
  const reader = read("src/components/study/StudyReader.tsx");
  assert.match(reader, /stappen\/\$\{stepNumber - 1\}`\} prefetch=\{false\} replace data-step-prev/);
  assert.match(reader, /stappen\/\$\{stepNumber \+ 1\}`\} prefetch=\{false\} replace data-step-next/);
  assert.match(reader, /data-step-to-path/, "een eigen knop naar het weekpad, los van de hoofdterugknop");
  assert.match(reader, /useStudyReturnToPath/, "geen tweede weekpad op de geschiedenis (zie tests/cfm-study-origin.test.ts)");
});

// Model van de browsergeschiedenis: push voor een gewone link, replace voor stap-naar-stap, back voor de zachte terugknop.
class History {
  entries: string[];
  index = 0;
  constructor(start: string[]) { this.entries = start; this.index = start.length - 1; }
  get canGoBack() { return this.index > 0; }
  push(url: string) { this.entries = [...this.entries.slice(0, this.index + 1), url]; this.index++; }
  replace(url: string) { this.entries[this.index] = url; }
  back() { this.index--; }
  forward() { this.index++; }
  get url() { return this.entries[this.index]; }
}
const softBack = (history: History, fallback: string) => (shouldUseFallback(history.canGoBack) ? fallback : (history.back(), history.url));

test("navigatiescenario's A–E volgens het contract", () => {
  const lesson = "/study-lesson/l1/c1/stappen";
  const path = "/courses/cfm/pad";
  // A: Leren → weekpad → stap 1 → stap 2 → stap 3 → terug = weekpad → terug = Leren.
  const a = new History(["/courses"]);
  a.push(path); a.push(`${lesson}/1`); a.replace(`${lesson}/2`); a.replace(`${lesson}/3`);
  assert.equal(softBack(a, path), path);
  assert.equal(softBack(a, "/courses"), "/courses");
  // B: Vandaag → studieles (stap 1 → 2) → terug = Vandaag, niet het weekpad.
  const b = new History(["/dashboard"]);
  b.push(`${lesson}/1`); b.replace(`${lesson}/2`);
  assert.equal(softBack(b, path), "/dashboard");
  // Vooruit en weer terug: geen lus en geen extra items.
  b.forward();
  assert.equal(b.url, `${lesson}/2`);
  assert.equal(softBack(b, path), "/dashboard");
  assert.equal(b.entries.length, 2);
  // C: een andere geldige ingang (bijvoorbeeld Mijn studiemap) wint van het leerpad.
  const c = new History(["/study-folder"]);
  c.push(`${lesson}/4`);
  assert.equal(softBack(c, path), "/study-folder");
  // D: directe link of nieuwe tab zonder vorige pagina in de app: de veilige terugval binnen Leren.
  const d = new History([`${lesson}/2`]);
  assert.equal(softBack(d, path), path);
  assert.equal(shouldUseFallback(false), true);
  assert.equal(shouldUseFallback(true), false);
  // E: de hoofdterugknop verandert niet door stapnavigatie: na vijf stappen is de herkomst nog dezelfde.
  const e = new History(["/dashboard"]);
  e.push(`${lesson}/1`);
  for (const n of [2, 3, 4, 5, 6]) e.replace(`${lesson}/${n}`);
  assert.equal(e.entries.length, 2);
  assert.equal(softBack(e, path), "/dashboard");
});

test("stapvoortgang en leespositie blijven aan de stap en de revisie hangen, niet aan de navigatie", () => {
  const reader = read("src/components/study/StudyReader.tsx");
  assert.match(reader, /completeStep/);
  assert.match(reader, /data-complete-step/);
  assert.match(reader, /studyReader\.updateAvailable/, "de melding over een nieuwere leespositie/versie blijft");
  const stepRoute = read("src/app/study-lesson/[lessonId]/[collectionId]/stappen/[stap]/page.tsx");
  assert.match(stepRoute, /markCfmCourseStarted\(prisma, user\.id, parsed\.data\.collectionId, "STEPS"\)/);
});
