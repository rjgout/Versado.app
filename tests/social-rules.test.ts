import test from "node:test";
import assert from "node:assert/strict";
import {
  GROUP_MAX_MEMBERS,
  dayEndsForAll,
  dayOverEverywhere,
  memberDayOutcome,
  requiredContributors,
  requiredPercentage,
  resolveSocialDay,
} from "../src/lib/social/rules";

const at = (iso: string) => new Date(iso);

test("groepsformule: de voorbeelden uit de opdracht", () => {
  const expected: [number, number][] = [
    [3, 3],
    [4, 3],
    [5, 4],
    [6, 5],
    [10, 7],
    [15, 9],
    [20, 12],
    [25, 14],
    [50, 27],
    [100, 51],
    [200, 98],
    [500, 238],
  ];
  for (const [members, required] of expected) assert.equal(requiredContributors(members), required, `${members} leden`);
});

test("groepsformule: randgevallen", () => {
  // Onder de 3 leden geen lopende reeks.
  for (const n of [-1, 0, 1, 2]) assert.equal(requiredContributors(n), null, `${n}`);
  assert.equal(requiredContributors(2.5), null);
  // Precies 3: altijd alle 3, ook al geeft de formule 76,75%.
  assert.ok(requiredPercentage(3) < 100);
  assert.equal(requiredContributors(3), 3);
  // Nooit meer nodig dan er leden zijn, en monotoon stijgend.
  let previous = 0;
  for (let n = 3; n <= GROUP_MAX_MEMBERS * 4; n++) {
    const r = requiredContributors(n)!;
    assert.ok(r <= n, `${n}: ${r} > ${n}`);
    assert.ok(r >= previous, `${n}: daalt van ${previous} naar ${r}`);
    assert.ok(r >= Math.ceil(n * 0.45), `${n}: onder de 45%`);
    previous = r;
  }
  // Exacte uitkomsten (25 x 56% = 14) niet naar boven afronden door rekenruis.
  assert.equal(requiredContributors(25), 14);
  // Het percentage zakt van ~77% naar ~47% bij 500 leden.
  assert.ok(Math.abs(requiredPercentage(500) - 47.46) < 0.01);
});

test("uitkomst van een dag: gehaald gaat voor alles, daarna pas definitief", () => {
  const base = { eligible: 10, required: 7, settled: false, freezeReserved: false };
  assert.equal(resolveSocialDay({ ...base, contributors: 7 }), "achieved");
  assert.equal(resolveSocialDay({ ...base, contributors: 6 }), "pending");
  assert.equal(resolveSocialDay({ ...base, contributors: 6, settled: true }), "missed");
  assert.equal(resolveSocialDay({ ...base, contributors: 6, settled: true, freezeReserved: true }), "protected");
  // Ook met een aangeboden bevriezing: gehaald is gehaald (bevriezing niet nodig).
  assert.equal(resolveSocialDay({ ...base, contributors: 8, freezeReserved: true }), "achieved");
  // Te weinig leden: gepauzeerd, nooit gemist.
  assert.equal(resolveSocialDay({ eligible: 2, contributors: 0, required: null, settled: true, freezeReserved: false }), "paused");
  // Vriendenreeks: 2 van 2.
  assert.equal(resolveSocialDay({ eligible: 2, contributors: 1, required: 2, settled: true, freezeReserved: false }), "missed");
  assert.equal(resolveSocialDay({ eligible: 2, contributors: 2, required: 2, settled: false, freezeReserved: false }), "achieved");
});

test("dag van één persoon: behouden, nog bezig of gemist (eigen tijdzone)", () => {
  const ams = { kept: false, timeZone: "Europe/Amsterdam", lastStudyDate: null, lastStudyTimeZone: null, currentStreak: 0 };
  // 6 mei 2031, 23:30 in Nederland: de dag loopt nog.
  assert.equal(memberDayOutcome(ams, "2031-05-06", at("2031-05-06T21:30:00Z")), "pending");
  // Na middernacht: gemist.
  assert.equal(memberDayOutcome(ams, "2031-05-06", at("2031-05-06T22:00:00Z")), "missed");
  assert.equal(memberDayOutcome({ ...ams, kept: true }, "2031-05-06", at("2031-05-06T10:00:00Z")), "kept");
  // Lopende reeks met een oudere laatste dag: wachten op de reeksafsluiting (bevriezing).
  const rolling = { ...ams, lastStudyDate: "2031-05-05", lastStudyTimeZone: "Europe/Amsterdam", currentStreak: 4 };
  assert.equal(memberDayOutcome(rolling, "2031-05-06", at("2031-05-06T23:00:00Z")), "pending");
  // De bewaarde teller van een al onderbroken persoonlijke reeks mag de
  // gemiste sociale dag niet eindeloos in behandeling houden.
  assert.equal(memberDayOutcome({ ...rolling, streakInterruptedDay: "2031-05-06" }, "2031-05-06", at("2031-05-06T23:00:00Z")), "missed");
  // Maar nooit langer dan tot de dag overal voorbij is.
  assert.equal(memberDayOutcome(rolling, "2031-05-06", at("2031-05-07T12:15:00Z")), "missed");
  // Tokio is eerder klaar dan Nederland, Los Angeles later.
  const tokyo = { ...ams, timeZone: "Asia/Tokyo" };
  const la = { ...ams, timeZone: "America/Los_Angeles" };
  const moment = at("2031-05-06T16:00:00Z"); // Tokio 7 mei 01:00, NL 18:00, LA 09:00
  assert.equal(memberDayOutcome(tokyo, "2031-05-06", moment), "missed");
  assert.equal(memberDayOutcome(la, "2031-05-06", moment), "pending");
  // Na een reis: de dag is pas voorbij als hij in beide tijdzones voorbij is.
  const travelled = { ...tokyo, lastStudyDate: "2031-05-06", lastStudyTimeZone: "America/Los_Angeles" };
  assert.equal(memberDayOutcome({ ...travelled, lastStudyDate: "2031-05-05" }, "2031-05-06", moment), "pending");
});

test("wanneer een dag voor iedereen voorbij is", () => {
  assert.equal(dayEndsForAll("2031-05-06", ["Europe/Amsterdam"]).toISOString(), "2031-05-06T22:00:00.000Z");
  assert.equal(dayEndsForAll("2031-05-06", ["Asia/Tokyo", null]).toISOString(), "2031-05-06T22:00:00.000Z"); // null = Amsterdam
  assert.equal(dayEndsForAll("2031-05-06", ["Asia/Tokyo", "America/Los_Angeles"]).toISOString(), "2031-05-07T07:00:00.000Z");
  assert.equal(dayOverEverywhere("2031-05-06", at("2031-05-07T12:14:00Z")), false);
  assert.equal(dayOverEverywhere("2031-05-06", at("2031-05-07T12:15:00Z")), true);
});
