// Groepen: aanmaken, uitnodigen, toetreden, vertrekken, beheerders en
// instellingen. Een groep heeft bewust geen type: mensen bepalen zelf
// waarvoor ze hem gebruiken. Alle limieten worden binnen één transactie met
// rijvergrendeling gecontroleerd (eerst gebruikers, dan de groep), zodat
// gelijktijdige acties de grenzen nooit overschrijden. Zie docs/SAMEN.md.

import { prisma } from "@/lib/db";
import { addDays, daysBetween } from "@/lib/dates";
import { dayKeyInZone, resolveTimeZone } from "@/lib/timeZone";
import { notifyGroupAdminAssigned, notifyGroupInvite, notifyGroupMemberPauseEnded, notifyGroupMemberPaused } from "@/lib/notify";
import {
  ADMIN_INACTIVE_DAYS,
  GROUP_LIMIT_PER_USER,
  GROUP_MAX_MEMBERS,
  GROUP_NAME_MAX_LENGTH,
  GROUP_REJOIN_COOLDOWN_DAYS,
  GROUP_STREAK_PAUSE_COOLDOWN_DAYS,
  GROUP_STREAK_PAUSE_MAX_DAYS,
  dayEndsForAll,
} from "@/lib/social/rules";
import { SocialError, isUniqueViolation, lockGroup, lockUsers, recordSocialEvent, type Db, type Tx } from "@/lib/social/common";
import { areFriends } from "@/lib/social/friendStreaks";
import { cancelOffersOnLeaveTx } from "@/lib/social/groupFreeze";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Spaties opschonen; leeg of te lang is ongeldig. */
export function normalizeGroupName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > GROUP_NAME_MAX_LENGTH) return null;
  return name;
}

/** Is deze gebruiker nu lid (en welke rol)? */
export async function activeMembership(db: Db, groupId: string, userId: string) {
  const membership = await db.groupMembership.findUnique({ where: { groupId_userId: { groupId, userId } } });
  return membership && !membership.leftAt ? membership : null;
}

export async function requireAdmin(db: Db, groupId: string, userId: string) {
  const membership = await activeMembership(db, groupId, userId);
  if (!membership) throw new SocialError("together.errors.groupNotFound", 404);
  if (membership.role !== "ADMIN") throw new SocialError("together.errors.groupAdminOnly", 403);
  return membership;
}

/**
 * De eerste groepsdag waarop een nieuw lid meetelt: de dag na de nieuwste
 * kalenderdag die bij een van de leden (of de nieuwkomer) al begonnen is.
 * Zo verandert het vereiste aantal van een lopende groepsdag nooit door
 * iemand die er halverwege bij komt.
 */
export async function nextEligibleDay(tx: Tx, groupId: string, joinerTimeZone: string | null, now: Date): Promise<string> {
  const rows = await tx.$queryRaw<{ timeZone: string | null }[]>`
    SELECT DISTINCT u."timeZone" FROM "GroupMembership" m JOIN "User" u ON u."id" = m."userId"
    WHERE m."groupId" = ${groupId} AND m."leftAt" IS NULL`;
  const latest = [...rows.map((r) => r.timeZone), joinerTimeZone].map((zone) => dayKeyInZone(now, resolveTimeZone(zone))).sort().at(-1)!;
  return addDays(latest, 1);
}

async function countActiveGroups(tx: Tx, userId: string): Promise<number> {
  return tx.groupMembership.count({ where: { userId, leftAt: null } });
}

export async function createGroup(userId: string, rawName: string, now: Date = new Date()): Promise<{ id: string }> {
  const name = normalizeGroupName(rawName);
  if (!name) throw new SocialError("together.errors.groupNameInvalid", 400, { n: GROUP_NAME_MAX_LENGTH });
  return prisma.$transaction(async (tx) => {
    await lockUsers(tx, [userId]);
    if ((await countActiveGroups(tx, userId)) >= GROUP_LIMIT_PER_USER) throw new SocialError("together.errors.groupUserLimit", 409, { n: GROUP_LIMIT_PER_USER });
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
    const firstDay = addDays(dayKeyInZone(now, resolveTimeZone(user.timeZone)), 1);
    const group = await tx.socialGroup.create({
      data: { name, memberCount: 1, nextDay: firstDay, nextCheckAt: dayEndsForAll(firstDay, [user.timeZone]) },
    });
    await tx.groupMembership.create({ data: { groupId: group.id, userId, role: "ADMIN", adminSince: now, joinedAt: now, eligibleFromDay: firstDay } });
    await recordSocialEvent(tx, { kind: "GROUP_CREATED", groupId: group.id, userId, data: { name } });
    return { id: group.id };
  });
}

