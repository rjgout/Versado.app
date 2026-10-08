// Groepslink en QR-code: een veilige voordeur naar een besloten groep, geen
// sleutel. Het token in de link geeft (na inloggen) alleen een beperkte
// voorpagina en de mogelijkheid om toegang te vragen; een bevoegd persoon
// uit de groep laat iemand binnen. Zie docs/SAMEN.md.
//
// Het token staat los van "Toon op openbare ranglijsten": een privégroep
// kan een link hebben, en een openbare groep zonder link is via de
// ranglijst niet aan te vragen.

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { notifyGroupJoinApproved, notifyGroupJoinDeclined, notifyGroupJoinRequest } from "@/lib/notify";
import {
  GROUP_LIMIT_PER_USER,
  GROUP_LINK_TOKEN_BYTES,
  GROUP_MAX_MEMBERS,
  JOIN_REQUEST_DECLINE_COOLDOWN_DAYS,
  JOIN_REQUEST_HOURLY_LIMIT,
} from "@/lib/social/rules";
import { SocialError, isUniqueViolation, lockGroup, lockUsers, personSelect, recordSocialEvent, type Db, type PersonSummary } from "@/lib/social/common";
import { areFriends } from "@/lib/social/friendStreaks";
import { activeMembership, joinTx, requireAdmin } from "@/lib/social/groups";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** base64url van 32 bytes: precies 43 tekens. Alles wat daar niet op lijkt, hoeft niet eens naar de database. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function newToken(): string {
  return randomBytes(GROUP_LINK_TOKEN_BYTES).toString("base64url");
}

export function isWellFormedGroupToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

// --- De link beheren (alleen beheerders) ----------------------------------

/** Zet de groepslink aan. Staat hij al aan, dan blijft het bestaande token gelden. */
export async function enableGroupLink(adminId: string, groupId: string, now: Date = new Date()): Promise<string> {
  await requireAdmin(prisma, groupId, adminId);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const token = await prisma.$transaction(async (tx) => {
        if (!(await lockGroup(tx, groupId))) throw new SocialError("together.errors.groupNotFound", 404);
        const group = await tx.socialGroup.findUniqueOrThrow({ where: { id: groupId }, select: { joinLinkToken: true } });
        if (group.joinLinkToken) return group.joinLinkToken;
        const token = newToken();
        await tx.socialGroup.update({ where: { id: groupId }, data: { joinLinkToken: token, joinLinkCreatedAt: now } });
        await recordSocialEvent(tx, { kind: "GROUP_LINK_ENABLED", groupId, userId: adminId });
        return token;
      });
      return token;
    } catch (error) {
      // Een botsing van 256 willekeurige bits gebeurt in de praktijk niet,
      // maar de unieke sleutel bewaakt het toch: gewoon opnieuw loten.
      if (!isUniqueViolation(error)) throw error;
    }
  }
  throw new Error("Kon geen unieke groepslink maken.");
}

/**
 * Intrekken: het token is meteen ongeldig, dus oude links en QR-codes (bv.
 * op een poster) werken niet meer. Een nieuwe link krijgt altijd een nieuw
 * token; het oude komt nooit terug. Openstaande verzoeken blijven staan:
 * die zijn al gedaan en een bevoegd persoon beslist erover.
 */
export async function revokeGroupLink(adminId: string, groupId: string): Promise<void> {
  await requireAdmin(prisma, groupId, adminId);
  const updated = await prisma.socialGroup.updateMany({ where: { id: groupId, joinLinkToken: { not: null } }, data: { joinLinkToken: null, joinLinkCreatedAt: null } });
  if (updated.count > 0) await recordSocialEvent(prisma, { kind: "GROUP_LINK_REVOKED", groupId, userId: adminId });
}

async function groupByToken(db: Db, token: string) {
  if (!isWellFormedGroupToken(token)) return null;
  return db.socialGroup.findUnique({ where: { joinLinkToken: token } });
}

// --- De voorpagina ------------------------------------------------------------

/** Een beheerder zoals een buitenstaander hem ziet: naam en avatar, geen id of nummer. */
export interface MinimalPerson {
  key: string;
  handle: string;
  avatarEmoji: string | null;
}

export type JoinRequestState = { status: "none" } | { status: "pending" } | { status: "cooldown"; until: string };

