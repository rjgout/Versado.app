import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Prisma } from "../src/generated/prisma/client";
import { addDays } from "../src/lib/dates";
import { userDayKey, hhmmInZone } from "../src/lib/timeZone";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";
const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  streak: await import("../src/lib/streak"),
  continuation: await import("../src/lib/streakContinuation"),
  calendar: await import("../src/lib/streakCalendar"),
  reminders: await import("../src/lib/streakReturnNotifications"),
  xp: await import("../src/lib/xp"),
});
let L: Awaited<ReturnType<typeof load>>;
const ids: string[] = [];
before(async () => { if (!skip) L = await load(); });
after(async () => {
  if (skip) return;
  await L.db.user.deleteMany({ where: { id: { in: ids } } });
  await L.db.$disconnect();
});

async function account(data: Partial<Prisma.UserCreateInput> = {}) {
  const user = await L.db.user.create({ data: {
    email: `terug-${randomUUID()}@test.invalid`, passwordHash: "x", handle: `Terug${randomUUID().slice(0,8)}`, discriminator: "00",
    currentStreak: 184, longestStreak: 184, freezeCount: 0, timeZone: "Europe/Amsterdam", lastStudyDate: "2026-01-01", lastStudyTimeZone: "Europe/Amsterdam", ...data,
  } });
  ids.push(user.id);
  return user;
}
const get = (id: string) => L.db.user.findUniqueOrThrow({ where: { id } });
async function activity(id: string, at: string, key: string = randomUUID(), xp = 0, kind: "PRACTICE" | "READING" = "PRACTICE") {
  return L.db.$transaction(async (tx) => {
    const outcome = await L.streak.recordLearningActivity(tx, id, { kind, answered: 3, required: 3, key }, new Date(at));
    if (!outcome.duplicate && xp) await L.xp.awardXp(tx, id, xp, "QUICK_PRACTICE");
    return outcome;
  }, { timeout: 15000 });
}