/**
 * Toetreden, met alle controles opnieuw onder vergrendeling: bestaand
 * lidmaatschap, wachttijd na vertrek, maximaal 10 groepen per persoon en de
 * groepsgrens. Al lid = niets te doen.
 */
export async function joinTx(tx: Tx, userId: string, groupId: string, now: Date): Promise<"joined" | "already"> {
  await lockUsers(tx, [userId]);
  if (!(await lockGroup(tx, groupId))) throw new SocialError("together.errors.groupNotFound", 404);
  const existing = await tx.groupMembership.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (existing && !existing.leftAt) return "already";
  if (existing?.rejoinAfter && existing.rejoinAfter > now) {
    throw new SocialError("together.errors.groupRejoinCooldown", 409, { date: existing.rejoinAfter.toISOString().slice(0, 10) });
  }
  if ((await countActiveGroups(tx, userId)) >= GROUP_LIMIT_PER_USER) throw new SocialError("together.errors.groupUserLimit", 409, { n: GROUP_LIMIT_PER_USER });
  const group = await tx.socialGroup.findUniqueOrThrow({ where: { id: groupId }, select: { memberCount: true } });
  if (group.memberCount >= GROUP_MAX_MEMBERS) throw new SocialError("together.errors.groupFull", 409, { n: GROUP_MAX_MEMBERS });

  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const eligibleFromDay = await nextEligibleDay(tx, groupId, user.timeZone, now);
  const data = { role: "MEMBER" as const, adminSince: null, joinedAt: now, eligibleFromDay, leftAt: null, rejoinAfter: null };
  if (existing) await tx.groupMembership.update({ where: { id: existing.id }, data });
  else await tx.groupMembership.create({ data: { groupId, userId, ...data } });
  await tx.socialGroup.update({ where: { id: groupId }, data: { memberCount: { increment: 1 } } });
  // Lid geworden (bv. via een persoonlijke uitnodiging): een openstaand
  // toegangsverzoek heeft dan geen zin meer.
  await tx.groupJoinRequest.updateMany({ where: { groupId, userId, status: "PENDING" }, data: { status: "CANCELLED", openKey: null, decidedAt: now } });
  await recordSocialEvent(tx, { kind: "MEMBER_JOINED", groupId, userId, data: { eligibleFromDay } });
  return "joined";
}

/** Nodigt een vriend uit. Gewone leden alleen als de groep dat toestaat; iedereen alleen eigen vrienden. */
export async function inviteToGroup(inviterId: string, groupId: string, inviteeId: string, now: Date = new Date()): Promise<void> {
  if (inviterId === inviteeId) throw new SocialError("apiErrors.invalidInput", 400);
  const membership = await activeMembership(prisma, groupId, inviterId);
  if (!membership) throw new SocialError("together.errors.groupNotFound", 404);
  const group = await prisma.socialGroup.findUniqueOrThrow({ where: { id: groupId } });
  if (membership.role !== "ADMIN" && !group.membersCanInvite) throw new SocialError("together.errors.groupInviteNotAllowed", 403);
  if (!(await areFriends(prisma, inviterId, inviteeId))) throw new SocialError("together.errors.groupInviteFriendsOnly", 403);
  const target = await prisma.groupMembership.findUnique({ where: { groupId_userId: { groupId, userId: inviteeId } } });
  if (target && !target.leftAt) throw new SocialError("together.errors.groupAlreadyMember", 409);
  if (target?.rejoinAfter && target.rejoinAfter > now) throw new SocialError("together.errors.groupInviteeCooldown", 409);
  if (group.memberCount >= GROUP_MAX_MEMBERS) throw new SocialError("together.errors.groupFull", 409, { n: GROUP_MAX_MEMBERS });

  const existing = await prisma.groupInvite.findUnique({ where: { groupId_inviteeId: { groupId, inviteeId } } });
  if (existing?.status === "PENDING") return;
  const data = { inviterId, status: "PENDING" as const, createdAt: now, respondedAt: null };
  await prisma.groupInvite
    .upsert({ where: { groupId_inviteeId: { groupId, inviteeId } }, create: { groupId, inviteeId, ...data }, update: data })
    .catch((error) => {
      // Twee mensen die tegelijk dezelfde persoon uitnodigen: één uitnodiging is genoeg.
      if (!isUniqueViolation(error)) throw error;
    });
  const inviter = await prisma.user.findUnique({ where: { id: inviterId }, select: { handle: true } });
  notifyGroupInvite(inviteeId, inviter?.handle ?? "", group.name).catch(() => {});
}

