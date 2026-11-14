import { formatElapsedDutch } from "@/lib/dates";
import { prisma } from "@/lib/db";
import type { Server as SocketIOServer } from "socket.io";

import type { Prisma } from "@/generated/prisma/client";
import { type IncognitoDurationHours } from "./presenceRules";
export { INCOGNITO_DURATIONS_HOURS,type IncognitoDurationHours } from "./presenceRules";

const MAX_ACTIVITY_LABEL_LENGTH = 60;

// In-memory, per userId — bewust niet in Postgres (zie de toelichting bij
// User.shareCurrentActivity in schema.prisma): een activiteit is vluchtig,
// en dit zou anders bij elke paginanavigatie een databaseschrijving
// betekenen. Zelfde aanpak als de al bestaande RoomState-map in
// gameServer.ts — geldt dus ook dezelfde beperking: correct bij precies één
// actieve app-instantie (zie de Redis-toelichting daar voor het
// multi-instance-scenario).
const currentActivity = new Map<string, { icon: string; label: string }>();

/** Nooit een technisch ID doorgeven — de aanroeper stelt zelf al een
 * herkenbaar label samen (bv. "Leest Alma 32"), dit bestand valideert alleen
 * lengte/aanwezigheid. */
export function setCurrentActivity(userId: string, icon: string, label: string): void {
  const trimmed = label.trim().slice(0, MAX_ACTIVITY_LABEL_LENGTH);
  if (!trimmed) return;
  currentActivity.set(userId, { icon, label: trimmed });
}

export function clearCurrentActivity(userId: string): void {
  currentActivity.delete(userId);
}

export interface FriendStatusView {
  online: boolean;
  activity?: { icon: string; label: string };
  lastSeenLabel?: string;
}

interface PresenceRow {
  id: string;
  shareOnlineStatus: boolean;
  shareCurrentActivity: boolean;
  invisibleUntil: Date | null;
  onlineSocketCount: number;
  lastSeenAt: Date | null;
}

export const PRESENCE_SELECT = {
  id: true,
  shareOnlineStatus: true,
  shareCurrentActivity: true,
  invisibleUntil: true,
  onlineSocketCount: true,
  lastSeenAt: true,
} as const;

/**
 * Wat vrienden van deze gebruiker mogen zien — puur op basis van diens eigen
 * instellingen, ongeacht wie er kijkt (voor de zichtbaarheid maakt het niet
 * uit WELKE vriend kijkt, dus één berekening per gebruiker volstaat). Geeft
 * `null` terug als er niets getoond mag worden (uitgeschakeld of incognito)
 * — de aanroeper moet dat als "niets tonen" behandelen, nooit als "offline
 * tonen": ook "offline" is al informatie die niet gedeeld is.
 */
export function computeFriendStatus(user: PresenceRow): FriendStatusView | null {
  if (!user.shareOnlineStatus) return null;
  if (user.invisibleUntil && user.invisibleUntil > new Date()) return null;

  const online = user.onlineSocketCount > 0;
  const view: FriendStatusView = { online };

  if (online && user.shareCurrentActivity) {
    const activity = currentActivity.get(user.id);
    if (activity) view.activity = activity;
  }
  if (!online && user.lastSeenAt) {
    view.lastSeenLabel = formatElapsedDutch(user.lastSeenAt);
  }
  return view;
}

export async function getAcceptedFriendIds(userId: string): Promise<string[]> {
  const friendships = await prisma.friendship.findMany({
    where: { status: "ACCEPTED", OR: [{ senderId: userId }, { receiverId: userId }] },
    select: { senderId: true, receiverId: true },
  });
  return friendships.map((f) => (f.senderId === userId ? f.receiverId : f.senderId));
}

/** Voor het initieel laden van de vriendenlijst — één keer alle statussen
 * tegelijk berekenen i.p.v. per vriend een broadcast te simuleren. */
export async function getFriendStatusMap(
  friendIds: string[],
  viewerCanSeePresence = true,
): Promise<Record<string, FriendStatusView>> {
  if (!viewerCanSeePresence || friendIds.length === 0) return {};
  const users = await prisma.user.findMany({ where: { id: { in: friendIds } }, select: PRESENCE_SELECT });
  const map: Record<string, FriendStatusView> = {};
  for (const u of users) {
    const status = computeFriendStatus(u);
    if (status) map[u.id] = status;
  }
  return map;
}

