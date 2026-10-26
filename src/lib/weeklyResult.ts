import { prisma } from "@/lib/db";
import { addDays, weekStartKey } from "@/lib/dates";
import { tierForWeek } from "@/lib/leagues";
import { TIER_ORDER } from "@/lib/leagueTiers";
import type { LeagueTier } from "@/generated/prisma/enums";

export interface WeeklyResult {
  weekStart: string;
  tier: LeagueTier;
  outcome: "promoted" | "demoted" | "stayed";
}

/** Dezelfde uitslag als de push, zonder deelname of groepen voor de nieuwe week aan te maken. */
export async function getWeeklyResult(userId: string, now = new Date()): Promise<WeeklyResult | null> {
  const currentWeek = weekStartKey(now);
  return prisma.$transaction(async tx => {
    const score = await tx.weeklyScore.findFirst({ where: { userId, weekStart: { lt: currentWeek } }, orderBy: { weekStart: "desc" } });
    if (!score || score.resultSeenAt) return null;
    const tier = await tierForWeek(tx, userId, addDays(score.weekStart, 7));
    const movement = TIER_ORDER.indexOf(tier) - TIER_ORDER.indexOf(score.tier);
    return { weekStart: score.weekStart, tier, outcome: movement > 0 ? "promoted" : movement < 0 ? "demoted" : "stayed" };
  });
}

/** Pas sluiten markeert bekeken: een netwerkfout of gesloten app verliest de uitslag niet. */
export async function acknowledgeWeeklyResult(userId: string, weekStart: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || weekStart >= weekStartKey(now)) return;
  await prisma.weeklyScore.updateMany({ where: { userId, weekStart, resultSeenAt: null }, data: { resultSeenAt: now } });
}