/** Een uitnodiging intrekken: door een beheerder of door wie hem stuurde. */
export async function cancelGroupInvite(userId: string, groupId: string, inviteId: string, now: Date = new Date()): Promise<void> {
  const invite = await prisma.groupInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.groupId !== groupId || invite.status !== "PENDING") throw new SocialError("together.errors.groupInviteNotFound", 404);
  const membership = await activeMembership(prisma, groupId, userId);
  if (!membership || (membership.role !== "ADMIN" && invite.inviterId !== userId)) throw new SocialError("together.errors.groupAdminOnly", 403);
  await prisma.groupInvite.updateMany({ where: { id: inviteId, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: now } });
}

/** Deelnemen of weigeren. Deelnemen is idempotent en controleert alles opnieuw. */
export async function respondGroupInvite(userId: string, inviteId: string, accept: boolean, now: Date = new Date()): Promise<{ groupId: string }> {
  const invite = await prisma.groupInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.inviteeId !== userId) throw new SocialError("together.errors.groupInviteNotFound", 404);
  if (invite.status === "ACCEPTED" && accept) return { groupId: invite.groupId };
  if (invite.status !== "PENDING") throw new SocialError("together.errors.groupInviteNotFound", 404);
  if (!accept) {
    await prisma.groupInvite.updateMany({ where: { id: inviteId, status: "PENDING" }, data: { status: "DECLINED", respondedAt: now } });
    return { groupId: invite.groupId };
  }
  await prisma.$transaction(async (tx) => {
    await joinTx(tx, userId, invite.groupId, now);
    await tx.groupInvite.updateMany({ where: { id: inviteId, status: "PENDING" }, data: { status: "ACCEPTED", respondedAt: now } });
  });
  return { groupId: invite.groupId };
}

export async function updateGroupSettings(
  adminId: string,
  groupId: string,
  changes: { name?: string; membersCanInvite?: boolean; membersCanApprove?: boolean; showOnLeaderboard?: boolean }
): Promise<void> {
  await requireAdmin(prisma, groupId, adminId);
  const data: { name?: string; membersCanInvite?: boolean; membersCanApprove?: boolean; showOnLeaderboard?: boolean } = {};
  if (changes.name !== undefined) {
    const name = normalizeGroupName(changes.name);
    if (!name) throw new SocialError("together.errors.groupNameInvalid", 400, { n: GROUP_NAME_MAX_LENGTH });
    data.name = name;
  }
  if (changes.membersCanInvite !== undefined) data.membersCanInvite = changes.membersCanInvite;
  if (changes.membersCanApprove !== undefined) data.membersCanApprove = changes.membersCanApprove;
  if (changes.showOnLeaderboard !== undefined) data.showOnLeaderboard = changes.showOnLeaderboard;
  await prisma.socialGroup.update({ where: { id: groupId }, data });
}

/**
 * Zet één lid tijdelijk buiten de groepsreeks. De start ligt bewust na de
 * nieuwste al begonnen lokale groepsdag, zodat een lopende dag niet achteraf
 * van samenstelling verandert.
 */
