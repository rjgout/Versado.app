// De groepsreeks: elke dag moet een deel van de leden (zie
// requiredContributors) de persoonlijke reeks behouden. Tolerant en
// gezamenlijk: niemand hoeft, genoeg mensen samen wel. Zie docs/SAMEN.md.
//
// Twee stappen, allebei idempotent en veilig om vaak aan te roepen:
// - live: een open dag die genoeg bijdragen heeft, is meteen gehaald (en een
//   gehaalde dag wordt nooit meer ongedaan gemaakt);
// - afsluiten: zodra de oudste open dag voor alle meetellende leden
//   definitief is, wordt hij gehaald, beschermd, gepauzeerd of gemist.
// Elk lid telt op zijn eigen kalenderdag; tijdzones worden bewust niet
// gecompenseerd.

import { prisma } from "@/lib/db";
import { addDays } from "@/lib/dates";
import { dayKeyInZone, resolveTimeZone } from "@/lib/timeZone";
import { notifyGroupFreezeNotNeeded, notifyGroupFreezeUsed, notifyGroupMemberPauseEnded, notifyGroupMembersInApp } from "@/lib/notify";
import { GROUP_STREAK_MILESTONES, dayEndsForAll, latestDayKey, requiredContributors, resolveSocialDay } from "@/lib/social/rules";
import { memberDayStates, recordSocialEvent, type Tx } from "@/lib/social/common";
import { eligibleMemberIds, groupDayCounts } from "@/lib/social/groupDays";
import { consumeOfferTx, returnOfferTx } from "@/lib/social/groupFreeze";
import { endGroupStreakPausesForActivity } from "@/lib/social/groups";

export const GROUP_ACHIEVEMENTS = ["first-day", "streak-7", "streak-30", "streak-100", "streak-365", "perfect-day", "perfect-week", "rescued"] as const;
export type GroupAchievementSlug = (typeof GROUP_ACHIEVEMENTS)[number];

interface GroupState {
  id: string;
  name: string;
  currentStreak: number;
  longestStreak: number;
  streakStartDay: string | null;
  lastAchievedDay: string | null;
  streakInterruptedDay: string | null;
  nextDay: string;
  nextCheckAt: Date;
  paused: boolean;
}

interface Effects {
  released: { userId: string }[];
  rescued: { userId: string; streak: number }[];
  interrupted: { streak: number }[];
  continued: { streak: number }[];
  pauseEnded: { userId: string }[];
}

async function awardGroupAchievement(tx: Tx, groupId: string, slug: GroupAchievementSlug, dayKey: string): Promise<void> {
  const created = await tx.groupAchievement.createMany({ data: [{ groupId, slug, dayKey }], skipDuplicates: true });
  if (created.count > 0) await recordSocialEvent(tx, { kind: "GROUP_ACHIEVEMENT", groupId, dayKey, data: { slug } });
}

/** Tijdzones van de leden: wanneer is een dag voor iedereen voorbij? */
async function memberZones(tx: Tx, groupId: string, dayKey: string): Promise<(string | null)[]> {
  const rows = await tx.$queryRaw<{ timeZone: string | null; lastStudyTimeZone: string | null }[]>`
    SELECT DISTINCT u."timeZone", u."lastStudyTimeZone"
    FROM "GroupMembership" m JOIN "User" u ON u."id" = m."userId"
    WHERE m."groupId" = ${groupId} AND m."leftAt" IS NULL AND m."eligibleFromDay" <= ${dayKey}
      AND (m."streakPauseFromDay" IS NULL OR ${dayKey} < m."streakPauseFromDay"
        OR m."streakPauseUntilDay" IS NULL OR ${dayKey} > m."streakPauseUntilDay")`;
  return rows.flatMap((r) => [r.timeZone, r.lastStudyTimeZone]);
}

/** Legt het normale einde van een verlopen pauze één keer vast. */
async function settleExpiredPauses(tx: Tx, groupId: string, now: Date, effects: Effects): Promise<void> {
  const rows = await tx.groupMembership.findMany({
    where: { groupId, leftAt: null, streakPauseFromDay: { not: null }, streakPauseUntilDay: { not: null } },
    include: { user: { select: { timeZone: true } } },
  });
  for (const row of rows) {
    const day = dayKeyInZone(now, resolveTimeZone(row.user.timeZone));
    if (day <= row.streakPauseUntilDay! || row.lastStreakPauseEndedDay) continue;
    await tx.groupMembership.update({ where: { id: row.id }, data: { lastStreakPauseEndedDay: row.streakPauseUntilDay } });
    await recordSocialEvent(tx, { kind: "GROUP_MEMBER_PAUSE_ENDED", groupId, userId: row.userId, dayKey: row.streakPauseUntilDay, data: { reason: "expired" } });
    effects.pauseEnded.push({ userId: row.userId });
  }
}

