import { prisma } from "@/lib/db";
import { dayKeyInZone, resolveTimeZone } from "@/lib/timeZone";
import { listFriendStreaks } from "@/lib/social/friendStreaks";
import { refreshFriendStreaksFor } from "@/lib/social/friendStreaks";
import { refreshGroupsFor } from "@/lib/social/groupStreak";
import { groupDayCounts } from "@/lib/social/groupDays";
import { keptOn, personSelect, type PersonSummary } from "@/lib/social/common";
import { nudgeAvailability, nudgesDisabled } from "@/lib/social/nudges";
import { requiredContributors } from "@/lib/social/rules";

export interface StreakCelebrationClaim {
  show: boolean;
  streak: number | null;
  dayKey: string | null;
}

export interface CelebrationFriend {
  person: PersonSummary;
  currentStreak: number;
  completedToday: boolean;
  nudgeAvailableAt: string | null;
  nudgesDisabled: boolean;
}

export interface CelebrationGroupMember {
  person: PersonSummary;
  completedToday: boolean;
  friend: boolean;
  canNudge: boolean;
  nudgeAvailableAt: string | null;
}

export interface CelebrationGroup {
  id: string;
  name: string;
  currentStreak: number;
  interrupted: boolean;
  today: { eligible: number; contributors: number; required: number | null; achieved: boolean };
  members: CelebrationGroupMember[];
}

/**
 * Claimt de viering op de dagrij zelf. De migratie markeert oude rijen als
 * bekeken, zodat deze UX nooit met terugwerkende kracht op bestaande dagen
 * verschijnt. updateMany maakt gelijktijdige tabs/apparaten idempotent.
 */
export async function claimStreakCelebration(userId: string, now = new Date()): Promise<StreakCelebrationClaim> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true, currentStreak: true } });
    const dayKey = dayKeyInZone(now, resolveTimeZone(user.timeZone));
    const claimed = await tx.streakDay.updateMany({
      where: { userId, dayKey, status: { in: ["STUDIED", "RETURNED"] }, celebrationShownAt: null },
      data: { celebrationShownAt: now },
    });
    return claimed.count > 0
      ? { show: true, streak: user.currentStreak, dayKey }
      : { show: false, streak: null, dayKey };
  });
}

function sortPendingFirst<T extends { completedToday: boolean }>(a: T, b: T): number {
  return Number(a.completedToday) - Number(b.completedToday);
}

/**
 * Leest alleen de sociale stand die de viering nodig heeft. De bestaande
 * refreshes blijven de bron van waarheid voor vriend- en groepsreeksen; de
 * query erna is gebundeld en kent geen query per deelnemer.
 */
