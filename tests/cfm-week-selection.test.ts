import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarWeekOf, hasStudyActivity, isWeekDone, resolveWeekSelection, type SelectableWeek } from "../src/lib/studyContent/weekSelection";
import { userDayKey } from "../src/lib/timeZone";

// Synthetisch jaar: vier weken van maandag t/m zondag (einde exclusief), zoals de importer ze vastlegt.
const week = (n: number, startsOn: string, endsOnExclusive: string, extra: Partial<SelectableWeek> = {}): SelectableWeek => ({
  lessonKey: `study:w${n}`, startsOn, endsOnExclusive, read: false, stepsDone: 0, ...extra,
});
const base = [
  week(1, "2026-12-14", "2026-12-21"),
  week(2, "2026-12-21", "2026-12-28"),
  week(3, "2026-12-28", "2027-01-04"),
  week(4, "2027-01-04", "2027-01-11"),
];
const select = (weeks: SelectableWeek[], today: string, selectedLessonKey?: string | null) => resolveWeekSelection(weeks, { today, selectedLessonKey });
const key = (w: SelectableWeek | null) => w?.lessonKey ?? null;

test("eerste dag van een jaar en gewone weekovergang kiezen de kalenderweek", () => {
  assert.equal(key(select(base, "2026-12-14").resume), "study:w1");
  assert.equal(key(select(base, "2026-12-20").resume), "study:w1", "zondag hoort nog bij de week");
  assert.equal(key(select(base, "2026-12-21").resume), "study:w2", "maandag begint de volgende week");
  assert.equal(select(base, "2026-12-21").resumeReason, "calendar");
});

test("laatste dag van 2026 valt in een week die over de jaargrens loopt", () => {
  assert.equal(key(select(base, "2026-12-31").calendar), "study:w3");
  assert.equal(key(select(base, "2027-01-03").calendar), "study:w3");
  assert.equal(key(select(base, "2027-01-04").calendar), "study:w4");
});

test("na de laatste gepubliceerde week bestaat er geen kalenderweek en heet de hervatweek niet 'deze week'", () => {
  const after = select(base, "2027-01-11");
  assert.equal(after.calendar, null);
  // Niets bestudeerd en niets gekozen: geen impliciete achterstand, maar een neutraal weekoverzicht.
  assert.equal(after.resume, null);
  assert.equal(after.resumeReason, null);
});

test("de oudste onafgeronde week wordt nooit automatisch de hervatweek", () => {
  // Week 1 is nooit geopend; week 3 is bestudeerd: hervatten gaat naar week 3, niet naar de 'achterstand' van week 1.
  const studied = [base[0], base[1], { ...base[2], stepsDone: 2, lastStudiedAt: "2027-02-01T10:00:00Z" }, base[3]];
  const result = select(studied, "2027-02-01");
  assert.equal(key(result.resume), "study:w3");
  assert.equal(result.resumeReason, "studied");
});

test("laatst bestudeerd is de week met de recentste activiteit, niet de chronologisch laatste week", () => {
  // Eerst week 3 bestudeerd, daarna terug naar week 1: week 1 is de recentst bestudeerde week.
  const weeks = [
    { ...base[0], stepsDone: 1, lastStudiedAt: "2027-02-03T09:00:00Z" },
    base[1],
    { ...base[2], stepsDone: 6, lastStudiedAt: "2027-02-01T09:00:00Z" },
    base[3],
  ];
  const result = select(weeks, "2027-03-01");
  assert.equal(key(result.resume), "study:w1");
  assert.equal(result.resumeReason, "studied");
  // Gelijk tijdstip: de latere week wint (deterministisch).
  const tie = [{ ...base[0], lastStudiedAt: "2027-02-03T09:00:00Z" }, base[1], { ...base[2], lastStudiedAt: "2027-02-03T09:00:00Z" }, base[3]];
  assert.equal(key(select(tie, "2027-03-01").resume), "study:w3");
});

test("alleen bekeken of gekozen is niet bestudeerd; zonder betrouwbaar tijdstip geen verzonnen hervatweek", () => {
  // Stappen afgerond maar zonder tijdstip (bijvoorbeeld een oude rij): niet op tijd te ordenen, dus geen 'laatst bestudeerd'.
  const undated = [{ ...base[0], stepsDone: 3 }, { ...base[1], read: true }, base[2], base[3]];
  assert.equal(select(undated, "2027-03-01").resume, null);
  assert.equal(select(undated, "2027-03-01").resumeReason, null);
  assert.equal(hasStudyActivity({ lastStudiedAt: null }), false);
  assert.equal(hasStudyActivity({ lastStudiedAt: "2027-02-01T09:00:00Z" }), true);
  // Een week alleen kiezen levert 'selected' op, nooit 'studied'.
  assert.equal(select(base, "2027-03-01", "study:w2").resumeReason, "selected");
});