test("normale dag telt eenmaal; volgende dag telt weer", { skip }, async () => {
  const u = await account();
  assert.equal((await activity(u.id, "2026-01-02T12:00Z")).currentStreak, 185);
  assert.equal((await activity(u.id, "2026-01-02T15:00Z")).dayEarned, false);
  assert.equal((await activity(u.id, "2026-01-03T12:00Z")).currentStreak, 186);
});
test("freeze wordt eerst verbruikt, telt niet als dag en wordt niet teruggegeven", { skip }, async () => {
  const u = await account({ passwordHash: "x", freezeCount: 1 });
  const status = await L.continuation.getStreakContinuation(u.id, new Date("2026-01-03T12:00Z"));
  assert.equal(status.currentStreak, 184);
  assert.equal(status.status, "ACTIVE");
  assert.equal((await get(u.id)).freezeCount, 0);
  await L.continuation.getStreakContinuation(u.id, new Date("2026-01-03T13:00Z"));
  assert.equal(await L.db.freezeTransaction.count({ where: { userId: u.id, type: "AUTO_SPENT" } }), 1);
  assert.equal((await activity(u.id, "2026-01-03T14:00Z")).currentStreak, 185);
});
test("gedeeltelijke freezedekking, onderbreking zonder nulstelling en eerlijke kalender", { skip }, async () => {
  const u = await account({ passwordHash: "x", freezeCount: 1 });
  const view = await L.continuation.getStreakContinuation(u.id, new Date("2026-01-05T12:00Z"));
  assert.equal(view.status, "INTERRUPTED");
  assert.equal(view.interruptedDay, "2026-01-03");
  assert.equal(view.required, 3);
  for (let i = 0; i < 3; i++) await activity(u.id, "2026-01-05T12:00Z");
  assert.equal((await get(u.id)).currentStreak, 185);
  const month = await L.calendar.getStreakMonth(u.id, 2026, 1, "2026-01-05");
  assert.deepEqual(month.days.slice(1,6).map(d => d.state), ["FROZEN", "NONE", "NONE", "RETURNED", "FUTURE"]);
  assert.equal(month.daysStudied, 1);
  assert.equal(month.freezesUsed, 1);
  assert.equal((await get(u.id)).freezeCount, 0);
});
test("37 dagen weg: normale XP bij 4/7, reset bij middernacht, succes precies +1", { skip }, async () => {
  const u = await account();
  for (let i = 0; i < 4; i++) await activity(u.id, "2026-02-08T12:00Z", randomUUID(), 3);
  let saved = await get(u.id);
  assert.equal(saved.currentStreak, 184);
  assert.equal(saved.streakReturnCount, 4);
  assert.equal(saved.streakReturnRequired, 7);
  assert.equal(saved.xpTotal, 12);
  const next = await L.continuation.getStreakContinuation(u.id, new Date("2026-02-08T23:00Z"));
  assert.equal(next.completed, 0);
  assert.equal(next.required, 7);
  for (let i = 0; i < 7; i++) await activity(u.id, "2026-02-09T12:00Z", randomUUID(), 3);
  saved = await get(u.id);
  assert.equal(saved.currentStreak, 185);
  assert.equal(saved.streakInterruptedDay, null);
  assert.equal(saved.xpTotal, 33);
  assert.equal(await L.db.streakDay.count({ where: { userId: u.id } }), 1);
});
test("vereiste aantal groeit na onafgemaakte poging over een drempel", { skip }, async () => {
  const u = await account();
  await activity(u.id, "2026-01-04T12:00Z");
  const next = await L.continuation.getStreakContinuation(u.id, new Date("2026-01-05T12:00Z"));
  assert.equal(next.required, 4);
  assert.equal(next.completed, 0);
});
test("dubbele en gelijktijdige events geven geen dubbele voortgang, XP, freezes of reeksdag", { skip }, async () => {
  const u = await account();
  const results = await Promise.all(Array.from({ length: 4 }, () => activity(u.id, "2026-01-03T12:00Z", "same", 3)));
  assert.equal(results.filter(r => r.duplicate).length, 3);
  assert.equal((await get(u.id)).streakReturnCount, 1);
  assert.equal((await get(u.id)).xpTotal, 3);
  const finished = await Promise.all([activity(u.id, "2026-01-03T12:00Z", "second", 3), activity(u.id, "2026-01-03T12:00Z", "third", 3)]);
  assert.equal(finished.filter(r => r.dayEarned).length, 1);
  assert.equal((await get(u.id)).currentStreak, 185);
  assert.equal((await get(u.id)).xpTotal, 9);
  assert.equal((await activity(u.id, "2026-01-04T12:00Z", "same", 3)).duplicate, true);
  assert.equal((await get(u.id)).currentStreak, 185);
});
test("app openen verdient geen terugkeeractiviteit, een afgeronde leesactiviteit wel; openen stopt herinneringen", { skip }, async () => {
  const u = await account();
  const now = new Date("2026-01-03T12:00Z");
  const status = await L.continuation.getStreakContinuation(u.id, now, true);
  assert.equal(status.completed, 0);
  assert.equal(status.status, "INTERRUPTED");
  assert.ok((await get(u.id)).streakReturnSeenAt);
  assert.equal((await get(u.id)).streakReturnCount, 0, "alleen openen levert niets op");
  await activity(u.id, "2026-01-03T12:00Z", randomUUID(), 0, "READING");
  assert.equal((await get(u.id)).streakReturnCount, 1, "een uitdrukkelijk afgeronde leesstap telt als activiteit");
});
test("jaren weg: behoud reeks en maximaal twaalf activiteiten", { skip }, async () => {
  const u = await account();
  const view = await L.continuation.getStreakContinuation(u.id, new Date("2040-01-01T12:00Z"));
  assert.equal(view.required, 12);
  assert.equal(view.currentStreak, 184);
  assert.equal(await L.db.streakDay.count({ where: { userId: u.id } }), 0);
});
test("bestaande XP-afronding claimt een poging eenmaal en betaalt tijdens onderbreking normaal", { skip }, async () => {
  const now = new Date();
  const day = userDayKey({ timeZone: "Europe/Amsterdam" }, now);
  const u = await account({ passwordHash: "x", lastStudyDate: addDays(day, -3) });
  const outcomes = await Promise.all([L.streak.completeQuickPractice(u.id, 3, 3, "practice:one"), L.streak.completeQuickPractice(u.id, 3, 3, "practice:one")]);
  assert.equal(outcomes.filter(o => o.duplicate).length, 1);
  assert.ok(outcomes.some(o => o.xpEarned > 0));
  assert.equal((await get(u.id)).xpTotal, outcomes.reduce((sum,o) => sum + o.xpEarned, 0));
  assert.equal((await get(u.id)).currentStreak, 184);
});
test("herinneringen respecteren categorie, lokale tijd, terugkomst en dubbele ticks", { skip }, async () => {
  const now = new Date("2026-01-09T12:00Z");
  const base = { passwordHash: "x", streakInterruptedDay: "2026-01-02", pushNotificationsEnabled: true, emailNotificationsEnabled: false, dailyReminderTime: hhmmInZone(now, "Europe/Amsterdam") };
  const off = await account({ ...base, notifyStreakReturn: false });
  const returned = await account({ ...base, notifyStreakReturn: true, streakReturnSeenAt: now });
  const wrongTime = await account({ ...base, notifyStreakReturn: true, dailyReminderTime: "23:59" });
  const on = await account({ ...base, notifyStreakReturn: true });
  // Geen subscriptions of e-mail: de echte verzendlaag doet hier geen extern verzoek.
  await Promise.all([L.reminders.runStreakReturnReminders(now), L.reminders.runStreakReturnReminders(now)]);
  for (const u of [off, returned, wrongTime]) assert.equal((await get(u.id)).streakReminderDay, 0);
  assert.equal((await get(on.id)).streakReminderDay, 7);
  await L.continuation.getStreakContinuation(on.id, now, true);
  await L.reminders.runStreakReturnReminders(new Date("2026-01-16T12:00Z"));
  assert.equal((await get(on.id)).streakReminderDay, 7);
});
test("echte migratie behoudt oude tellers en geschiedenis, zonder ongevraagde herinneringen", { skip }, async () => {
  const schema = `streak_migration_${randomUUID().replaceAll("-", "")}`;
  const migration = await readFile(new URL("../prisma/migrations/20261004090000_streak_continuation/migration.sql", import.meta.url), "utf8");
  const restoreMigration = await readFile(new URL("../prisma/migrations/20261004120000_restore_existing_streaks/migration.sql", import.meta.url), "utf8");
  await L.db.$transaction(async tx => {
    await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
    await tx.$executeRawUnsafe('CREATE TYPE "StreakDayStatus" AS ENUM (\'STUDIED\', \'FROZEN\')');
    await tx.$executeRawUnsafe('CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "timeZone" TEXT, "currentStreak" INTEGER, "longestStreak" INTEGER, "freezeCount" INTEGER, "xpTotal" INTEGER, "lastStudyDate" TEXT)');
    await tx.$executeRawUnsafe('INSERT INTO "User" VALUES (\'old\',\'Europe/Amsterdam\',184,184,5,2508,\'2020-01-01\'), (\'broken\',\'Europe/Amsterdam\',0,184,2,420,\'2020-01-01\'), (\'empty\',NULL,0,0,3,42,NULL)');
    for (const sql of migration.replace(/--[^\n]*/g, "").split(";").filter(s => s.trim())) await tx.$executeRawUnsafe(sql);
    for (const sql of restoreMigration.replace(/--[^\n]*/g, "").split(";").filter(s => s.trim())) await tx.$executeRawUnsafe(sql);
    const rows = await tx.$queryRaw<{ id: string; currentStreak: number; freezeCount: number; xpTotal: number; streakGraceDay: string | null; streakInterruptedDay: string | null; notifyStreakReturn: boolean }[]>`SELECT * FROM "User" ORDER BY "id"`;
    assert.deepEqual(rows.map(r => [r.id,r.currentStreak,r.freezeCount,r.xpTotal,r.streakInterruptedDay,r.notifyStreakReturn]), [["broken",184,2,420,null,false],["empty",0,3,42,null,false],["old",184,5,2508,null,false]]);
    assert.ok(rows[0].streakGraceDay);
    assert.equal(rows[1].streakGraceDay, null);
    assert.ok(rows[2].streakGraceDay);
    await tx.$executeRawUnsafe('UPDATE "User" SET "currentStreak" = 184, "streakInterruptedDay" = \'2026-10-03\', "streakReturnCount" = 2 WHERE "id" = \'broken\'');
    for (const sql of restoreMigration.replace(/--[^\n]*/g, "").split(";").filter(s => s.trim())) await tx.$executeRawUnsafe(sql);
    const cleared = await tx.$queryRaw<{ currentStreak: number; streakInterruptedDay: string | null; streakReturnCount: number }[]>`SELECT "currentStreak", "streakInterruptedDay", "streakReturnCount" FROM "User" WHERE "id" = 'broken'`;
    assert.deepEqual(cleared[0], { currentStreak: 184, streakInterruptedDay: null, streakReturnCount: 0 });
    await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  });
});
