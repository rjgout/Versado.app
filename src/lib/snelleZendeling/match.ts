import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { emitToUser, notifyMatchChanged } from "@/lib/realtime";
import { companionToMascot } from "@/lib/companion";
import type { PersonalMascotCharacter } from "@/lib/mascots";
import { dayKeyInZone, resolveTimeZone } from "@/lib/timeZone";
import { MATCH_COUNTDOWN_MS, validateSharedScore } from "./sharedWorld";
import { decideMatch, deriveDuo, participantState, type MatchDecision, type ParticipantState } from "./matchRules";

// De levenscyclus van een gezamenlijke run (Samen spelen), server-autoritatief.
// Dit bestand mag niet uit runs.ts importeren: de socketserver (en dus de
// eager-importketen van server.ts) laadt het, runs.ts hoort bij de routes.
//
// Samenloop: elke wijziging van de toestand van een deelnemer gebeurt in één
// transactie die eerst de wedstrijd vergrendelt (SELECT ... FOR UPDATE), dan de
// run, dan de gebruiker. Zo krijgt elke eliminatie een eigen volgnummer, ziet
// elke beslissing "is de run voorbij" een consistente stand, en wordt de
// afsluiting (inclusief het duo-resultaat) precies één keer vastgelegd.

type Tx = Prisma.TransactionClient;

/** Zonder teken van leven valt een vliegende speler hierna af. */
export const ACTIVE_GRACE_MS = 20_000;
/** Een speler die een Genees-vraag beantwoordt krijgt meer lucht (lezen, verbinding herstellen). */
export const PENDING_GRACE_MS = 90_000;

export type EliminationHow = "CRASH" | "GENEES_WRONG" | "GAVE_UP" | "DISCONNECT" | "RUN_ENDED";

/** Kanaal van een lopende gezamenlijke run; de socketmodule (src/server/quickMissionary.ts) laat spelers erin. */
export function matchChannel(gameCode: string): string {
  return `qm:${gameCode}`;
}

export interface MatchAnnouncement {
  code: string;
  /** Gezet zodra de wedstrijd is afgesloten: wie "actief spel" moet laten verdwijnen. */
  endedFor: string[] | null;
}

/**
 * Laat de socketmodule de nieuwe wedstrijdstand naar de room sturen en laat bij
 * een afsluiting de actieve-spellenlijst van de deelnemers verversen.
 */
export function announceMatchChanged(announcement: MatchAnnouncement | null): void {
  if (!announcement) return;
  notifyMatchChanged(announcement.code);
  for (const userId of announcement.endedFor ?? []) emitToUser(userId, "game_left", { code: announcement.code });
}