export type GroupLinkView =
  | { state: "invalid" }
  | { state: "login" }
  | { state: "member"; groupId: string }
  | {
      state: "preview";
      group: { name: string; currentStreak: number; memberCount: number; achievements: string[] };
      friends: PersonSummary[];
      admins: MinimalPerson[];
      request: JoinRequestState;
    };

/** Niet-herleidbare sleutel voor de avatarkleur van een beheerder (geen gebruikers-id naar buiten). */
function opaqueKey(userId: string, groupId: string): string {
  return `p-${createHash("sha256").update(`${groupId}:${userId}`).digest("base64url").slice(0, 16)}`;
}

/**
 * Wat iemand met de link te zien krijgt. Ongeldig of ingetrokken: niets
 * over de groep. Niet ingelogd: ook niets, alleen dat hij moet inloggen.
 * Lid: door naar de gewone groepspagina. Anders: naam, reeks, ledental,
 * prestaties, en eerst eigen vrienden die al meedoen; kent hij niemand, dan
 * de beheerders met alleen naam en avatar. Nooit de ledenlijst.
 */
export async function groupLinkView(token: string, viewerId: string | null, now: Date = new Date()): Promise<GroupLinkView> {
  const group = await groupByToken(prisma, token);
  if (!group) return { state: "invalid" };
  if (!viewerId) return { state: "login" };
  if (await activeMembership(prisma, group.id, viewerId)) return { state: "member", groupId: group.id };

  const [friendRows, achievements, request] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT m."userId" AS "id" FROM "GroupMembership" m
      JOIN "Friendship" f ON f."status" = 'ACCEPTED'
        AND ((f."senderId" = ${viewerId} AND f."receiverId" = m."userId") OR (f."receiverId" = ${viewerId} AND f."senderId" = m."userId"))
      WHERE m."groupId" = ${group.id} AND m."leftAt" IS NULL`,
    prisma.groupAchievement.findMany({ where: { groupId: group.id }, orderBy: { achievedAt: "asc" }, select: { slug: true } }),
    joinRequestState(group.id, viewerId, now),
  ]);
  const friends = friendRows.length
    ? await prisma.user.findMany({ where: { id: { in: friendRows.map((r) => r.id) } }, select: personSelect, orderBy: { handle: "asc" } })
    : [];
  const admins = friends.length
    ? []
    : (
        await prisma.groupMembership.findMany({
          where: { groupId: group.id, leftAt: null, role: "ADMIN" },
          select: { userId: true, user: { select: { handle: true, avatarEmoji: true } } },
          orderBy: { adminSince: "asc" },
        })
      ).map((m) => ({ key: opaqueKey(m.userId, group.id), handle: m.user.handle, avatarEmoji: m.user.avatarEmoji }));

  return {
    state: "preview",
    group: { name: group.name, currentStreak: group.currentStreak, memberCount: group.memberCount, achievements: achievements.map((a) => a.slug) },
    friends,
    admins,
    request,
  };
}

async function joinRequestState(groupId: string, userId: string, now: Date): Promise<JoinRequestState> {
  const last = await prisma.groupJoinRequest.findFirst({ where: { groupId, userId }, orderBy: { createdAt: "desc" } });
  if (last?.status === "PENDING") return { status: "pending" };
  if (last?.status === "DECLINED" && last.decidedAt) {
    const until = new Date(last.decidedAt.getTime() + JOIN_REQUEST_DECLINE_COOLDOWN_DAYS * DAY_MS);
    if (until > now) return { status: "cooldown", until: until.toISOString() };
  }
  return { status: "none" };
}

// --- Toegang vragen -----------------------------------------------------------

/**
 * Wie een verzoek mag afhandelen: beheerders altijd; een gewoon lid alleen
 * als de groep dat toestaat én de aanvrager een vriend van hem is.
 */
async function canDecide(db: Db, groupId: string, deciderId: string, requesterId: string): Promise<boolean> {
  const membership = await activeMembership(db, groupId, deciderId);
  if (!membership) return false;
  if (membership.role === "ADMIN") return true;
  const group = await db.socialGroup.findUnique({ where: { id: groupId }, select: { membersCanApprove: true } });
  return !!group?.membersCanApprove && (await areFriends(db, deciderId, requesterId));
}

/** Wie een melding krijgt van een nieuw verzoek: de beheerders, en (als dat mag) leden die vrienden van de aanvrager zijn. Nooit de hele groep. */
export async function joinRequestRecipients(db: Db, groupId: string, requesterId: string): Promise<string[]> {
  const group = await db.socialGroup.findUniqueOrThrow({ where: { id: groupId }, select: { membersCanApprove: true } });
  const admins = await db.groupMembership.findMany({ where: { groupId, leftAt: null, role: "ADMIN" }, select: { userId: true } });
  const ids = new Set(admins.map((a) => a.userId));
  if (group.membersCanApprove) {
    const friends = await db.$queryRaw<{ id: string }[]>`
      SELECT m."userId" AS "id" FROM "GroupMembership" m
      JOIN "Friendship" f ON f."status" = 'ACCEPTED'
        AND ((f."senderId" = ${requesterId} AND f."receiverId" = m."userId") OR (f."receiverId" = ${requesterId} AND f."senderId" = m."userId"))
      WHERE m."groupId" = ${groupId} AND m."leftAt" IS NULL`;
    for (const f of friends) ids.add(f.id);
  }
  ids.delete(requesterId);
  return [...ids];
}

/**
 * Vraagt toegang via een geldige groepslink. Idempotent: een openstaand
 * verzoek blijft het ene verzoek (unieke openKey, ook bij twee klikken
 * tegelijk). Tegen spam: na een weigering een paar dagen niet opnieuw, en
 * hooguit een handvol nieuwe verzoeken per uur.
 */
export async function requestToJoin(userId: string, token: string, now: Date = new Date()): Promise<{ status: "pending" | "member"; groupId?: string }> {
  const group = await groupByToken(prisma, token);
  if (!group) throw new SocialError("together.errors.groupLinkInvalid", 404);
  const membership = await prisma.groupMembership.findUnique({ where: { groupId_userId: { groupId: group.id, userId } } });
  if (membership && !membership.leftAt) return { status: "member", groupId: group.id };
  if (membership?.rejoinAfter && membership.rejoinAfter > now) {
    throw new SocialError("together.errors.groupRejoinCooldown", 409, { date: membership.rejoinAfter.toISOString().slice(0, 10) });
  }
  const state = await joinRequestState(group.id, userId, now);
  if (state.status === "pending") return { status: "pending", groupId: group.id };
  if (state.status === "cooldown") throw new SocialError("together.errors.joinRequestCooldown", 409, { date: state.until.slice(0, 10) });
  if ((await prisma.groupMembership.count({ where: { userId, leftAt: null } })) >= GROUP_LIMIT_PER_USER) {
    throw new SocialError("together.errors.groupUserLimit", 409, { n: GROUP_LIMIT_PER_USER });
  }
  if (group.memberCount >= GROUP_MAX_MEMBERS) throw new SocialError("together.errors.groupFull", 409, { n: GROUP_MAX_MEMBERS });
  const recent = await prisma.groupJoinRequest.count({ where: { userId, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } } });
  if (recent >= JOIN_REQUEST_HOURLY_LIMIT) throw new SocialError("together.errors.joinRequestTooMany", 429);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.groupJoinRequest.create({ data: { groupId: group.id, userId, openKey: `${group.id}:${userId}`, createdAt: now } });
      await recordSocialEvent(tx, { kind: "JOIN_REQUESTED", groupId: group.id, userId });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "pending", groupId: group.id };
    throw error;
  }

  const [requester, recipients] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { handle: true } }),
    joinRequestRecipients(prisma, group.id, userId),
  ]);
  for (const id of recipients) notifyGroupJoinRequest(id, requester?.handle ?? "", group.id, group.name).catch(() => {});
  return { status: "pending", groupId: group.id };
}

/**
 * Een verzoek toelaten of weigeren. Alles wordt binnen één transactie
 * opnieuw gecontroleerd met dezelfde vergrendeling als elke andere
 * toetreding (eerst de aanvrager, dan de groep): rechten, of het verzoek nog
 * openstaat, en via de gewone toetreding (joinTx) wachttijd, 10 groepen,
 * 500 leden en een bestaand lidmaatschap. Twee gelijktijdige goedkeuringen
 * leveren dus één lidmaatschap op; de tweede ziet het verzoek als al
 * afgehandeld.
 */
export async function decideJoinRequest(deciderId: string, requestId: string, approve: boolean, now: Date = new Date()): Promise<{ result: "approved" | "declined" | "already" }> {
  const request = await prisma.groupJoinRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new SocialError("together.errors.joinRequestNotFound", 404);

  const result = await prisma.$transaction(async (tx) => {
    await lockUsers(tx, [request.userId]);
    if (!(await lockGroup(tx, request.groupId))) throw new SocialError("together.errors.groupNotFound", 404);
    if (!(await canDecide(tx, request.groupId, deciderId, request.userId))) throw new SocialError("together.errors.joinRequestNotAllowed", 403);
    const current = await tx.groupJoinRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (current.status !== "PENDING") {
      if (current.status === "APPROVED" && approve) return "already" as const;
      throw new SocialError("together.errors.joinRequestNotFound", 404);
    }
    const decided = { openKey: null, decidedAt: now, decidedById: deciderId };
    if (!approve) {
      await tx.groupJoinRequest.update({ where: { id: requestId }, data: { status: "DECLINED", ...decided } });
      await recordSocialEvent(tx, { kind: "JOIN_DECLINED", groupId: request.groupId, userId: request.userId, data: { by: deciderId } });
      return "declined" as const;
    }
    // Eerst het verzoek afsluiten, dan de gewone toetreding: die controleert
    // alle grenzen en gooit bij een overschrijding, waarna alles terugrolt
    // en het verzoek gewoon open blijft.
    await tx.groupJoinRequest.update({ where: { id: requestId }, data: { status: "APPROVED", ...decided } });
    await joinTx(tx, request.userId, request.groupId, now);
    await recordSocialEvent(tx, { kind: "JOIN_APPROVED", groupId: request.groupId, userId: request.userId, data: { by: deciderId } });
    return "approved" as const;
  });

  if (result !== "already") {
    const group = await prisma.socialGroup.findUnique({ where: { id: request.groupId }, select: { name: true } });
    if (group) {
      if (result === "approved") notifyGroupJoinApproved(request.userId, request.groupId, group.name).catch(() => {});
      else notifyGroupJoinDeclined(request.userId, group.name).catch(() => {});
    }
  }
  return { result };
}

export interface JoinRequestView {
  id: string;
  person: PersonSummary;
  createdAt: string;
  /** Leden die vrienden van de aanvrager zijn (hooguit drie namen), als context. */
  friendsInGroup: string[];
}

/**
 * Openstaande verzoeken die deze persoon mag zien én afhandelen: een
 * beheerder alle, een gewoon lid (als de groep dat toestaat) alleen die van
 * zijn eigen vrienden. Een gewoon lid ziet dus nooit onbekende aanvragers.
 */
export async function visibleJoinRequests(groupId: string, viewerId: string): Promise<JoinRequestView[]> {
  const membership = await activeMembership(prisma, groupId, viewerId);
  if (!membership) return [];
  const group = await prisma.socialGroup.findUnique({ where: { id: groupId }, select: { membersCanApprove: true } });
  if (!group) return [];
  let requests = await prisma.groupJoinRequest.findMany({
    where: { groupId, status: "PENDING" },
    include: { user: { select: personSelect } },
    orderBy: { createdAt: "asc" },
  });
  if (membership.role !== "ADMIN") {
    if (!group.membersCanApprove) return [];
    const friendIds = new Set<string>();
    for (const r of requests) if (await areFriends(prisma, viewerId, r.userId)) friendIds.add(r.userId);
    requests = requests.filter((r) => friendIds.has(r.userId));
  }
  if (requests.length === 0) return [];

  const requesterIds = requests.map((r) => r.userId);
  const links = await prisma.$queryRaw<{ requesterId: string; handle: string }[]>`
    SELECT CASE WHEN f."senderId" = ANY(${requesterIds}::text[]) THEN f."senderId" ELSE f."receiverId" END AS "requesterId", u."handle"
    FROM "Friendship" f
    JOIN "GroupMembership" m ON m."groupId" = ${groupId} AND m."leftAt" IS NULL
      AND m."userId" = CASE WHEN f."senderId" = ANY(${requesterIds}::text[]) THEN f."receiverId" ELSE f."senderId" END
    JOIN "User" u ON u."id" = m."userId"
    WHERE f."status" = 'ACCEPTED' AND (f."senderId" = ANY(${requesterIds}::text[]) OR f."receiverId" = ANY(${requesterIds}::text[]))
    ORDER BY u."handle"`;
  return requests.map((r) => ({
    id: r.id,
    person: r.user,
    createdAt: r.createdAt.toISOString(),
    friendsInGroup: links.filter((l) => l.requesterId === r.userId).map((l) => l.handle).slice(0, 3),
  }));
}
