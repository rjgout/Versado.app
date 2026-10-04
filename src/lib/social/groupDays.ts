// Tellingen voor een groepsdag, rechtstreeks uit de lidmaatschappen en de
// persoonlijke reeksdagen: één query voor één of veel groepen, hoe groot
// ook (geen query per lid).

import { Prisma } from "@/generated/prisma/client";
import type { Db } from "@/lib/social/common";

export interface GroupDayCounts {
  /** Leden die op deze dag meetellen (lid, en ingestapt vóór deze dag). */
  eligible: number;
  /** Daarvan: wie de persoonlijke reeks die dag behield. */
  contributors: number;
}

export async function groupDayCounts(db: Db, groupIds: string[], dayKey: string): Promise<Map<string, GroupDayCounts>> {
  const result = new Map<string, GroupDayCounts>();
  if (groupIds.length === 0) return result;
  const rows = await db.$queryRaw<{ groupId: string; eligible: bigint; contributors: bigint }[]>(Prisma.sql`
    SELECT m."groupId",
           count(*) AS "eligible",
           count(s."userId") AS "contributors"
    FROM "GroupMembership" m
    LEFT JOIN "StreakDay" s ON s."userId" = m."userId" AND s."dayKey" = ${dayKey}
    WHERE m."groupId" = ANY(${groupIds}::text[]) AND m."leftAt" IS NULL AND m."eligibleFromDay" <= ${dayKey}
      AND (m."streakPauseFromDay" IS NULL OR ${dayKey} < m."streakPauseFromDay"
        OR m."streakPauseUntilDay" IS NULL OR ${dayKey} > m."streakPauseUntilDay")
    GROUP BY m."groupId"
  `);
  for (const row of rows) result.set(row.groupId, { eligible: Number(row.eligible), contributors: Number(row.contributors) });
  return result;
}

/** De leden die op deze dag meetellen (voor het definitief afsluiten van een dag). */
export async function eligibleMemberIds(db: Db, groupId: string, dayKey: string): Promise<string[]> {
  const rows = await db.groupMembership.findMany({
    where: {
      groupId,
      leftAt: null,
      eligibleFromDay: { lte: dayKey },
      OR: [
        { streakPauseFromDay: null },
        { streakPauseFromDay: { gt: dayKey } },
        { streakPauseUntilDay: null },
        { streakPauseUntilDay: { lt: dayKey } },
      ],
    },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}
