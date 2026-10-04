// Wat de schermen van groepen te zien krijgen. Per scherm een vast, klein
// aantal queries, ook voor een groep van 500 leden (geen query per lid).
// Buitenstaanders zien nooit leden; alleen van een openbare groep de naam,
// het aantal leden, de reeks en de prestaties.

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { dayKeyInZone, resolveTimeZone } from "@/lib/timeZone";
import { GROUP_LIMIT_PER_USER, GROUP_MAX_MEMBERS, GROUP_MIN_MEMBERS, requiredContributors } from "@/lib/social/rules";
import { keptOn, personSelect, type PersonSummary } from "@/lib/social/common";
import { groupDayCounts } from "@/lib/social/groupDays";
import { freezeCooldownUntil } from "@/lib/social/groupFreeze";
import { nudgeAvailability, nudgesDisabled } from "@/lib/social/nudges";
import { visibleJoinRequests } from "@/lib/social/joinLinks";

export interface GroupToday {
  dayKey: string;
  eligible: number;
  contributors: number;
  /** null = gepauzeerd (minder dan 3 leden die meetellen). */
  required: number | null;
  missing: number;
  achieved: boolean;
  /** Gepauzeerd omdat er te weinig leden zijn, of omdat een nieuw lid pas morgen meetelt. */
  paused: "few-members" | "starts-tomorrow" | null;
  protectedBy: PersonSummary | null;
  meContributed: boolean;
}

export interface GroupListItem {
  id: string;
  name: string;
  memberCount: number;
  currentStreak: number;
  streakInterruptedDay: string | null;
  role: "ADMIN" | "MEMBER";
  today: GroupToday;
}

function pausedReason(memberCount: number, eligible: number): GroupToday["paused"] {
  if (eligible >= GROUP_MIN_MEMBERS) return null;
  return memberCount >= GROUP_MIN_MEMBERS ? "starts-tomorrow" : "few-members";
}

/** De groepsdag van vandaag (de eigen kalenderdag van de kijker) voor een rij groepen tegelijk. */
async function todayFor(
  groups: { id: string; memberCount: number }[],
  userId: string,
  dayKey: string
): Promise<Map<string, GroupToday>> {
  const ids = groups.map((g) => g.id);
  const [counts, days, offers, kept] = await Promise.all([
    groupDayCounts(prisma, ids, dayKey),
    prisma.groupDay.findMany({ where: { groupId: { in: ids }, dayKey }, select: { groupId: true, status: true, contributorCount: true } }),
    prisma.groupFreezeOffer.findMany({ where: { groupId: { in: ids }, dayKey, status: { in: ["RESERVED", "CONSUMED"] } }, include: { user: { select: personSelect } } }),
    keptOn(prisma, [userId], dayKey),
  ]);
  const result = new Map<string, GroupToday>();
  for (const group of groups) {
    const c = counts.get(group.id) ?? { eligible: 0, contributors: 0 };
    const day = days.find((d) => d.groupId === group.id);
    const required = requiredContributors(c.eligible);
    const achieved = day?.status === "ACHIEVED" || (required !== null && c.contributors >= required);
    result.set(group.id, {
      dayKey,
      eligible: c.eligible,
      contributors: c.contributors,
      required,
      missing: required === null || achieved ? 0 : Math.max(0, required - c.contributors),
      achieved,
      paused: achieved ? null : pausedReason(group.memberCount, c.eligible),
      protectedBy: achieved ? null : (offers.find((o) => o.groupId === group.id)?.user ?? null),
      meContributed: kept.has(userId),
    });
  }
  return result;
}

function userDay(timeZone: string | null, now: Date): string {
  return dayKeyInZone(now, resolveTimeZone(timeZone));
}

export async function listMyGroups(userId: string, timeZone: string | null, now: Date = new Date()) {
  const memberships = await prisma.groupMembership.findMany({
    where: { userId, leftAt: null },
    include: { group: { select: { id: true, name: true, memberCount: true, currentStreak: true, streakInterruptedDay: true } } },
    orderBy: { joinedAt: "asc" },
  });
  const today = await todayFor(memberships.map((m) => m.group), userId, userDay(timeZone, now));
  const groups: GroupListItem[] = memberships.map((m) => ({ ...m.group, role: m.role, today: today.get(m.groupId)! }));
  const invites = await prisma.groupInvite.findMany({
    where: { inviteeId: userId, status: "PENDING" },
    include: { inviter: { select: personSelect }, group: { select: { id: true, name: true, memberCount: true, currentStreak: true } } },
    orderBy: { createdAt: "desc" },
  });
  return {
    groups,
    invites: invites.map((i) => ({ id: i.id, inviter: i.inviter, group: i.group })),
    limit: GROUP_LIMIT_PER_USER,
  };
}