export async function lockMatch(tx: Tx, matchId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "QuickMissionaryMatch" WHERE "id" = ${matchId} FOR UPDATE`;
}

export interface ParticipantRow {
  id: string;
  userId: string;
  status: "IN_PROGRESS" | "DEAD_AWAITING_REVIVE" | "REVIVE_READY" | "FINISHED";
  score: number;
  eliminatedSeq: number | null;
}

export function stateOfRun(run: Pick<ParticipantRow, "status" | "eliminatedSeq">): ParticipantState {
  return participantState(run);
}

/** Zet een run definitief af, onder de wedstrijdvergrendeling; geeft het volgnummer terug. */
export async function eliminateRun(tx: Tx, matchId: string, runId: string, how: EliminationHow, at: Date): Promise<number> {
  const match = await tx.quickMissionaryMatch.update({ where: { id: matchId }, data: { eliminationCount: { increment: 1 } }, select: { eliminationCount: true } });
  await tx.quickMissionaryRun.update({
    where: { id: runId },
    data: { status: "FINISHED", finishedAt: at, eliminatedSeq: match.eliminationCount, eliminatedHow: how, reviveExerciseId: null, reviveOptionIds: null },
  });
  return match.eliminationCount;
}

export interface SettleResult {
  ended: boolean;
  decision: MatchDecision;
}

/**
 * Beslist na elke toestandswijziging of de run voorbij is en sluit hem dan af:
 * wie nog op een Genees wachtte kan niet meer terugkomen (nooit resurrecten na
 * afsluiting), de overlevende stopt met zijn score zoals die was (geen bonus),
 * het duo-resultaat wordt aangemaakt. Idempotent: een al afgesloten wedstrijd
 * doet niets, dus een dubbele aanroep maakt nooit een tweede duo-rij.
 * De aanroeper heeft de wedstrijd al vergrendeld.
 */
export async function settleMatch(tx: Tx, matchId: string, at: Date): Promise<SettleResult> {
  const match = await tx.quickMissionaryMatch.findUniqueOrThrow({ where: { id: matchId } });
  if (match.status === "ENDED") return { ended: true, decision: { over: true, reason: (match.endReason as "LAST_STANDING" | "NOBODY_FLYING") ?? "NOBODY_FLYING", survivorId: null, voidedIds: [] } };

  const runs = await tx.quickMissionaryRun.findMany({ where: { matchId }, select: { id: true, userId: true, status: true, score: true, eliminatedSeq: true, user: { select: { timeZone: true } } } });
  const decision = decideMatch(runs.map((run) => ({ userId: run.userId, state: participantState(run), reviveGranted: run.status === "REVIVE_READY" })));
  if (!decision.over) return { ended: false, decision };

  for (const run of runs) {
    if (run.status === "FINISHED") continue;
    if (decision.voidedIds.includes(run.userId)) {
      await eliminateRun(tx, matchId, run.id, "RUN_ENDED", at);
    } else {
      // De overlevende (ACTIVE of met een al verdiende Genees): de run stopt, de score blijft.
      await tx.quickMissionaryRun.update({ where: { id: run.id }, data: { status: "FINISHED", finishedAt: at, reviveExerciseId: null, reviveOptionIds: null } });
    }
  }

  const finalRuns = await tx.quickMissionaryRun.findMany({ where: { matchId }, select: { userId: true, score: true, eliminatedSeq: true } });
  await tx.quickMissionaryMatch.update({ where: { id: matchId }, data: { status: "ENDED", endedAt: at, endReason: decision.reason } });
  // Het lobbyrecord sluit mee, zodat de run niet eindeloos als "actief spel" blijft staan.
  await tx.liveGame.update({ where: { id: match.liveGameId }, data: { status: "FINISHED" } });
  const duo = deriveDuo(finalRuns);
  if (duo) {
    await tx.quickMissionaryDuoResult.create({
      data: {
        matchId,
        userAId: duo.a.userId,
        userBId: duo.b.userId,
        scoreA: duo.a.score,
        scoreB: duo.b.score,
        participantCount: finalRuns.length,
        finishedAt: at,
      },
    });
  }
  return { ended: true, decision };
}

// --- Starten -----------------------------------------------------------------

export type StartMatchError = "NOT_FOUND" | "NOT_HOST" | "INVALID_STATE" | "TOO_FEW_PLAYERS";

export async function startMatch(gameId: string, hostId: string, at: Date = new Date()): Promise<{ ok: true; matchId: string; startsAt: Date; userIds: string[] } | { ok: false; error: StartMatchError }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "LiveGame" WHERE "id" = ${gameId} FOR UPDATE`;
    const game = await tx.liveGame.findUnique({
      where: { id: gameId },
      select: { id: true, hostId: true, mode: true, status: true, quickMissionaryMatch: { select: { id: true } }, players: { select: { userId: true, user: { select: { timeZone: true } } } } },
    });
    if (!game || game.mode !== "QUICK_MISSIONARY") return { ok: false as const, error: "NOT_FOUND" as const };
    if (game.hostId !== hostId) return { ok: false as const, error: "NOT_HOST" as const };
    if (game.status !== "LOBBY" || game.quickMissionaryMatch) return { ok: false as const, error: "INVALID_STATE" as const };
    if (game.players.length < 2) return { ok: false as const, error: "TOO_FEW_PLAYERS" as const };

    const startsAt = new Date(at.getTime() + MATCH_COUNTDOWN_MS);
    const match = await tx.quickMissionaryMatch.create({
      data: { liveGameId: game.id, seed: randomBytes(16).toString("hex"), startsAt, participantCount: game.players.length },
    });
    await tx.quickMissionaryRun.createMany({
      data: game.players.map((player) => ({ userId: player.userId, matchId: match.id, dayKey: dayKeyInZone(at, resolveTimeZone(player.user.timeZone)), lastSeenAt: startsAt })),
    });
    await tx.liveGame.update({ where: { id: game.id }, data: { status: "IN_PROGRESS" } });
    return { ok: true as const, matchId: match.id, startsAt, userIds: game.players.map((player) => player.userId) };
  });
}

// --- Teken van leven en score ---------------------------------------------------

/**
 * Een hartslag van de client: laat zien dat de speler er nog is en bewaart zijn
 * score als die plausibel is op de gezamenlijke tijdlijn. Bewust zonder
 * wedstrijdvergrendeling (komt vaak): één voorwaardelijke update. Een speler die
 * al is afgevallen of voor wie de run is afgelopen (status FINISHED) wordt nooit
 * meer gewijzigd, dus een late hartslag verandert de uitslag niet.
 */
