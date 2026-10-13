import { prisma } from "@/lib/db";
import type { ActivityItem } from "@/lib/activeGames";

// Gezamenlijke puzzels en wedstrijden als regels voor "Actieve spellen" en de
// open acties op Vandaag. Niets wordt opgeslagen: de puzzeltabellen blijven de
// bron van waarheid. Geen next/headers (wordt geladen via de gedeelde statusroute).
//
// Betekenis van `myTurn`: true = er wacht een handeling op jou (begin jouw
// wedstrijdpuzzel), null = je kunt verder, false = jij bent klaar en wacht op anderen.

type Translate = (key: "activeGames.puzzleCoop" | "activeGames.puzzleMatch", values?: Record<string, string | number>) => string;

export interface PuzzleActivity { invitesReceived: ActivityItem[]; invitesSent: ActivityItem[]; activeGames: ActivityItem[] }

export async function getPuzzleActivity(userId: string, t: Translate, contentCollectionId: string | undefined, now = new Date()): Promise<PuzzleActivity> {
  const [sessions, received, sent, matches] = await Promise.all([
    prisma.puzzleSession.findMany({
      where: { mode: "COOP", status: "ACTIVE", participants: { some: { userId } } },
      orderBy: { lastActivityAt: "desc" }, take: 10,
      select: { id: true, lastActivityAt: true, variant: { select: { pieceCount: true } }, participants: { where: { userId: { not: userId } }, select: { user: { select: { id: true, handle: true } } } } },
    }),
    prisma.puzzleInvite.findMany({
      where: { kind: "COOP", toUserId: userId, status: "PENDING", expiresAt: { gt: now }, session: { status: "ACTIVE" } },
      orderBy: { createdAt: "desc" }, take: 10,
      select: { id: true, sessionId: true, createdAt: true, from: { select: { id: true, handle: true } }, session: { select: { variant: { select: { pieceCount: true } } } } },
    }),
    prisma.puzzleInvite.findMany({
      where: { kind: "COOP", fromUserId: userId, status: "PENDING", expiresAt: { gt: now }, session: { status: "ACTIVE" } },
      orderBy: { createdAt: "desc" }, take: 10,
      select: { id: true, sessionId: true, createdAt: true, to: { select: { id: true, handle: true } }, session: { select: { variant: { select: { pieceCount: true } } } } },
    }),
    prisma.puzzleMatchParticipant.findMany({
      where: { userId, status: { notIn: ["DECLINED", "DNF"] }, match: { status: { in: ["LOBBY", "RUNNING"] } } },
      orderBy: { createdAt: "desc" }, take: 10,
      select: { status: true, match: { select: { id: true, kind: true, status: true, createdAt: true, playDeadline: true, organizer: { select: { id: true, handle: true } }, variant: { select: { pieceCount: true } }, participants: { select: { status: true, user: { select: { id: true, handle: true } } } } } } },
    }),
  ]);

  const result: PuzzleActivity = { invitesReceived: [], invitesSent: [], activeGames: [] };
  const coopLabel = (pieces: number) => t("activeGames.puzzleCoop", { n: pieces });
  const matchLabel = (pieces: number) => t("activeGames.puzzleMatch", { n: pieces });

  for (const invite of received) {
    result.invitesReceived.push({ kind: "puzzle-coop", id: invite.id, opponentName: invite.from.handle, opponentId: invite.from.id, label: coopLabel(invite.session?.variant.pieceCount ?? 0), link: "/jigsaw", myTurn: null, contentCollectionId, at: invite.createdAt.toISOString() });
  }
  for (const invite of sent) {
    result.invitesSent.push({ kind: "puzzle-coop", id: invite.id, opponentName: invite.to.handle, opponentId: invite.to.id, label: coopLabel(invite.session?.variant.pieceCount ?? 0), link: `/jigsaw/samen/${invite.sessionId}`, myTurn: null, contentCollectionId, at: invite.createdAt.toISOString() });
  }
  for (const session of sessions) {
    const other = session.participants[0]?.user ?? null;
    result.activeGames.push({ kind: "puzzle-coop", id: session.id, opponentName: other?.handle ?? null, opponentId: other?.id ?? null, label: coopLabel(session.variant.pieceCount), link: `/jigsaw/samen/${session.id}`, myTurn: null, contentCollectionId, at: session.lastActivityAt.toISOString() });
  }
  for (const row of matches) {
    const match = row.match; const link = `/jigsaw/wedstrijd/${match.id}`; const label = matchLabel(match.variant.pieceCount);
    const base = { kind: "puzzle-match" as const, label, link, contentCollectionId, at: match.createdAt.toISOString() };
    if (row.status === "INVITED") {
      result.invitesReceived.push({ ...base, id: match.id, opponentName: match.organizer.handle, opponentId: match.organizer.id, myTurn: null });
      continue;
    }
    if (match.organizer.id === userId) {
      for (const p of match.participants) if (p.status === "INVITED") result.invitesSent.push({ ...base, id: match.id, opponentName: p.user.handle, opponentId: p.user.id, myTurn: null });
    }
    const other = match.participants.find((p) => p.user.id !== userId)?.user ?? null;
    // Klaar (puzzel voltooid, of onder de oude regels beantwoord): geen "verder puzzelen" meer, alleen wachten op de anderen.
    const finishedMine = row.status === "FINISHED" || row.status === "INVALID";
    // Asynchroon en geaccepteerd: "Begin jouw puzzel" wacht op jou. Klaar: je wacht op de anderen.
    const myTurn = finishedMine ? false : match.kind === "ASYNC" && match.status === "RUNNING" && row.status === "ACCEPTED" && match.playDeadline > now ? true : null;
    result.activeGames.push({ ...base, id: match.id, opponentName: other?.handle ?? null, opponentId: other?.id ?? null, myTurn });
  }
  return result;
}