test("voor het begin van het jaar is er geen kalenderweek en geen hervatweek zonder studie", () => {
  const before = select(base, "2026-12-01");
  assert.equal(before.calendar, null);
  assert.equal(before.resume, null);
});

test("de kalenderweek wint van een gekozen of bestudeerde week", () => {
  const weeks = [{ ...base[0], lastStudiedAt: "2026-12-15T09:00:00Z" }, ...base.slice(1)];
  assert.equal(key(select(weeks, "2026-12-22", "study:w1").resume), "study:w2");
  assert.equal(select(weeks, "2026-12-22", "study:w1").resumeReason, "calendar");
});

test("een gekozen week wint van een bestudeerde week buiten de kalenderweek", () => {
  const weeks = [{ ...base[0], lastStudiedAt: "2027-02-03T09:00:00Z" }, ...base.slice(1)];
  const result = select(weeks, "2027-03-01", "study:w3");
  assert.equal(key(result.resume), "study:w3");
  assert.equal(result.resumeReason, "selected");
});

test("een week is af bij gelezen of zes stappen; gedeeltelijk is niet af", () => {
  assert.equal(isWeekDone({ ...base[0], stepsDone: 5 }), false);
  assert.equal(isWeekDone({ read: true, stepsDone: 0 }), true);
  assert.equal(isWeekDone({ read: false, stepsDone: 6 }), true);
});

test("een zelf geopende oudere of toekomstige week wordt de hervatweek zolang er geen kalenderweek is", () => {
  assert.equal(key(select(base, "2027-02-01", "study:w3").resume), "study:w3");
  assert.equal(select(base, "2027-02-01", "study:w3").resumeReason, "selected");
  assert.equal(key(select(base, "2026-11-01", "study:w4").resume), "study:w4", "toekomstige week handmatig geopend");
  // De kalenderweek blijft voorrang houden; de gekozen week blijft apart beschikbaar.
  const during = select(base, "2026-12-22", "study:w4");
  assert.equal(key(during.resume), "study:w2");
  assert.equal(key(during.selected), "study:w4");
  // Een gekozen week die niet (meer) gepubliceerd is in deze collectie telt niet.
  assert.equal(select(base, "2027-02-01", "study:onbekend").selected, null);
  assert.equal(select(base, "2027-02-01", "study:onbekend").resumeReason, null);
});

test("zonder gepubliceerde lessen is er niets te kiezen", () => {
  assert.deepEqual(select([], "2026-12-22"), { calendar: null, selected: null, resume: null, resumeReason: null });
});

test("overlappende of ongeldige perioden geven geen willekeurige kalenderweek", () => {
  const overlap = [week(1, "2026-12-14", "2026-12-22"), week(2, "2026-12-21", "2026-12-28")];
  assert.equal(calendarWeekOf(overlap, "2026-12-21"), null);
  assert.equal(calendarWeekOf([week(1, "", "2026-12-28")].map((w) => ({ ...w, startsOn: null })), "2026-12-21"), null);
});

test("de kalenderdag volgt de tijdzone van de gebruiker", () => {
  // 2026-12-27 23:30 UTC is in Auckland (UTC+13) al maandag 28 december en in Los Angeles nog zondag 27 december.
  const moment = new Date("2026-12-27T23:30:00Z");
  assert.equal(userDayKey({ timeZone: "Pacific/Auckland" }, moment), "2026-12-28");
  assert.equal(userDayKey({ timeZone: "America/Los_Angeles" }, moment), "2026-12-27");
  assert.equal(key(select(base, userDayKey({ timeZone: "Pacific/Auckland" }, moment)).calendar), "study:w3");
  assert.equal(key(select(base, userDayKey({ timeZone: "America/Los_Angeles" }, moment)).calendar), "study:w2");
});

test("een volgend studiejaar met een nieuwe collectie heeft een eigen, onafhankelijke selectie", () => {
  const next = [week(1, "2027-12-27", "2028-01-03", { stepsDone: 6 }), week(2, "2028-01-03", "2028-01-10")];
  assert.equal(key(select(next, "2028-01-04").resume), "study:w2");
  // De weken van het vorige jaar blijven buiten beeld: elke collectie krijgt alleen haar eigen weken.
  assert.equal(select(next, "2027-01-04").calendar, null);
  assert.equal(key(select(base, "2027-01-04").calendar), "study:w4");
});
