import { prisma } from "@/lib/db";
import { getActiveGameStatus, type ActivityItem } from "@/lib/activeGames";
import { visibleJoinRequests } from "@/lib/social/joinLinks";

// Eén afgeleide weergave van bestaande uitnodigingen en spellen. Er wordt
// bewust niets opgeslagen: de oorspronkelijke tabellen en spelservices
// blijven de bron van waarheid en voeren bij elke handeling hun eigen
// autorisatie opnieuw uit.
export type OpenActionTab = "required" | "continue" | "waiting";
export type OpenActionKind =
  | "friend-request"
  | "group-invite"
  | "group-request"
  | "game-invite"
  | "live-invite"
  | "game-turn"
  | "game-continue"
  | "game-waiting";

export interface OpenAction {
  key: string;
  tab: OpenActionTab;
  kind: OpenActionKind;
  at: string;
  person: { id: string; handle: string } | null;
  subject: string;
  href: string;
  contentCollectionId?: string;
  game?: ActivityItem["kind"];
  gameCode?: string;
  actionId?: string;
  groupId?: string;
}

export interface OpenActionsData {
  items: Record<OpenActionTab, OpenAction[]>;
  counts: Record<OpenActionTab, number>;
  activeContentCollectionId: string;
}

const tabs: OpenActionTab[] = ["required", "continue", "waiting"];

function newest(a: OpenAction, b: OpenAction) {
  return b.at.localeCompare(a.at) || a.key.localeCompare(b.key);
}

function requiredOrder(a: OpenAction, b: OpenAction) {
  const rank = (item: OpenAction) =>
    item.kind === "friend-request" || item.kind === "group-invite" || item.kind === "group-request" || item.kind === "live-invite" || item.kind === "game-invite" ? 1 : 2;
  return rank(a) - rank(b) || newest(a, b);
}

function gamePerson(item: ActivityItem) {
  return item.opponentId && item.opponentName ? { id: item.opponentId, handle: item.opponentName } : null;
}

function gameAction(item: ActivityItem, tab: OpenActionTab, kind: OpenActionKind): OpenAction {
  return {
    key: `${kind}-${item.kind}-${item.id}`,
    tab,
    kind,
    at: item.at,
    person: gamePerson(item),
    subject: item.label,
    href: item.playLink ?? item.link,
    contentCollectionId: item.contentCollectionId,
    game: item.kind,
    gameCode: item.code,
    actionId: item.id,
  };
}

/**
 * Geeft alle open, uitvoerbare acties van één gebruiker terug. Deze functie
 * is ook de serverbron voor Vandaag; compacte blokken knippen pas ná de
 * telling, zodat een zichtbare limiet nooit de werkelijke teller beïnvloedt.
 */
export async function getOpenActions(user: { id: string; uiLanguage: string | null }): Promise<OpenActionsData> {
  const [games, friendRequests, groupInvites, memberships] = await Promise.all([
    getActiveGameStatus(user),
    prisma.friendship.findMany({
      where: { receiverId: user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, sender: { select: { id: true, handle: true } } },
    }),
    prisma.groupInvite.findMany({
      where: { inviteeId: user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, inviter: { select: { id: true, handle: true } }, group: { select: { id: true, name: true } } },
    }),
    prisma.groupMembership.findMany({ where: { userId: user.id, leftAt: null }, select: { groupId: true } }),
  ]);

  const required: OpenAction[] = [
    ...friendRequests.map((request) => ({
      key: `friend-request-${request.id}`,
      tab: "required" as const,
      kind: "friend-request" as const,
      at: request.createdAt.toISOString(),
      person: request.sender,
      subject: "",
      href: "/friends",
      actionId: request.id,
    })),
    ...groupInvites.map((invite) => ({
      key: `group-invite-${invite.id}`,
      tab: "required" as const,
      kind: "group-invite" as const,
      at: invite.createdAt.toISOString(),
      person: invite.inviter,
      subject: invite.group.name,
      href: "/groups",
      actionId: invite.id,
      groupId: invite.group.id,
    })),
    ...games.liveInvitesReceived.map((item) => gameAction(item, "required", "live-invite")),
    ...games.invitesReceived.map((item) => gameAction(item, "required", "game-invite")),
    ...games.activeGames
      .filter((item) => item.myTurn === true)
      .map((item) => gameAction(item, "required", "game-turn")),
  ];

  // visibleJoinRequests bevat exact dezelfde rechtencontrole als het
  // groepsscherm. Hooguit tien groepen per gebruiker, dus dit is begrensd en
  // voorkomt dat een gewoon lid verzoeken van onbekenden ziet.
  const requestLists = await Promise.all(memberships.map((membership) => visibleJoinRequests(membership.groupId, user.id)));
  for (let index = 0; index < memberships.length; index++) {
    for (const request of requestLists[index]) {
      required.push({
        key: `group-request-${request.id}`,
        tab: "required",
        kind: "group-request",
        at: request.createdAt,
        person: request.person,
        subject: "",
        href: `/groups/${memberships[index].groupId}`,
        actionId: request.id,
        groupId: memberships[index].groupId,
      });
    }
  }

  const continuing = games.activeGames
    .filter((item) => item.myTurn !== false && item.myTurn !== true)
    .map((item) => gameAction(item, "continue", "game-continue"));
  const waiting = [
    ...games.invitesSent.map((item) => gameAction(item, "waiting", "game-waiting")),
    ...games.activeGames.filter((item) => item.myTurn === false).map((item) => gameAction(item, "waiting", "game-waiting")),
  ];

  const items = {
    required: required.sort(requiredOrder),
    continue: continuing.sort(newest),
    waiting: waiting.sort(newest),
  };
  // Een defensieve deduplicatie houdt hetzelfde bestaande record nooit twee
  // keer zichtbaar als een spelservice later meerdere representaties krijgt.
  for (const tab of tabs) {
    const keys = new Set<string>();
    items[tab] = items[tab].filter((item) => !keys.has(item.key) && (keys.add(item.key), true));
  }
  return {
    items,
    counts: { required: items.required.length, continue: items.continue.length, waiting: items.waiting.length },
    activeContentCollectionId: games.activeContentCollectionId,
  };
}

export function compactOpenActions(data: OpenActionsData, tab: OpenActionTab, limit = 3) {
  return { actions: data.items[tab].slice(0, limit), total: data.counts[tab] };
}