export interface GroupMemberView {
  person: PersonSummary;
  role: "ADMIN" | "MEMBER";
  isMe: boolean;
  /** Alleen voor vrienden van de kijker: heeft deze vriend vandaag bijgedragen? */
  friend: { contributedToday: boolean; canNudge: boolean; nudgeAvailableAt: string | null } | null;
  /** Nog geen vrienden: kan de kijker een verzoek sturen (of loopt er al een)? */
  friendRequest: "none" | "pending" | null;
  streakPause: { fromDay: string; untilDay: string; status: "scheduled" | "active" | "ended" } | null;
}

/** Het volledige groepsscherm voor een lid. Null = geen lid (zie publicGroup). */
export async function groupDetail(groupId: string, userId: string, timeZone: string | null, now: Date = new Date()) {
  const membership = await prisma.groupMembership.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (!membership || membership.leftAt) return null;
  const group = await prisma.socialGroup.findUnique({ where: { id: groupId } });
  if (!group) return null;
  const dayKey = userDay(timeZone, now);

  const [today, members, achievements, myDays, cooldownUntil, user] = await Promise.all([
    todayFor([group], userId, dayKey).then((m) => m.get(groupId)!),
    prisma.groupMembership.findMany({
      where: { groupId, leftAt: null },
      include: { user: { select: { ...personSelect, timeZone: true } } },
      // ADMIN staat in de enum na MEMBER: aflopend zet beheerders bovenaan.
      orderBy: [{ role: "desc" }, { joinedAt: "asc" }],
    }),
    prisma.groupAchievement.findMany({ where: { groupId }, orderBy: { achievedAt: "asc" }, select: { slug: true, achievedAt: true } }),
    // Eigen bijdrage, eerlijk vanaf de eigen instapdag: alleen afgesloten
    // dagen waarop de reeks liep (gepauzeerde dagen tellen niet).
    prisma.$queryRaw<{ days: number; contributed: number }[]>(Prisma.sql`
      SELECT count(*)::int AS "days", count(s."userId")::int AS "contributed"
      FROM "GroupDay" d
      LEFT JOIN "StreakDay" s ON s."userId" = ${userId} AND s."dayKey" = d."dayKey"
      WHERE d."groupId" = ${groupId} AND d."settledAt" IS NOT NULL AND d."status" <> 'PAUSED'
        AND d."dayKey" >= ${membership.eligibleFromDay}`),
    freezeCooldownUntil(prisma, userId, groupId, now),
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { freezeCount: true } }),
  ]);

  const otherIds = members.map((m) => m.userId).filter((id) => id !== userId);
  const friendships = await prisma.friendship.findMany({
    where: {
      OR: [
        { senderId: userId, receiverId: { in: otherIds } },
        { receiverId: userId, senderId: { in: otherIds } },
      ],
    },
    select: { senderId: true, receiverId: true, status: true },
  });
  const friendIds = new Set<string>();
  const pendingIds = new Set<string>();
  for (const f of friendships) {
    const other = f.senderId === userId ? f.receiverId : f.senderId;
    if (f.status === "ACCEPTED") friendIds.add(other);
    else if (f.status === "PENDING") pendingIds.add(other);
  }
  const friendList = [...friendIds];
  const [friendKept, availability, disabled] = await Promise.all([
    keptOn(prisma, friendList, dayKey),
    nudgeAvailability(prisma, userId, friendList, now),
    nudgesDisabled(prisma, friendList),
  ]);

  const memberViews: GroupMemberView[] = members.map((m) => {
    const isMe = m.userId === userId;
    const isFriend = friendIds.has(m.userId);
    return {
      person: m.user,
      role: m.role,
      isMe,
      friend: isFriend
        ? { contributedToday: friendKept.has(m.userId), canNudge: !disabled.has(m.userId), nudgeAvailableAt: availability.get(m.userId) ?? null }
        : null,
      friendRequest: isMe || isFriend ? null : pendingIds.has(m.userId) ? "pending" : "none",
      streakPause: m.streakPauseFromDay && m.streakPauseUntilDay
        ? { fromDay: m.streakPauseFromDay, untilDay: m.streakPauseUntilDay, status: dayKeyInZone(now, resolveTimeZone(m.user.timeZone)) < m.streakPauseFromDay ? "scheduled" : dayKeyInZone(now, resolveTimeZone(m.user.timeZone)) <= m.streakPauseUntilDay ? "active" : "ended" }
        : null,
    };
  });

  const isAdmin = membership.role === "ADMIN";
  const invites = await prisma.groupInvite.findMany({
    where: { groupId, status: "PENDING", ...(isAdmin ? {} : { inviterId: userId }) },
    include: { invitee: { select: personSelect }, inviter: { select: personSelect } },
    orderBy: { createdAt: "desc" },
  });

  const offerOpen = !today.achieved && today.required !== null && !today.protectedBy && dayKey >= group.nextDay;
  return {
    id: group.id,
    name: group.name,
    memberCount: group.memberCount,
    maxMembers: GROUP_MAX_MEMBERS,
    currentStreak: group.currentStreak,
    longestStreak: group.longestStreak,
    streakInterruptedDay: group.streakInterruptedDay,
    membersCanInvite: group.membersCanInvite,
    membersCanApprove: group.membersCanApprove,
    showOnLeaderboard: group.showOnLeaderboard,
    // De groepslink zien en beheren alleen beheerders.
    joinLink: isAdmin ? { token: group.joinLinkToken } : null,
    // Alleen verzoeken die deze persoon ook mag afhandelen (zie joinLinks.ts).
    joinRequests: await visibleJoinRequests(group.id, userId),
    role: membership.role,
    canInvite: isAdmin || group.membersCanInvite,
    today,
    freeze: {
      canOffer: offerOpen && !cooldownUntil && user.freezeCount > 0,
      reason: !offerOpen ? null : cooldownUntil ? ("cooldown" as const) : user.freezeCount <= 0 ? ("none" as const) : null,
      cooldownUntil: cooldownUntil?.toISOString() ?? null,
      freezeCount: user.freezeCount,
    },
    myContribution: { days: myDays[0]?.days ?? 0, contributed: myDays[0]?.contributed ?? 0, since: membership.eligibleFromDay },
    members: memberViews,
    achievements: achievements.map((a) => ({ slug: a.slug, achievedAt: a.achievedAt.toISOString() })),
    invites: invites.map((i) => ({ id: i.id, invitee: i.invitee, inviter: i.inviter })),
  };
}

