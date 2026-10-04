import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "../src/generated/prisma/client";

const url = process.env.LEARNING_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const skip = !url && "LEARNING_TEST_DATABASE_URL niet gezet";

const load = async () => ({
  db: (await import("../src/lib/db")).prisma,
  celebration: await import("../src/lib/streakCelebration"),
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
    email: `viering-${randomUUID()}@test.invalid`,
    passwordHash: "x",
    handle: `Viering${randomUUID().slice(0, 8)}`,
    discriminator: "00",
    currentStreak: 184,
    longestStreak: 184,
    timeZone: "Europe/Amsterdam",
    ...data,
  } });
  ids.push(user.id);
  return user;
}

test("reeksviering claimt een geldige dag eenmaal, ook bij gelijktijdige claims", { skip }, async () => {
  const user = await account();
  const now = new Date("2026-10-04T12:00:00Z");
  await L.db.streakDay.create({ data: { userId: user.id, dayKey: "2026-10-04", status: "STUDIED" } });

  const claims = await Promise.all([
    L.celebration.claimStreakCelebration(user.id, now),
    L.celebration.claimStreakCelebration(user.id, now),
  ]);

  assert.equal(claims.filter((claim) => claim.show).length, 1);
  assert.equal(claims.filter((claim) => !claim.show).length, 1);
  const saved = await L.db.streakDay.findUniqueOrThrow({ where: { userId_dayKey: { userId: user.id, dayKey: "2026-10-04" } } });
  assert.ok(saved.celebrationShownAt);
});

test("reeksviering verschijnt niet voor een bevroren dag", { skip }, async () => {
  const user = await account();
  const now = new Date("2026-10-04T12:00:00Z");
  await L.db.streakDay.create({ data: { userId: user.id, dayKey: "2026-10-04", status: "FROZEN" } });

  const claim = await L.celebration.claimStreakCelebration(user.id, now);

  assert.deepEqual(claim, { show: false, streak: null, dayKey: "2026-10-04" });
});