export async function pauseMemberForGroupStreak(
  adminId: string,
  groupId: string,
  memberId: string,
  days: number,
  now: Date = new Date()
): Promise<{ userId: string; groupId: string; groupName: string; fromDay: string; untilDay: string }> {
  if (!Number.isInteger(days) || days < 1 || days > GROUP_STREAK_PAUSE_MAX_DAYS) {
    throw new SocialError("together.errors.groupPauseDurationInvalid", 400, { n: GROUP_STREAK_PAUSE_MAX_DAYS });
  }
  if (adminId === memberId) throw new SocialError("apiErrors.invalidInput", 400);

  const result = await prisma.$transaction(async (tx) => {
    await lockUsers(tx, [adminId, memberId]);
    if (!(await lockGroup(tx, groupId))) throw new SocialError("together.errors.groupNotFound", 404);
    await requireAdmin(tx, groupId, adminId);
    const target = await activeMembership(tx, groupId, memberId);
    if (!target) throw new SocialError("together.errors.groupMemberNotFound", 404);
    const user = await tx.user.findUniqueOrThrow({ where: { id: memberId }, select: { timeZone: true } });
    const group = await tx.socialGroup.findUniqueOrThrow({ where: { id: groupId }, select: { name: true } });
    const fromDay = await nextEligibleDay(tx, groupId, user.timeZone, now);

    if (target.streakPauseFromDay && target.streakPauseUntilDay && target.streakPauseUntilDay >= fromDay) {
      throw new SocialError("together.errors.groupPauseAlreadyActive", 409);
    }
    const lastEnded = target.lastStreakPauseEndedDay ?? target.streakPauseUntilDay;
    if (lastEnded && fromDay <= addDays(lastEnded, GROUP_STREAK_PAUSE_COOLDOWN_DAYS)) {
      throw new SocialError("together.errors.groupPauseCooldown", 409, { date: addDays(lastEnded, GROUP_STREAK_PAUSE_COOLDOWN_DAYS + 1) });
    }

    const untilDay = addDays(fromDay, days - 1);
    await tx.groupMembership.update({
      where: { id: target.id },
      data: { streakPauseFromDay: fromDay, streakPauseUntilDay: untilDay, lastStreakPauseEndedDay: null },
    });
    await recordSocialEvent(tx, { kind: "GROUP_MEMBER_PAUSED", groupId, userId: memberId, dayKey: fromDay, data: { untilDay, by: adminId } });
    return { userId: memberId, groupId, groupName: group.name, fromDay, untilDay };
  });
  notifyGroupMemberPaused(result.userId, result.groupId, result.groupName).catch(() => {});
  return result;
}

/**
 * Een echte studiedag beëindigt een actieve groepspauze. De huidige dag blijft
 * uitgesloten; pas de volgende groepsdag telt het lid weer mee. Bevroren
 * dagen komen hier niet binnen en beëindigen de pauze dus niet.
 */
export async function endGroupStreakPausesForActivity(userIds: string[], now: Date = new Date()): Promise<{ userId: string; groupId: string; groupName: string }[]> {
  if (userIds.length === 0) return [];
  const memberships = await prisma.groupMembership.findMany({
    where: { userId: { in: [...new Set(userIds)] }, leftAt: null, streakPauseFromDay: { not: null }, streakPauseUntilDay: { not: null } },
    select: { groupId: true, userId: true },
  });
  const groupIds = [...new Set(memberships.map((m) => m.groupId))].sort();
  const ended: { userId: string; groupId: string; groupName: string }[] = [];

  for (const groupId of groupIds) {
    const result = await prisma.$transaction(async (tx) => {
      const candidateIds = memberships.filter((m) => m.groupId === groupId).map((m) => m.userId);
      await lockUsers(tx, candidateIds);
      if (!(await lockGroup(tx, groupId))) return [];
      const rows = await tx.groupMembership.findMany({
        where: { groupId, userId: { in: candidateIds }, leftAt: null, streakPauseFromDay: { not: null }, streakPauseUntilDay: { not: null } },
        include: { group: { select: { name: true } }, user: { select: { timeZone: true } } },
      });
      const changed: { userId: string; groupId: string; groupName: string }[] = [];
      for (const row of rows) {
        const day = dayKeyInZone(now, resolveTimeZone(row.user.timeZone));
        if (day < row.streakPauseFromDay! || day > row.streakPauseUntilDay!) continue;
        // De minuuttaak kan dezelfde studiedag meerdere keren zien; de
        // einddatum en het event moeten daarom idempotent blijven.
        if (row.lastStreakPauseEndedDay === day) continue;
        await tx.groupMembership.update({ where: { id: row.id }, data: { streakPauseUntilDay: day, lastStreakPauseEndedDay: day } });
        await recordSocialEvent(tx, { kind: "GROUP_MEMBER_PAUSE_ENDED", groupId, userId: row.userId, dayKey: day, data: { reason: "activity" } });
        changed.push({ userId: row.userId, groupId, groupName: row.group.name });
      }
      return changed;
    });
    ended.push(...result);
    for (const item of result) notifyGroupMemberPauseEnded(item.userId, item.groupId, item.groupName).catch(() => {});
  }
  return ended;
}