export async function getStreakCelebrationSocial(userId: string, now = new Date()) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  await refreshFriendStreaksFor([userId], now);
  await refreshGroupsFor([userId], now, [userId]);

  const dayKey = dayKeyInZone(now, resolveTimeZone(user.timeZone));
  const friendData = await listFriendStreaks(userId, user.timeZone, now);
  const activeFriendStreaks = friendData.streaks.filter((streak) => streak.status === "ACTIVE");
  const friendIds = activeFriendStreaks.map((streak) => streak.friend.id);
  const [availableNudges, disabledNudges] = await Promise.all([
    nudgeAvailability(prisma, userId, friendIds, now),
    nudgesDisabled(prisma, friendIds),
  ]);
  const friends: CelebrationFriend[] = activeFriendStreaks
    .map((streak) => ({
      person: streak.friend,
      currentStreak: streak.currentStreak,
      completedToday: !!streak.today?.friend,
      nudgeAvailableAt: availableNudges.get(streak.friend.id) ?? null,
      nudgesDisabled: disabledNudges.has(streak.friend.id),
    }))
    .sort((a, b) => sortPendingFirst(a, b) || a.person.handle.localeCompare(b.person.handle));

  const memberships = await prisma.groupMembership.findMany({
    where: { userId, leftAt: null },
    select: {
      groupId: true,
      group: { select: { id: true, name: true, currentStreak: true, streakInterruptedDay: true, paused: true } },
    },
    orderBy: { joinedAt: "asc" },
  });
  // Een groep die volgens de bestaande groepsregels gepauzeerd is, hoort
  // niet als volgende vieringsstap tussen actieve reeksen te verschijnen.
  const activeMemberships = memberships.filter((membership) => !membership.group.paused);
  const groupIds = activeMemberships.map((membership) => membership.groupId);
  if (groupIds.length === 0) return { friends, groups: [] as CelebrationGroup[] };

  const memberRows = await prisma.groupMembership.findMany({
    where: { groupId: { in: groupIds }, leftAt: null },
    select: {
      groupId: true,
      userId: true,
      eligibleFromDay: true,
      streakPauseFromDay: true,
      streakPauseUntilDay: true,
      user: { select: { ...personSelect } },
    },
    orderBy: { joinedAt: "asc" },
  });
  const otherMemberIds = memberRows.map((row) => row.userId).filter((id) => id !== userId);
  const friendships = otherMemberIds.length > 0
    ? await prisma.friendship.findMany({
      where: {
        status: "ACCEPTED",
        OR: [
          { senderId: userId, receiverId: { in: otherMemberIds } },
          { receiverId: userId, senderId: { in: otherMemberIds } },
        ],
      },
      select: { senderId: true, receiverId: true },
    })
    : [];
  const groupFriendIds = new Set(friendships.map((friendship) => friendship.senderId === userId ? friendship.receiverId : friendship.senderId));
  const allGroupMemberIds = [...new Set(memberRows.map((row) => row.userId))];
  const [kept, groupCounts, groupDays, groupNudgeAvailability, groupNudgesDisabled] = await Promise.all([
    keptOn(prisma, allGroupMemberIds, dayKey),
    groupDayCounts(prisma, groupIds, dayKey),
    prisma.groupDay.findMany({ where: { groupId: { in: groupIds }, dayKey }, select: { groupId: true, status: true } }),
    nudgeAvailability(prisma, userId, [...groupFriendIds], now),
    nudgesDisabled(prisma, [...groupFriendIds]),
  ]);

  const groups = activeMemberships.map((membership): CelebrationGroup => {
    const counts = groupCounts.get(membership.groupId) ?? { eligible: 0, contributors: 0 };
    const required = requiredContributors(counts.eligible);
    const day = groupDays.find((candidate) => candidate.groupId === membership.groupId);
    const achieved = day?.status === "ACHIEVED" || (required !== null && counts.contributors >= required);
    const members = memberRows
      .filter((row) => row.groupId === membership.groupId && row.userId !== userId)
      .filter((row) => row.eligibleFromDay <= dayKey && !(row.streakPauseFromDay && row.streakPauseUntilDay && dayKey >= row.streakPauseFromDay && dayKey <= row.streakPauseUntilDay))
      .map((row) => {
        const completedToday = kept.has(row.userId);
        const isFriend = groupFriendIds.has(row.userId);
        return {
          person: row.user,
          completedToday,
          friend: isFriend,
          canNudge: isFriend && !completedToday && !groupNudgesDisabled.has(row.userId),
          nudgeAvailableAt: isFriend ? groupNudgeAvailability.get(row.userId) ?? null : null,
        };
      })
      .sort((a, b) => Number(b.friend && !b.completedToday) - Number(a.friend && !a.completedToday) || sortPendingFirst(a, b) || a.person.handle.localeCompare(b.person.handle));
    return {
      id: membership.group.id,
      name: membership.group.name,
      currentStreak: membership.group.currentStreak,
      interrupted: membership.group.streakInterruptedDay !== null,
      today: { eligible: counts.eligible, contributors: counts.contributors, required, achieved },
      members,
    };
  });

  return { friends, groups };
}