/**
 * Pusht de actuele status van `userId` naar alle geaccepteerde vrienden die
 * nu verbonden zijn — via de al bestaande, altijd-open `user:${id}`-room
 * (zie initGameServer in gameServer.ts), dus geen aparte
 * "volg-deze-vriend"-room nodig en de update komt aan ongeacht welke pagina
 * die vriend open heeft staan. `hidden: true` betekent expliciet "laat niets
 * (meer) zien" (bv. na het uitzetten van delen, of bij incognito) i.p.v.
 * gewoon niets te sturen — anders zou een vriend een ingetrokken status
 * kunnen blijven tonen totdat die zelf de pagina ververst.
 */
export async function broadcastPresenceUpdate(io: SocketIOServer | null, userId: string): Promise<void> {
  if (!io) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: PRESENCE_SELECT });
  if (!user) return;

  const status = computeFriendStatus(user);
  const friendIds = await getAcceptedFriendIds(userId);
  const viewers = await prisma.user.findMany({
    where: { id: { in: friendIds }, shareOnlineStatus: true },
    select: { id: true },
  });
  const payload = status ? { userId, hidden: false as const, ...status } : { userId, hidden: true as const };
  for (const viewer of viewers) {
    io.to(`user:${viewer.id}`).emit("friend_status_update", payload);
  }
}

// "X is nu online" alleen bij echt online komen, niet bij een korte
// herverbinding (telefoon even in slaap, pagina herladen): wie minder dan dit
// offline was, wordt niet opnieuw aangekondigd.
const ONLINE_NOTICE_MIN_OFFLINE_MS = 2 * 60 * 1000;
// Na een herstart van de server (nieuwe versie) verbindt iedereen tegelijk
// opnieuw; zonder deze stilteperiode zou dat een golf meldingen geven.
const ONLINE_NOTICE_QUIET_AFTER_START_MS = 90 * 1000;
const presenceModuleLoadedAt = Date.now();

/**
 * Meldt vrienden die nu online zijn dat `userId` online is gekomen (eerste
 * verbinding, na minstens een paar minuten offline). Zelfde privacyregels als
 * broadcastPresenceUpdate: alleen als deze gebruiker zijn status deelt (en
 * niet incognito is), en alleen aan vrienden die hun eigen status ook delen.
 * Geen pushmelding: wie de app niet open heeft, krijgt niets.
 */
export async function announceCameOnline(
  io: SocketIOServer | null,
  userId: string,
  previousSeenAt: Date | null
): Promise<void> {
  if (!io || Date.now() - presenceModuleLoadedAt < ONLINE_NOTICE_QUIET_AFTER_START_MS) return;
  if (previousSeenAt && Date.now() - previousSeenAt.getTime() < ONLINE_NOTICE_MIN_OFFLINE_MS) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { ...PRESENCE_SELECT, handle: true } });
  if (!user || !computeFriendStatus(user)?.online) return;

  const friendIds = await getAcceptedFriendIds(userId);
  const viewers = await prisma.user.findMany({
    where: { id: { in: friendIds }, shareOnlineStatus: true, notifyFriendOnline: true, onlineSocketCount: { gt: 0 } },
    select: { id: true },
  });
  for (const viewer of viewers) {
    io.to(`user:${viewer.id}`).emit("friend_online", { userId, name: user.handle });
  }
}

/**
 * Stuurt alle actuele vriendstatussen naar één gebruiker. Dit wordt gebruikt
 * wanneer iemand zijn eigen online-status delen aanzet: pas dan mag diegene
 * ook de status van vrienden zien.
 */
export async function sendFriendStatusesToUser(io: SocketIOServer | null, userId: string): Promise<void> {
  if (!io) return;
  const viewer = await prisma.user.findUnique({ where: { id: userId }, select: { shareOnlineStatus: true } });
  if (!viewer) return;

  if (!viewer.shareOnlineStatus) {
    io.to(`user:${userId}`).emit("friend_status_reset");
    return;
  }

  const friendIds = await getAcceptedFriendIds(userId);
  if (friendIds.length === 0) return;
  const users = await prisma.user.findMany({ where: { id: { in: friendIds } }, select: PRESENCE_SELECT });
  for (const friend of users) {
    const status = computeFriendStatus(friend);
    const payload = status
      ? { userId: friend.id, hidden: false as const, ...status }
      : { userId: friend.id, hidden: true as const };
    io.to(`user:${userId}`).emit("friend_status_update", payload);
  }
}

/** Zet incognito aan (met vervaltijd) of uit (hours = null). */
export async function setIncognito(userId: string, hours: IncognitoDurationHours | null, db: Pick<Prisma.TransactionClient, "user"> = prisma): Promise<void> {
  const invisibleUntil = hours === null ? null : new Date(Date.now() + hours * 60 * 60 * 1000);
  await db.user.update({ where: { id: userId }, data: { invisibleUntil } });
}