/** Lid beheerder maken of de beheerdersrol afnemen. Er blijft altijd minstens één beheerder. */
export async function setMemberRole(adminId: string, groupId: string, memberId: string, role: "ADMIN" | "MEMBER", now: Date = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (!(await lockGroup(tx, groupId))) throw new SocialError("together.errors.groupNotFound", 404);
    await requireAdmin(tx, groupId, adminId);
    const target = await activeMembership(tx, groupId, memberId);
    if (!target) throw new SocialError("together.errors.groupMemberNotFound", 404);
    if (target.role === role) return;
    if (role === "MEMBER") {
      const admins = await tx.groupMembership.count({ where: { groupId, leftAt: null, role: "ADMIN" } });
      if (admins <= 1) throw new SocialError("together.errors.groupLastAdmin", 409);
    }
    await tx.groupMembership.update({ where: { id: target.id }, data: { role, adminSince: role === "ADMIN" ? now : null } });
    await recordSocialEvent(tx, { kind: role === "ADMIN" ? "ADMIN_PROMOTED" : "ADMIN_DEMOTED", groupId, userId: memberId, data: { by: adminId } });
  });
}

/**
 * Vertrekken of verwijderd worden: het lid telt direct niet meer mee (ook
 * niet voor de lopende groepsdag), mag 7 dagen niet terug, en een nog
 * gereserveerde bevriezing gaat terug. Afgesloten dagen veranderen niet.
 * Blijft er geen beheerder over, dan volgt automatisch een opvolger.
 */
async function departTx(tx: Tx, groupId: string, userId: string, kind: "MEMBER_LEFT" | "MEMBER_REMOVED", actorId: string, now: Date): Promise<{ promoted: string | null; deleted: boolean }> {
  const left = await tx.groupMembership.updateMany({
    where: { groupId, userId, leftAt: null },
    data: { leftAt: now, role: "MEMBER", adminSince: null, rejoinAfter: new Date(now.getTime() + GROUP_REJOIN_COOLDOWN_DAYS * DAY_MS) },
  });
  if (left.count === 0) return { promoted: null, deleted: false };
  const group = await tx.socialGroup.update({ where: { id: groupId }, data: { memberCount: { decrement: 1 } } });
  await cancelOffersOnLeaveTx(tx, userId, groupId, now);
  await tx.groupInvite.updateMany({ where: { groupId, inviterId: userId, status: "PENDING" }, data: { status: "CANCELLED", respondedAt: now } });
  await recordSocialEvent(tx, { kind, groupId, userId, data: kind === "MEMBER_REMOVED" ? { by: actorId } : undefined });
  if (group.memberCount <= 0) {
    await tx.socialGroup.delete({ where: { id: groupId } });
    return { promoted: null, deleted: true };
  }
  return { promoted: await ensureAdminTx(tx, groupId, now), deleted: false };
}

export async function leaveGroup(userId: string, groupId: string, now: Date = new Date()): Promise<void> {
  const result = await prisma.$transaction(async (tx) => {
    if (!(await lockGroup(tx, groupId))) throw new SocialError("together.errors.groupNotFound", 404);
    if (!(await activeMembership(tx, groupId, userId))) throw new SocialError("together.errors.groupNotFound", 404);
    return departTx(tx, groupId, userId, "MEMBER_LEFT", userId, now);
  });
  await announcePromotion(groupId, result.promoted);
}