async function achieveDay(tx: Tx, state: GroupState, dayKey: string, counts: { eligible: number; contributors: number; required: number }, now: Date, effects: Effects): Promise<boolean> {
  const wasInterrupted = state.streakInterruptedDay !== null;
  const data = {
    status: "ACHIEVED" as const,
    eligibleCount: counts.eligible,
    requiredCount: counts.required,
    contributorCount: counts.contributors,
    achievedAt: now,
    streakAfter: state.currentStreak + 1,
  };
  // Alleen een open (of nog niet bestaande) dag: twee gelijktijdige
  // aanroepen kunnen dezelfde dag nooit twee keer laten meetellen.
  const created = await tx.groupDay.createMany({ data: [{ groupId: state.id, dayKey, ...data }], skipDuplicates: true });
  if (created.count === 0) {
    const updated = await tx.groupDay.updateMany({ where: { groupId: state.id, dayKey, status: "OPEN" }, data });
    if (updated.count === 0) return false;
  }
  if (state.currentStreak === 0) {
    state.streakStartDay = dayKey;
    await recordSocialEvent(tx, { kind: "GROUP_STREAK_STARTED", groupId: state.id, dayKey });
  }
  state.currentStreak += 1;
  state.longestStreak = Math.max(state.longestStreak, state.currentStreak);
  if (!state.lastAchievedDay || dayKey > state.lastAchievedDay) state.lastAchievedDay = dayKey;
  await recordSocialEvent(tx, { kind: "GROUP_DAY_ACHIEVED", groupId: state.id, dayKey, data: { streak: state.currentStreak, contributors: counts.contributors, required: counts.required } });
  await awardGroupAchievement(tx, state.id, "first-day", dayKey);
  if ((GROUP_STREAK_MILESTONES as readonly number[]).includes(state.currentStreak)) {
    await recordSocialEvent(tx, { kind: "GROUP_MILESTONE", groupId: state.id, dayKey, data: { streak: state.currentStreak } });
    await awardGroupAchievement(tx, state.id, `streak-${state.currentStreak}` as GroupAchievementSlug, dayKey);
  }
  if (wasInterrupted) {
    state.streakInterruptedDay = null;
    effects.continued.push({ streak: state.currentStreak });
    await recordSocialEvent(tx, { kind: "GROUP_STREAK_CONTINUED", groupId: state.id, dayKey, data: { streak: state.currentStreak } });
  }
  // Een aangeboden bevriezing is nu niet meer nodig: direct terug.
  const offer = await tx.groupFreezeOffer.findUnique({ where: { groupId_dayKey: { groupId: state.id, dayKey } } });
  if (offer?.status === "RESERVED") {
    const returned = await returnOfferTx(tx, offer.id, "RELEASED", now);
    if (returned) effects.released.push({ userId: returned.userId });
  }
  return true;
}

/** Zeven afgesloten, aaneengesloten dagen waarop iedereen bijdroeg. */
async function isPerfectWeek(tx: Tx, groupId: string, dayKey: string): Promise<boolean> {
  const days = await tx.groupDay.findMany({
    where: { groupId, dayKey: { lte: dayKey, gte: addDays(dayKey, -6) }, perfect: true },
    select: { dayKey: true },
  });
  return days.length === 7;
}

