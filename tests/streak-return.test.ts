import test from "node:test";
import assert from "node:assert/strict";
import { continuationView, dueReturnReminder, interruptionDays, missedDayPlan, returnActivitiesRequired, type ContinuationState } from "../src/lib/learning/streakReturnRules";

const state: ContinuationState = {
  currentStreak: 184, freezeCount: 0, lastStudyDate: "2026-01-01", lastStudyTimeZone: "Europe/Amsterdam", timeZone: "Europe/Amsterdam",
  streakGraceDay: null, streakInterruptedDay: null, streakReturnDay: null, streakReturnTimeZone: null, streakReturnCount: 0, streakReturnRequired: 0,
};

for (const [days, required] of [[1,3],[2,3],[3,4],[6,4],[7,5],[13,5],[14,6],[29,6],[30,7],[59,7],[60,8],[89,8],[90,9],[179,9],[180,10],[364,10],[365,11],[729,11],[730,12],[10000,12]]) {
  test(`${days} gemiste dagen vraagt ${required} activiteiten`, () => assert.equal(returnActivitiesRequired(days), required));
}

test("freeze eerst, ook wanneer het saldo niet alle gemiste dagen dekt", () => {
  const plan = missedDayPlan({ ...state, freezeCount: 2 }, new Date("2026-01-06T12:00Z"));
  assert.deepEqual(plan, { freezes: 2, frozenDays: ["2026-01-02", "2026-01-03"], interruptedDay: "2026-01-04" });
  assert.equal(state.currentStreak, 184);
});
test("vandaag nog niet actief is niet hetzelfde als een gemiste dag", () => {
  assert.deepEqual(missedDayPlan(state, new Date("2026-01-02T12:00Z")), { freezes: 0, frozenDays: [], interruptedDay: null });
});
test("uitrolanker beschermt bestaande gebruikers zonder geschiedenis te verzinnen", () => {
  assert.deepEqual(missedDayPlan({ ...state, streakGraceDay: "2026-10-03", freezeCount: 4 }, new Date("2026-10-04T12:00Z")), { freezes: 0, frozenDays: [], interruptedDay: null });
});
test("37 volledig gemiste dagen vragen zeven activiteiten", () => {
  const user = { ...state, streakInterruptedDay: "2026-01-02" };
  const now = new Date("2026-02-08T12:00Z");
  assert.equal(interruptionDays(user, now), 37);
  assert.equal(continuationView(user, now).required, 7);
});
test("nieuwe lokale dag wist poging in de weergave en berekent nieuwe grens", () => {
  const user = { ...state, streakInterruptedDay: "2026-01-02", streakReturnDay: "2026-01-04", streakReturnTimeZone: "Europe/Amsterdam", streakReturnCount: 2, streakReturnRequired: 3 };
  assert.equal(continuationView(user, new Date("2026-01-04T22:59:59Z")).completed, 2);
  const next = continuationView(user, new Date("2026-01-04T23:00:00Z"));
  assert.equal(next.completed, 0);
  assert.equal(next.required, 4);
  assert.equal(next.currentStreak, 184);
  assert.equal(next.studiedToday, false);
});
test("beide tijdzones beschermen de laatste behaalde reeksdag tijdens reizen", () => {
  const travelling = { ...state, lastStudyDate: "2026-10-01", lastStudyTimeZone: "America/New_York", timeZone: "Asia/Tokyo" };
  assert.equal(missedDayPlan(travelling, new Date("2026-10-02T20:00Z")).interruptedDay, null);
});
test("nieuwe accounts zonder reeks starten geen terugkeeropdracht", () => {
  assert.equal(missedDayPlan({ ...state, currentStreak: 0, lastStudyDate: null }, new Date("2040-01-01T12:00Z")).interruptedDay, null);
});
test("herinneringen nemen af, lopen jaarlijks door en halen geen stapel meldingen in", () => {
  const days = [1,3,7,14,30,60,120,240,365,730,1095];
  let last = 0;
  for (let day = 0; day <= 1100; day++) {
    const due = dueReturnReminder(day, last);
    if (days.includes(day)) { assert.equal(due, day); last = day; }
    else assert.equal(due, null);
  }
  assert.equal(dueReturnReminder(241, 0), 240);
  assert.equal(dueReturnReminder(20000, 0), 19710);
});