/** Bij het verwijderen van een account: uit elke groep vertrekken (ledentallen en beheerders blijven kloppen). */
export async function leaveAllGroups(userId: string, now: Date = new Date()): Promise<void> {
  const memberships = await prisma.groupMembership.findMany({ where: { userId, leftAt: null }, select: { groupId: true } });
  for (const { groupId } of memberships) await leaveGroup(userId, groupId, now).catch((e) => console.error(`Groep ${groupId} verlaten:`, e));
}

/** Alleen gewone leden; een beheerder eerst de beheerdersrol afnemen. Dubbel verwijderen is onschuldig. */
export async function removeMember(adminId: string, groupId: string, memberId: string, now: Date = new Date()): Promise<void> {
  if (adminId === memberId) throw new SocialError("apiErrors.invalidInput", 400);
  const result = await prisma.$transaction(async (tx) => {
    if (!(await lockGroup(tx, groupId))) throw new SocialError("together.errors.groupNotFound", 404);
    await requireAdmin(tx, groupId, adminId);
    const target = await activeMembership(tx, groupId, memberId);
    if (!target) return { promoted: null, deleted: false };
    if (target.role === "ADMIN") throw new SocialError("together.errors.groupRemoveAdmin", 409);
    return departTx(tx, groupId, memberId, "MEMBER_REMOVED", adminId, now);
  });
  await announcePromotion(groupId, result.promoted);
}

async function announcePromotion(groupId: string, userId: string | null): Promise<void> {
  if (!userId) return;
  const group = await prisma.socialGroup.findUnique({ where: { id: groupId }, select: { name: true } });
  if (group) notifyGroupAdminAssigned(userId, groupId, group.name).catch(() => {});
}

// --- Beheerders als actieve verantwoordelijkheid ---------------------------

interface MemberActivity {
  userId: string;
  role: "ADMIN" | "MEMBER";
  joinedAt: Date;
  adminSince: Date | null;
  timeZone: string | null;
  lastStudied: string | null;
  contribution: number;
}

/** Dagen sinds de laatste echte studiedag (een bevroren dag is geen activiteit). */
function idleDays(lastStudied: string | null, since: Date, timeZone: string | null, now: Date): number {
  const zone = resolveTimeZone(timeZone);
  const today = dayKeyInZone(now, zone);
  // Zonder studiedag telt de dag vóór het begin van de verantwoordelijkheid als laatste.
  const startedBefore = addDays(dayKeyInZone(since, zone), -1);
  const reference = lastStudied && lastStudied > startedBefore ? lastStudied : startedBefore;
  return daysBetween(reference, today) - 1;
}

async function memberActivity(tx: Tx, groupId: string): Promise<MemberActivity[]> {
  // Eén query voor de hele groep: laatste studiedag en bijdrage aan de
  // huidige groepsreeks (gehaalde dagen waarop dit lid zijn reeks behield).
  return tx.$queryRaw<MemberActivity[]>`
    SELECT m."userId", m."role", m."joinedAt", m."adminSince", u."timeZone",
      (SELECT max(s."dayKey") FROM "StreakDay" s WHERE s."userId" = m."userId" AND s."status" = 'STUDIED') AS "lastStudied",
      (SELECT count(*)::int FROM "GroupDay" d JOIN "StreakDay" s ON s."userId" = m."userId" AND s."dayKey" = d."dayKey"
        WHERE d."groupId" = m."groupId" AND d."status" = 'ACHIEVED' AND g."streakStartDay" IS NOT NULL
          AND d."dayKey" >= g."streakStartDay" AND d."dayKey" >= m."eligibleFromDay") AS "contribution"
    FROM "GroupMembership" m
    JOIN "User" u ON u."id" = m."userId"
    JOIN "SocialGroup" g ON g."id" = m."groupId"
    WHERE m."groupId" = ${groupId} AND m."leftAt" IS NULL`;
}

/**
 * Zorgt dat er een beheerder is zolang er een geschikt actief lid is: het
 * lid met de grootste bijdrage aan de huidige groepsreeks, bij gelijke
 * bijdrage wie het langst lid is. Geeft de nieuwe beheerder terug.
 */
