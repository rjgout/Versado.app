// Gedeelde bouwstenen voor Samen: fouten, rijvergrendeling, de dagstatus
// van personen uit hun persoonlijke reeks, en de geschiedenis. Geen
// Next-API's: dit hoort ook in de eager-keten van server.ts (scheduler).

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { MessageKey, Vars } from "@/lib/i18n/core";
import { memberDayOutcome, type MemberDayOutcome } from "@/lib/social/rules";

export type Db = PrismaClient | Prisma.TransactionClient;
export type Tx = Prisma.TransactionClient;

/** Een verwachte weigering (limiet, rechten, wachttijd): de route geeft hem vertaald door. */
export class SocialError extends Error {
  constructor(
    public readonly key: MessageKey,
    public readonly status: number,
    public readonly vars?: Vars
  ) {
    super(key);
  }
}

/**
 * Vergrendelt gebruikersrijen tot het einde van de transactie, altijd in
 * dezelfde volgorde (op id), zodat twee gelijktijdige acties elkaar niet
 * vastzetten. Altijd eerst gebruikers, dan een groep.
 */
export async function lockUsers(tx: Tx, userIds: string[]): Promise<void> {
  const ids = [...new Set(userIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
}

/** Vergrendelt een groep (na eventuele gebruikers). Geeft false als hij niet bestaat. */
export async function lockGroup(tx: Tx, groupId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "SocialGroup" WHERE "id" = ${groupId} FOR UPDATE`;
  return rows.length > 0;
}

/** Een unieke sleutel die al bestond (dubbel verzoek tegelijk). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * De dagstatus van personen voor dag D, uitsluitend uit hun persoonlijke
 * reeks (StreakDay en de reeksvelden op User). Twee queries, ook voor 500
 * leden.
 */
export async function memberDayStates(db: Db, userIds: string[], dayKey: string, now: Date): Promise<Map<string, MemberDayOutcome>> {
  const result = new Map<string, MemberDayOutcome>();
  if (userIds.length === 0) return result;
  const [users, days] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, timeZone: true, lastStudyDate: true, lastStudyTimeZone: true, currentStreak: true, streakInterruptedDay: true },
    }),
    db.streakDay.findMany({ where: { userId: { in: userIds }, dayKey }, select: { userId: true } }),
  ]);
  const kept = new Set(days.map((d) => d.userId));
  for (const user of users) result.set(user.id, memberDayOutcome({ ...user, kept: kept.has(user.id) }, dayKey, now));
  return result;
}

/** Welke van deze personen hebben dag D behouden (gestudeerd of bevroren)? */
export async function keptOn(db: Db, userIds: string[], dayKey: string): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db.streakDay.findMany({ where: { userId: { in: userIds }, dayKey }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId));
}

export type SocialEventKind =
  | "GROUP_CREATED"
  | "MEMBER_JOINED"
  | "MEMBER_LEFT"
  | "MEMBER_REMOVED"
  | "ADMIN_PROMOTED"
  | "ADMIN_DEMOTED"
  | "ADMIN_INACTIVE_DEMOTED"
  | "ADMIN_AUTO_PROMOTED"
  | "GROUP_STREAK_STARTED"
  | "GROUP_DAY_ACHIEVED"
  | "GROUP_PERFECT_DAY"
  | "GROUP_MILESTONE"
  | "GROUP_STREAK_INTERRUPTED"
  | "GROUP_STREAK_CONTINUED"
  | "GROUP_MEMBER_PAUSED"
  | "GROUP_MEMBER_PAUSE_ENDED"
  | "GROUP_PAUSED"
  | "GROUP_RESUMED"
  | "FREEZE_OFFERED"
  | "FREEZE_RELEASED"
  | "FREEZE_CANCELLED"
  | "FREEZE_USED"
  | "GROUP_ACHIEVEMENT"
  | "FRIEND_STREAK_STARTED"
  | "FRIEND_STREAK_DAY"
  | "FRIEND_STREAK_MILESTONE"
  | "FRIEND_STREAK_BROKEN"
  | "FRIEND_STREAK_ENDED"
  | "GROUP_LINK_ENABLED"
  | "GROUP_LINK_REVOKED"
  | "JOIN_REQUESTED"
  | "JOIN_APPROVED"
  | "JOIN_DECLINED";

/** Legt een gebeurtenis vast voor een latere tijdlijn van een groep of vriendenreeks. */
export async function recordSocialEvent(
  db: Db,
  event: { kind: SocialEventKind; groupId?: string; friendStreakId?: string; userId?: string | null; dayKey?: string | null; data?: Record<string, unknown> }
): Promise<void> {
  await db.socialEvent.create({
    data: {
      kind: event.kind,
      groupId: event.groupId,
      friendStreakId: event.friendStreakId,
      userId: event.userId ?? null,
      dayKey: event.dayKey ?? null,
      data: event.data ? JSON.stringify(event.data) : null,
    },
  });
}

/** "Jan#83" zoals overal in de app; de naam zelf voor meldingen. */
export interface PersonSummary {
  id: string;
  handle: string;
  discriminator: string;
  avatarEmoji: string | null;
}

export const personSelect = { id: true, handle: true, discriminator: true, avatarEmoji: true } as const;
