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
  // Week 1 is nooit geopend, week 3 wel bestudeerd: hervatten gaat naar week 3, niet naar de 'achterstand' van week 1.
  const studied = [base[0], base[1], { ...base[2], stepsDone: 2 }, base[3]];
  const result = select(studied, "2027-02-01");
  assert.equal(key(result.resume), "study:w3");
  assert.equal(result.resumeReason, "studied");
  // Bij meerdere bestudeerde weken geldt de laatste (hoogste) bestudeerde week.
  assert.equal(key(select([{ ...base[0], read: true }, { ...base[1], stepsDone: 1 }, base[2], base[3]], "2027-02-01").resume), "study:w2");
});

test("voor het begin van het jaar is er ook geen kalenderweek en geen hervatweek zonder studie", () => {
  const before = select(base, "2026-12-01");
  assert.equal(before.calendar, null);
  assert.equal(before.resume, null);
});

test("alle weken afgerond: zonder kalenderweek de laatst bestudeerde week", () => {
  const done = base.map((w, i) => (i % 2 ? { ...w, stepsDone: 6 } : { ...w, read: true }));
  assert.ok(done.every(isWeekDone));
  const result = select(done, "2027-03-01");
  assert.equal(result.resumeReason, "studied");
  assert.equal(key(result.resume), "study:w4");
  // Met een kalenderweek wint die, ook als ze al af is.
  assert.equal(key(select(done, "2026-12-22").resume), "study:w2");
});

test("een gedeeltelijk afgeronde week is nog niet af, maar telt wel als bestudeerd", () => {
  const partial = [{ ...base[0], stepsDone: 5 }, ...base.slice(1)];
  assert.equal(isWeekDone(partial[0]), false);
  assert.equal(hasStudyActivity(partial[0]), true);
  assert.equal(key(select(partial, "2027-02-01").resume), "study:w1");
  assert.equal(isWeekDone({ read: true, stepsDone: 0 }), true);
  assert.equal(hasStudyActivity({ read: false, stepsDone: 0 }), false);
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