/** true = afgesloten; anders het moment waarop het opnieuw zin heeft om te kijken. */
async function settleDay(tx: Tx, state: GroupState, dayKey: string, now: Date, effects: Effects): Promise<true | Date> {
  const members = await eligibleMemberIds(tx, state.id, dayKey);
  const states = await memberDayStates(tx, members, dayKey, now);
  const pending = [...states.entries()].filter(([, s]) => s === "pending").map(([id]) => id);
  if (pending.length > 0) {
    // Alleen de leden die nog bezig zijn bepalen wanneer het weer zin heeft
    // (bv. iemand die net van tijdzone wisselde). Is hun dag al voorbij, dan
    // wacht het alleen nog op de eigen reeksafsluiting: over een minuut.
    const zones = await tx.user.findMany({ where: { id: { in: pending } }, select: { timeZone: true, lastStudyTimeZone: true } });
    const endsAt = dayEndsForAll(dayKey, zones.flatMap((z) => [z.timeZone, z.lastStudyTimeZone]));
    return endsAt > now ? endsAt : new Date(now.getTime() + 60_000);
  }

  const eligible = members.length;
  const contributors = [...states.values()].filter((s) => s === "kept").length;
  const required = requiredContributors(eligible);
  const existing = await tx.groupDay.findUnique({ where: { groupId_dayKey: { groupId: state.id, dayKey } } });
  const offer = await tx.groupFreezeOffer.findUnique({ where: { groupId_dayKey: { groupId: state.id, dayKey } } });
  const reserved = offer?.status === "RESERVED" ? offer : null;

  let status = existing?.status ?? "OPEN";
  if (status === "OPEN") {
    const outcome = resolveSocialDay({ eligible, contributors, required, settled: true, freezeReserved: !!reserved });
    if (outcome === "achieved") {
      await achieveDay(tx, state, dayKey, { eligible, contributors, required: required! }, now, effects);
      status = "ACHIEVED";
    } else if (outcome === "protected" && reserved) {
      const donor = await consumeOfferTx(tx, reserved.id, now);
      status = "PROTECTED";
      if (donor) {
        effects.rescued.push({ userId: donor, streak: state.currentStreak });
        await recordSocialEvent(tx, { kind: "FREEZE_USED", groupId: state.id, userId: donor, dayKey, data: { streak: state.currentStreak, contributors, required } });
        await awardGroupAchievement(tx, state.id, "rescued", dayKey);
      }
    } else if (outcome === "paused") {
      status = "PAUSED";
      if (reserved) {
        const returned = await returnOfferTx(tx, reserved.id, "RELEASED", now);
        if (returned) effects.released.push({ userId: returned.userId });
      }
    } else {
      status = "MISSED";
      if (state.currentStreak > 0 && !state.streakInterruptedDay) {
        state.streakInterruptedDay = dayKey;
        effects.interrupted.push({ streak: state.currentStreak });
        await recordSocialEvent(tx, { kind: "GROUP_STREAK_INTERRUPTED", groupId: state.id, dayKey, data: { streak: state.currentStreak, contributors, required } });
      }
    }
  }

  const perfect = status === "ACHIEVED" && eligible > 0 && contributors === eligible;
  await tx.groupDay.upsert({
    where: { groupId_dayKey: { groupId: state.id, dayKey } },
    create: { groupId: state.id, dayKey, status, eligibleCount: eligible, requiredCount: required, contributorCount: contributors, perfect, streakAfter: state.currentStreak, settledAt: now },
    update: { status, eligibleCount: eligible, requiredCount: required, contributorCount: contributors, perfect, settledAt: now, ...(status === "ACHIEVED" ? {} : { streakAfter: state.currentStreak }) },
  });
  if (perfect) {
    await recordSocialEvent(tx, { kind: "GROUP_PERFECT_DAY", groupId: state.id, dayKey, data: { contributors } });
    await awardGroupAchievement(tx, state.id, "perfect-day", dayKey);
    if (await isPerfectWeek(tx, state.id, dayKey)) await awardGroupAchievement(tx, state.id, "perfect-week", dayKey);
  }

  const paused = required === null;
  if (paused && !state.paused && state.currentStreak > 0) await recordSocialEvent(tx, { kind: "GROUP_PAUSED", groupId: state.id, dayKey, data: { streak: state.currentStreak } });
  if (!paused && state.paused && state.currentStreak > 0) await recordSocialEvent(tx, { kind: "GROUP_RESUMED", groupId: state.id, dayKey, data: { streak: state.currentStreak } });
  state.paused = paused;
  return true;
}

/**
 * Werkt één groep bij. Bezet (een andere aanroep of een lidmaatschaps-
 * wijziging is bezig)? Dan slaat hij over; de volgende aanroep pakt het op.
 */
