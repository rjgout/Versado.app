import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { userTimeZone } from "@/lib/timeZone";
import { continuationView, missedDayPlan } from "@/lib/learning/streakReturnRules";

/** Dezelfde rijvergrendeling voor scheduler, activiteiten en uitlezen. */
export async function settleStreakDays(tx: Prisma.TransactionClient, userId: string, now: Date) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  let user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const plan = missedDayPlan(user, now);
  if (plan.freezes > 0) {
    await tx.streakDay.createMany({
      data: plan.frozenDays.map((dayKey) => ({ userId, dayKey, status: "FROZEN" as const })),
      skipDuplicates: true,
    });
    await tx.freezeTransaction.create({ data: {
      userId, type: "AUTO_SPENT", amount: -plan.freezes,
      reason: `Reeks beschermd: ${plan.frozenDays[0]} t/m ${plan.frozenDays.at(-1)}`,
    } });
  }
  if (plan.freezes > 0 || plan.interruptedDay) {
    user = await tx.user.update({ where: { id: userId }, data: {
      freezeCount: { decrement: plan.freezes },
      ...(plan.freezes > 0 ? {
        lastStudyDate: plan.frozenDays.at(-1),
        // Een uitrolanker ligt in de huidige tijdzone; anders blijft de oude zone leidend.
        lastStudyTimeZone: user.streakGraceDay && (!user.lastStudyDate || user.streakGraceDay > user.lastStudyDate)
          ? userTimeZone(user) : user.lastStudyTimeZone,
      } : {}),
      ...(plan.interruptedDay ? {
        streakInterruptedDay: plan.interruptedDay,
        streakReturnDay: null, streakReturnTimeZone: null, streakReturnCount: 0,
        streakReturnRequired: 0, streakReturnSeenAt: null, streakReminderDay: 0,
      } : {}),
    } });
  }
  return { user, freezesUsed: plan.freezes };
}

export async function getStreakContinuation(userId: string, now = new Date(), returned = false) {
  return prisma.$transaction(async (tx) => {
    const { user } = await settleStreakDays(tx, userId, now);
    if (returned && user.streakInterruptedDay && !user.streakReturnSeenAt) {
      await tx.user.update({ where: { id: userId }, data: { streakReturnSeenAt: now } });
    }
    return continuationView(user, now);
  });
}