export type GroupDetail = NonNullable<Awaited<ReturnType<typeof groupDetail>>>;

/** Wat een buitenstaander van een openbare groep ziet. Een privégroep bestaat voor hem niet. */
export async function publicGroup(groupId: string) {
  const group = await prisma.socialGroup.findFirst({
    where: { id: groupId, showOnLeaderboard: true },
    select: { id: true, name: true, memberCount: true, currentStreak: true, longestStreak: true, streakInterruptedDay: true, achievements: { select: { slug: true, achievedAt: true } } },
  });
  if (!group) return null;
  return { ...group, achievements: group.achievements.map((a) => ({ slug: a.slug, achievedAt: a.achievedAt.toISOString() })) };
}

export type GroupLeaderboardSort = "streak" | "size";

/** Openbare groepsranglijst: alleen groepen die dat zelf aanzetten, nooit leden. Geïndexeerd op (zichtbaar, sorteerveld). */
export async function groupLeaderboard(sort: GroupLeaderboardSort, userId: string, limit = 50) {
  const orderBy: Prisma.SocialGroupOrderByWithRelationInput[] =
    sort === "size" ? [{ memberCount: "desc" }, { currentStreak: "desc" }, { createdAt: "asc" }] : [{ currentStreak: "desc" }, { memberCount: "desc" }, { createdAt: "asc" }];
  const groups = await prisma.socialGroup.findMany({
    where: { showOnLeaderboard: true },
    orderBy,
    take: limit,
    select: { id: true, name: true, memberCount: true, currentStreak: true, _count: { select: { achievements: true } } },
  });
  const mine = await prisma.groupMembership.findMany({ where: { userId, leftAt: null, groupId: { in: groups.map((g) => g.id) } }, select: { groupId: true } });
  const mineIds = new Set(mine.map((m) => m.groupId));
  return groups.map((g, i) => ({
    rank: i + 1,
    id: g.id,
    name: g.name,
    memberCount: g.memberCount,
    currentStreak: g.currentStreak,
    achievementCount: g._count.achievements,
    isMine: mineIds.has(g.id),
  }));
}

/** Vrienden die je voor deze groep kunt uitnodigen (nog geen lid, nog niet uitgenodigd). */
export async function invitableFriends(groupId: string, userId: string) {
  const friendships = await prisma.friendship.findMany({
    where: { status: "ACCEPTED", OR: [{ senderId: userId }, { receiverId: userId }] },
    include: { sender: { select: personSelect }, receiver: { select: personSelect } },
  });
  const friends = friendships.map((f) => (f.senderId === userId ? f.receiver : f.sender));
  const ids = friends.map((f) => f.id);
  const [members, invites] = await Promise.all([
    prisma.groupMembership.findMany({ where: { groupId, userId: { in: ids } }, select: { userId: true, leftAt: true, rejoinAfter: true } }),
    prisma.groupInvite.findMany({ where: { groupId, inviteeId: { in: ids }, status: "PENDING" }, select: { inviteeId: true } }),
  ]);
  const now = new Date();
  const blocked = new Set(members.filter((m) => !m.leftAt || (m.rejoinAfter && m.rejoinAfter > now)).map((m) => m.userId));
  const invited = new Set(invites.map((i) => i.inviteeId));
  return friends
    .filter((f) => !blocked.has(f.id))
    .map((f) => ({ person: f, invited: invited.has(f.id) }))
    .sort((a, b) => a.person.handle.localeCompare(b.person.handle));
}