export async function refreshGroup(groupId: string, now: Date = new Date()): Promise<void> {
  const result = await prisma.$transaction(
    async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "SocialGroup" WHERE "id" = ${groupId} FOR UPDATE SKIP LOCKED`;
      if (locked.length === 0) return null;
      const group = await tx.socialGroup.findUniqueOrThrow({ where: { id: groupId } });
      const state: GroupState = { ...group };
      const effects: Effects = { released: [], rescued: [], interrupted: [], continued: [], pauseEnded: [] };
      const horizon = latestDayKey(now);
      await settleExpiredPauses(tx, groupId, now, effects);

      // Afsluiten: de oudste open dag(en), zodra ze voor iedereen voorbij zijn.
      while (state.nextDay < horizon && now >= state.nextCheckAt) {
        const settled = await settleDay(tx, state, state.nextDay, now, effects);
        if (settled !== true) {
          state.nextCheckAt = settled;
          break;
        }
        state.nextDay = addDays(state.nextDay, 1);
        state.nextCheckAt = dayEndsForAll(state.nextDay, await memberZones(tx, groupId, state.nextDay));
      }

      // Live: open dagen die al genoeg bijdragen hebben.
      for (let day = state.nextDay; day <= horizon; day = addDays(day, 1)) {
        const counts = (await groupDayCounts(tx, [groupId], day)).get(groupId);
        const required = counts ? requiredContributors(counts.eligible) : null;
        if (!counts || required === null || counts.contributors < required) continue;
        await achieveDay(tx, state, day, { ...counts, required }, now, effects);
      }

      await tx.socialGroup.update({
        where: { id: groupId },
        data: {
          currentStreak: state.currentStreak,
          longestStreak: state.longestStreak,
          streakStartDay: state.streakStartDay,
          lastAchievedDay: state.lastAchievedDay,
          streakInterruptedDay: state.streakInterruptedDay,
          nextDay: state.nextDay,
          nextCheckAt: state.nextCheckAt,
          paused: state.paused,
        },
      });
      return { effects, name: state.name };
    },
    { timeout: 30_000 }
  );
  if (!result) return;

  // Meldingen pas na de commit (zie giftFreeze in streak.ts).
  for (const { userId } of result.effects.released) notifyGroupFreezeNotNeeded(userId, groupId, result.name).catch(() => {});
  for (const rescue of result.effects.rescued) {
    notifyGroupFreezeUsed(rescue.userId, groupId, result.name).catch(() => {});
    const [donor, members] = await Promise.all([
      prisma.user.findUnique({ where: { id: rescue.userId }, select: { handle: true } }),
      prisma.groupMembership.findMany({ where: { groupId, leftAt: null, userId: { not: rescue.userId } }, select: { userId: true } }),
    ]);
    notifyGroupMembersInApp(
      members.map((m) => m.userId),
      `/groups/${groupId}`,
      (t) => ({
        title: t("together.notify.groupRescuedTitle", { name: donor?.handle ?? "" }),
        body: rescue.streak === 1 ? t("together.notify.groupRescuedTextOne", { group: result.name }) : t("together.notify.groupRescuedText", { n: rescue.streak, group: result.name }),
      })
    ).catch(() => {});
  }
  if (result.effects.interrupted.length > 0 || result.effects.continued.length > 0) {
    const members = await prisma.groupMembership.findMany({ where: { groupId, leftAt: null }, select: { userId: true } });
    for (const interruption of result.effects.interrupted) {
      notifyGroupMembersInApp(members.map((m) => m.userId), `/groups/${groupId}`, (t) => ({
        title: t("together.notify.groupStreakInterruptedTitle"),
        body: t("together.notify.groupStreakInterruptedText", { group: result.name, n: interruption.streak }),
      })).catch(() => {});
    }
    for (const continuation of result.effects.continued) {
      notifyGroupMembersInApp(members.map((m) => m.userId), `/groups/${groupId}`, (t) => ({
        title: t("together.notify.groupStreakContinuedTitle"),
        body: t("together.notify.groupStreakContinuedText", { group: result.name, n: continuation.streak }),
      })).catch(() => {});
    }
  }
  for (const pause of result.effects.pauseEnded) notifyGroupMemberPauseEnded(pause.userId, groupId, result.name).catch(() => {});
}

/** Groepen van deze gebruikers bijwerken (na nieuwe persoonlijke reeksdagen). */
export async function refreshGroupsFor(userIds: string[], now: Date = new Date(), studiedUserIds: string[] = []): Promise<void> {
  if (userIds.length === 0) return;
  await endGroupStreakPausesForActivity(studiedUserIds, now);
  const groups = await prisma.groupMembership.findMany({ where: { userId: { in: userIds }, leftAt: null }, select: { groupId: true }, distinct: ["groupId"] });
  for (const g of groups) await refreshGroup(g.groupId, now).catch((e) => console.error(`Groep ${g.groupId}:`, e));
}

/** Groepen waarvan de oudste open dag nu definitief kan zijn. */
export async function refreshDueGroups(now: Date = new Date()): Promise<void> {
  const due = await prisma.socialGroup.findMany({ where: { nextCheckAt: { lte: now } }, select: { id: true } });
  for (const g of due) await refreshGroup(g.id, now).catch((e) => console.error(`Groep ${g.id}:`, e));
}