export async function recordBeat(matchId: string, userId: string, reportedScore: number | null, at: Date = new Date()): Promise<void> {
  const match = await prisma.quickMissionaryMatch.findUnique({ where: { id: matchId }, select: { startsAt: true, status: true } });
  if (!match || match.status !== "RUNNING") return;
  const run = await prisma.quickMissionaryRun.findFirst({ where: { matchId, userId }, select: { id: true, score: true, status: true } });
  if (!run || run.status === "FINISHED") return;
  let score: number | null = null;
  if (reportedScore !== null && run.status === "IN_PROGRESS") {
    const check = validateSharedScore(match.startsAt, at, run.score, reportedScore);
    if (check.ok) score = check.score;
  }
  await prisma.quickMissionaryRun.updateMany({
    where: { id: run.id, status: { not: "FINISHED" } },
    data: { lastSeenAt: at, ...(score !== null && score > run.score ? { score } : {}) },
  });
}

/**
 * Wie te lang niets van zich liet horen valt af, zodat de rest niet op een
 * verdwenen speler wacht. Een herverbinding binnen de wachttijd verandert niets:
 * de toestand staat in de database. Geeft de uitkomst terug als er iets veranderde.
 */
export async function sweepStalePlayers(matchId: string, at: Date = new Date()): Promise<SettleResult | null> {
  return prisma.$transaction(async (tx) => {
    await lockMatch(tx, matchId);
    const match = await tx.quickMissionaryMatch.findUnique({ where: { id: matchId }, select: { status: true } });
    if (!match || match.status !== "RUNNING") return null;
    const runs = await tx.quickMissionaryRun.findMany({ where: { matchId, status: { not: "FINISHED" } }, select: { id: true, status: true, lastSeenAt: true } });
    let changed = false;
    for (const run of runs) {
      const limit = run.status === "IN_PROGRESS" ? ACTIVE_GRACE_MS : PENDING_GRACE_MS;
      if (run.lastSeenAt && at.getTime() - run.lastSeenAt.getTime() > limit) {
        await eliminateRun(tx, matchId, run.id, "DISCONNECT", at);
        changed = true;
      }
    }
    return changed ? settleMatch(tx, matchId, at) : null;
  });
}

// --- Weergave voor de clients ---------------------------------------------------

export interface MatchParticipantView {
  userId: string;
  handle: string;
  discriminator: string;
  /** De gids van deze speler (cosmetisch): iedereen vliegt met zijn eigen gids. */
  character: PersonalMascotCharacter;
  state: ParticipantState;
  score: number;
  /** Plaats in de volgorde van afvallen (1 = eerst); null zolang hij meedoet of als overlevende. */
  eliminatedSeq: number | null;
  runId: string;
}

export interface MatchView {
  matchId: string;
  gameCode: string;
  hostId: string;
  seed: string;
  startsAt: string;
  serverNow: string;
  status: "RUNNING" | "ENDED";
  endReason: string | null;
  participantCount: number;
  participants: MatchParticipantView[];
  /** De laatste twee (alleen na afloop). */
  duo: { userAId: string; userBId: string; scoreA: number; scoreB: number } | null;
}

/** Wat de socketmodule naar iedereen in de room stuurt (lobby en wedstrijd). */
export interface RoomPayload {
  /** Oplopend per room, op het moment van versturen: een oudere stand overschrijft nooit een nieuwere. */
  seq: number;
  phase: "lobby" | "running" | "ended";
  hostId: string;
  code: string;
  players: { id: string; handle: string; discriminator: string }[];
  match: MatchView | null;
}

export async function getMatchView(matchId: string, at: Date = new Date()): Promise<MatchView | null> {
  const match = await prisma.quickMissionaryMatch.findUnique({
    where: { id: matchId },
    select: {
      id: true, seed: true, startsAt: true, status: true, endReason: true, participantCount: true,
      liveGame: { select: { code: true, hostId: true } },
      duo: { select: { userAId: true, userBId: true, scoreA: true, scoreB: true } },
      // Vaste volgorde: de renderlijst van de clients springt niet door een wisselende query-volgorde.
      runs: { orderBy: { id: "asc" }, select: { id: true, userId: true, status: true, score: true, eliminatedSeq: true, user: { select: { handle: true, discriminator: true, companion: true } } } },
    },
  });
  if (!match) return null;
  return {
    matchId: match.id,
    gameCode: match.liveGame.code,
    hostId: match.liveGame.hostId,
    seed: match.seed,
    startsAt: match.startsAt.toISOString(),
    serverNow: at.toISOString(),
    status: match.status,
    endReason: match.endReason,
    participantCount: match.participantCount,
    participants: match.runs.map((run) => ({
      userId: run.userId,
      handle: run.user.handle,
      discriminator: run.user.discriminator,
      character: companionToMascot(run.user.companion),
      state: participantState(run),
      score: run.score,
      eliminatedSeq: run.eliminatedSeq,
      runId: run.id,
    })),
    duo: match.duo,
  };
}

export async function findMatchIdByGameCode(code: string): Promise<string | null> {
  const game = await prisma.liveGame.findUnique({ where: { code }, select: { quickMissionaryMatch: { select: { id: true } } } });
  return game?.quickMissionaryMatch?.id ?? null;
}
