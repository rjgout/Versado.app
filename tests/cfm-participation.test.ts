import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nl } from "../src/lib/i18n/messages/nl";
import { en } from "../src/lib/i18n/messages/en";
import { de } from "../src/lib/i18n/messages/de";
import { fr } from "../src/lib/i18n/messages/fr";
import { es } from "../src/lib/i18n/messages/es";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// CFM is deelname, geen cursus om te voltooien: nergens een totaal over alle weken, wel per week de zes stappen.

test("CFM toont nergens een totaalpercentage, weektelling of voltooiingsmelding", () => {
  const view = read("src/components/study/CfmCourseView.tsx");
  const week = read("src/components/study/CfmWeekPath.tsx");
  const summary = read("src/lib/studyContent/courseSummary.ts");
  const route = read("src/lib/learning/courseList.server.ts");
  const today = read("src/components/study/CfmTodayCard.tsx");
  assert.doesNotMatch(view, /CoursePathHeader|progressCount|allDone|completed/);
  assert.doesNotMatch(week, /role="progressbar"|progress=\{|percent/, "geen voortgangsbalk in het weekpad");
  assert.doesNotMatch(summary, /totalWeeks|completedWeeks|isWeekDone/);
  assert.doesNotMatch(today, /percent|progressbar|stepsDone|completed/i);
  // De cursuskaart in Leren: totalChapters 0 laat de bestaande kaartcode geen balk, teller of 'voltooid'-chip tonen.
  const cfmBranch = route.slice(route.indexOf("isStudyCourseType(course.type)"), route.indexOf("const chapterProgress"));
  assert.match(cfmBranch, /totalChapters: 0,/);
  assert.match(cfmBranch, /completedCount: 0,/);
  assert.doesNotMatch(cfmBranch, /totalWeeks|completedWeeks/);
  const courses = read("src/components/CoursesView.tsx");
  assert.match(courses, /course\.totalChapters > 0 \? <CardProgress/);
  assert.match(courses, /const complete = course\.totalChapters > 0 && /);
});

test("gewone leescursussen behouden hun voortgangsweergave", () => {
  for (const file of ["src/components/ReadingCourseView.tsx", "src/components/ChapterListCourseView.tsx"]) assert.match(read(file), /CoursePathHeader/);
  const header = read("src/components/reading/CoursePathHeader.tsx");
  assert.match(header, /role="progressbar"/);
  assert.match(header, /courseView\.allDone/);
  const route = read("src/lib/learning/courseList.server.ts");
  assert.match(route, /getCourseChapterProgress\(prisma, user\.id, course/, "gewone cursussen rekenen hun voortgang nog uit");
});

test("de zes stappen houden hun eigen, subtiele status per week", () => {
  const week = read("src/components/study/CfmWeekPath.tsx");
  assert.match(week, /data-step-status=\{status\}/);
  assert.match(week, /function StepDots/);
  assert.match(week, /cfmStudy\.statusNotStarted/);
  assert.match(week, /cfmStudy\.statusInProgress/);
  assert.match(week, /cfmStudy\.statusCompleted/);
  assert.match(week, /aria-current=\{isActive \? "step" : undefined\}/, "laatst geopende of eerstvolgende stap blijft gemarkeerd");
  // Afgeronde of niet-bestudeerde weken blijven te openen en in te klappen; er is geen vergrendeling.
  assert.match(week, /aria-expanded=\{isOpen\}/);
  assert.doesNotMatch(week, /aria-disabled|Lock/);
});

test("Vandaag: één primaire en één secundaire actie, dezelfde weekregel, geen hardcoded les", () => {
  const panel = read("src/lib/todayProgram.server.ts");
  assert.match(panel, /resolveWeekSelection\(weeks/);
  assert.match(panel, /cfmCoursePathHref\(prisma,data\.collectionId,'STEPS'\)/);
  const card = read("src/components/study/CfmTodayCard.tsx");
  assert.equal((card.match(/data-cfm-today-primary/g) ?? []).length, 2, "primaire actie: studeren, of (zonder week) het weekoverzicht");
  assert.equal((card.match(/data-cfm-today-secondary/g) ?? []).length, 1);
  assert.match(card, /mode === "STEPS" \? `\$\{base\}\/stappen` : base/, "de primaire actie volgt de gekozen leeswijze; /stappen hervat zelf bij de juiste stap");
  assert.match(card, /weekLabelKey\(resumeReason\)/, "het label volgt de reden van de hervatweek");
  assert.match(card, /imageSrc \?/, "zonder officiële afbeelding de bestaande Versado-fallback (neutrale kop)");
  assert.doesNotMatch(card, /Oude Testament|2026|Jesaja|Genesis/, "geen hardcoded lesnamen of jaren");
});

test("alle zichtbare teksten van de Vandaag-kaart bestaan in elke taal", () => {
  const keys = Object.keys(nl.cfmToday);
  assert.deepEqual(keys.sort(), ["brand", "continue", "invite", "inviteResume", "lastChosen", "lastStudied", "noWeekText", "noWeekTitle", "start", "viewSteps", "viewWeeks"]);
  for (const [name, messages] of Object.entries({ en, de, fr, es }) as unknown as [string, { cfmToday: Record<string, string> }][]) {
    assert.deepEqual(Object.keys(messages.cfmToday).sort(), keys.sort(), name);
    for (const key of keys) assert.ok(messages.cfmToday[key].length > 0, `${name}.${key}`);
  }
});

test("labels: alleen de kalenderweek heet 'Deze week'; gekozen en bestudeerd zijn verschillende labels", async () => {
  const { weekLabelKey, myWeekKind } = await import("../src/lib/studyContent/weekLabels");
  assert.equal(weekLabelKey("calendar"), "cfmStudy.currentWeek");
  assert.equal(weekLabelKey("selected"), "cfmToday.lastChosen");
  assert.equal(weekLabelKey("studied"), "cfmToday.lastStudied");
  assert.equal(weekLabelKey(null), null, "zonder hervatweek geen label");
  assert.equal(myWeekKind("calendar"), "week");
  assert.equal(myWeekKind("selected"), "chosenWeek");
  assert.equal(myWeekKind("studied"), "studiedWeek");
  const expected: Record<string, [string, string]> = {
    nl: ["Laatst gekozen week", "Laatst bestudeerd"],
    en: ["Last chosen week", "Last studied"],
    de: ["Zuletzt gewählte Woche", "Zuletzt studiert"],
    fr: ["Dernière semaine choisie", "Dernière étude"],
    es: ["Última semana elegida", "Último estudio"],
  };
  for (const [name, messages] of Object.entries({ nl, en, de, fr, es }) as unknown as [string, { cfmToday: Record<string, string>; courseView: { path: Record<string, string> } }][]) {
    assert.equal(messages.cfmToday.lastChosen, expected[name][0], name);
    assert.equal(messages.cfmToday.lastStudied, expected[name][1], name);
    for (const key of ["myChosenWeek", "myChosenWeekAria", "myStudiedWeek", "myStudiedWeekAria"]) assert.ok(messages.courseView.path[key], `${name}.${key}`);
    assert.notEqual(messages.cfmToday.lastChosen, messages.cfmToday.lastStudied);
  }
  assert.equal((nl as unknown as { cfmStudy: Record<string, string> }).cfmStudy.currentWeek, "Deze week");
  // De cursuskaart in Leren, het weekpad en Vandaag gebruiken dezelfde labelfunctie.
  for (const file of ["src/components/CoursesView.tsx", "src/components/study/CfmWeekPath.tsx", "src/components/study/CfmTodayCard.tsx"]) assert.match(read(file), /weekLabelKey/);
});