export async function ensureAdminTx(tx: Tx, groupId: string, now: Date): Promise<string | null> {
  const admins = await tx.groupMembership.count({ where: { groupId, leftAt: null, role: "ADMIN" } });
  if (admins > 0) return null;
  const candidates = (await memberActivity(tx, groupId))
    .filter((m) => idleDays(m.lastStudied, m.joinedAt, m.timeZone, now) < ADMIN_INACTIVE_DAYS)
    .sort((a, b) => b.contribution - a.contribution || a.joinedAt.getTime() - b.joinedAt.getTime());
  const next = candidates[0];
  if (!next) return null;
  await tx.groupMembership.update({ where: { groupId_userId: { groupId, userId: next.userId } }, data: { role: "ADMIN", adminSince: now } });
  await recordSocialEvent(tx, { kind: "ADMIN_AUTO_PROMOTED", groupId, userId: next.userId, data: { contribution: next.contribution } });
  return next.userId;
}

/**
 * Welke groepen moeten nu iets met beheerders: een beheerder die 14 dagen
 * niet studeerde, of geen beheerder meer. Bewust in twee kleine queries over
 * alleen de beheerders en een telling per groep, zodat het uurlijkse rondje
 * nooit alle 500 leden van elke groep hoeft te laden.
 */
export async function adminMaintenanceCandidates(now: Date = new Date()): Promise<string[]> {
  const admins = await prisma.$queryRaw<{ groupId: string; userId: string; adminSince: Date | null; joinedAt: Date; timeZone: string | null; lastStudied: string | null }[]>`
    SELECT m."groupId", m."userId", m."adminSince", m."joinedAt", u."timeZone",
      (SELECT max(s."dayKey") FROM "StreakDay" s WHERE s."userId" = m."userId" AND s."status" = 'STUDIED') AS "lastStudied"
    FROM "GroupMembership" m JOIN "User" u ON u."id" = m."userId"
    WHERE m."leftAt" IS NULL AND m."role" = 'ADMIN'`;
  const adminless = await prisma.$queryRaw<{ groupId: string }[]>`
    SELECT m."groupId" FROM "GroupMembership" m
    WHERE m."leftAt" IS NULL
    GROUP BY m."groupId"
    HAVING count(*) FILTER (WHERE m."role" = 'ADMIN') = 0`;
  const groups = new Set(adminless.map((g) => g.groupId));
  for (const admin of admins) {
    if (idleDays(admin.lastStudied, admin.adminSince ?? admin.joinedAt, admin.timeZone, now) >= ADMIN_INACTIVE_DAYS) groups.add(admin.groupId);
  }
  return [...groups];
}

/**
 * Beheerders die 14 dagen op rij niet hebben gestudeerd, verliezen hun rol
 * (ze blijven gewoon lid en kunnen later opnieuw beheerder worden). Daarna
 * krijgt elke groep zonder beheerder een opvolger, als die er is.
 */
export async function runGroupAdminMaintenance(now: Date = new Date()): Promise<void> {
  for (const groupId of await adminMaintenanceCandidates(now)) {
    const promoted = await prisma
      .$transaction(async (tx) => {
        if (!(await lockGroup(tx, groupId))) return null;
        for (const member of await memberActivity(tx, groupId)) {
          if (member.role !== "ADMIN") continue;
          if (idleDays(member.lastStudied, member.adminSince ?? member.joinedAt, member.timeZone, now) < ADMIN_INACTIVE_DAYS) continue;
          const demoted = await tx.groupMembership.updateMany({ where: { groupId, userId: member.userId, role: "ADMIN", leftAt: null }, data: { role: "MEMBER", adminSince: null } });
          if (demoted.count > 0) await recordSocialEvent(tx, { kind: "ADMIN_INACTIVE_DEMOTED", groupId, userId: member.userId });
        }
        return ensureAdminTx(tx, groupId, now);
      })
      .catch((e) => {
        console.error(`Beheerders van groep ${groupId}:`, e);
        return null;
      });
    await announcePromotion(groupId, promoted);
  }
}
