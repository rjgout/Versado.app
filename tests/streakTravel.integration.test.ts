// Integratietest voor de reeks met tijdzones, tegen een echte Postgres-
// database (zelfde opzet als learning-progress.integration.test.ts). Draait
// alleen met LEARNING_TEST_DATABASE_URL; maakt een eigen testgebruiker aan en
// ruimt die daarna op.
//
//   LEARNING_TEST_DATABASE_URL=postgresql://... npm run test:time
import test, { after, before } from "node:test";
import assert from "node:assert/strict";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  streak: await import("../src/lib/streak"),
});
let L: Awaited<ReturnType<typeof load>>;
let userId = "";

const EXERCISE = { kind: "CONTENT_EXERCISES", answered: 3, required: 3 } as const;

async function study(iso: string, timeZone: string | null) {
  await L.db.user.update({ where: { id: userId }, data: { timeZone } });
  return L.db.$transaction((tx) => L.streak.recordLearningActivity(tx, userId, { ...EXERCISE, key: `test:${iso}` }, new Date(iso)));
}

async function state() {
  const user = await L.db.user.findUniqueOrThrow({ where: { id: userId }, select: { currentStreak: true, lastStudyDate: true, lastStudyTimeZone: true } });
  const days = await L.db.streakDay.findMany({ where: { userId }, orderBy: { dayKey: "asc" }, select: { dayKey: true, status: true } });
  return { ...user, days: days.map((d) => `${d.dayKey}:${d.status}`) };
}

async function reset(fields: { currentStreak?: number; lastStudyDate?: string | null; lastStudyTimeZone?: string | null; freezeCount?: number } = {}) {
  await L.db.streakDay.deleteMany({ where: { userId } });
  await L.db.streakActivity.deleteMany({ where: { userId } });
  await L.db.user.update({
    where: { id: userId },
    data: { currentStreak: 0, longestStreak: 0, lastStudyDate: null, lastStudyTimeZone: null, timeZone: null, freezeCount: 0, streakGraceDay: null, streakInterruptedDay: null, streakReturnDay: null, streakReturnTimeZone: null, streakReturnCount: 0, streakReturnRequired: 0, ...fields },
  });
}

before(async () => {
  if (skip) return;
  L = await load();
  const user = await L.db.user.create({
    data: { email: `tijdzone-${Date.now()}@test.invalid`, passwordHash: "x", handle: "Tijdzonetest", discriminator: String(1000 + Math.floor(Math.random() * 9000)) },
  });
  userId = user.id;
});

after(async () => {
  if (skip || !userId) return;
  await L.db.user.delete({ where: { id: userId } });
  await L.db.$disconnect();
});

test("Amsterdam -> New York: dagen blijven, geen extra dag", { skip }, async () => {
  await reset();
  await study("2026-10-01T10:00:00Z", "Europe/Amsterdam"); // AMS 1 okt.
  await study("2026-10-01T23:00:00Z", "Europe/Amsterdam"); // AMS 2 okt. 01:00
  let s = await state();
  assert.equal(s.currentStreak, 2);
  assert.equal(s.lastStudyDate, "2026-10-02");
  // Vlucht: in New York is het 1 okt. 21:00. Studeren levert niets extra op en zet niets terug.
  const r = await study("2026-10-02T01:00:00Z", "America/New_York");
  assert.equal(r.alreadyStudiedToday, true);
  s = await state();
  assert.equal(s.currentStreak, 2);
  assert.equal(s.lastStudyDate, "2026-10-02");
  assert.equal(s.lastStudyTimeZone, "Europe/Amsterdam");
  // NY 2 okt.: nog steeds dezelfde dag.
  await study("2026-10-02T15:00:00Z", "America/New_York");
  assert.equal((await state()).currentStreak, 2);
  // NY 3 okt.: de volgende dag.
  await study("2026-10-03T15:00:00Z", "America/New_York");
  s = await state();
  assert.equal(s.currentStreak, 3);
  assert.deepEqual(s.days, ["2026-10-01:STUDIED", "2026-10-02:STUDIED", "2026-10-03:STUDIED"]);
  assert.equal(s.lastStudyTimeZone, "America/New_York");
});

test("New York -> Amsterdam: geen gratis dag door de vooruitgesprongen datum", { skip }, async () => {
  await reset();
  await study("2026-10-02T02:00:00Z", "America/New_York"); // NY 1 okt. 22:00
  await study("2026-10-02T03:30:00Z", "Europe/Amsterdam"); // AMS 2 okt. 05:30, NY nog 1 okt. 23:30
  assert.equal((await state()).currentStreak, 1);
  await study("2026-10-02T12:00:00Z", "Europe/Amsterdam"); // ook in NY 2 okt.
  const s = await state();
  assert.equal(s.currentStreak, 2);
  assert.deepEqual(s.days, ["2026-10-01:STUDIED", "2026-10-02:STUDIED"]);
});

test("Amsterdam -> Tokio en Tokio -> Los Angeles", { skip }, async () => {
  await reset();
  await study("2026-10-02T20:00:00Z", "Europe/Amsterdam"); // AMS 2 okt. 22:00
  await study("2026-10-02T21:30:00Z", "Asia/Tokyo"); // Tokio 3 okt., AMS nog 2 okt.
  assert.equal((await state()).currentStreak, 1);
  await study("2026-10-03T08:00:00Z", "Asia/Tokyo"); // Tokio 3 okt. 17:00, AMS 3 okt.
  assert.equal((await state()).currentStreak, 2);
  await study("2026-10-04T01:00:00Z", "America/Los_Angeles"); // LA 3 okt. 18:00
  assert.equal((await state()).currentStreak, 2);
  await study("2026-10-04T17:00:00Z", "America/Los_Angeles"); // LA 4 okt.
  const s = await state();
  assert.equal(s.currentStreak, 3);
  assert.equal(s.days.filter((d) => d.endsWith("STUDIED")).length, 3);
});

test("bestaande reeks van vóór de tijdzones blijft intact bij de overgang", { skip }, async () => {
  // Zoals in de database: UTC-dag, geen tijdzone opgeslagen, 5 dagen reeks.
  await reset({ currentStreak: 5, lastStudyDate: "2026-10-01", lastStudyTimeZone: null });
  // Eerste activiteit met de nieuwe code, 00:30 Nederlandse tijd op 3 okt. (UTC nog 2 okt.).
  const r = await study("2026-10-02T22:30:00Z", null);
  const s = await state();
  assert.equal(r.streakBroken, false);
  assert.equal(s.currentStreak, 6);
  assert.equal(s.lastStudyDate, "2026-10-03");
  assert.equal(s.lastStudyTimeZone, "Europe/Amsterdam");
});

test("echt gemiste dag: eerst een reeksbevriezing, zonder extra reeksdag", { skip }, async () => {
  await reset({ currentStreak: 4, lastStudyDate: "2026-10-01", lastStudyTimeZone: "Europe/Amsterdam", freezeCount: 1 });
  const r = await study("2026-10-03T10:00:00Z", "Europe/Amsterdam"); // 2 okt. gemist
  assert.equal(r.freezeUsed, true);
  assert.equal(r.currentStreak, 5);
  assert.deepEqual((await state()).days, ["2026-10-02:FROZEN", "2026-10-03:STUDIED"]);
});
