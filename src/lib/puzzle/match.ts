import { randomInt } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";
import { completeJigsaw } from "@/lib/streak";
import { jigsawQuestionsForStory, jigsawQuestionById, jigsawQuestionLanguage, JIGSAW_OPTION_COUNT } from "@/lib/jigsawQuestions";
import { connectedPieces, newPuzzleSnapshot } from "@/lib/puzzle/engine";
import { cachedPuzzleGeometry } from "@/lib/puzzle/geometryCache";
import { PuzzleServiceError } from "@/lib/puzzle/errors";
import { sendPuzzleNotice } from "@/lib/puzzle/puzzleNotify";
import { multiplayerConfig } from "@/lib/puzzle/multiplayerConfig";
import { areAcceptedFriends, ensureVariant } from "@/lib/puzzle/variants";
import { applySoloAction, optionOrder, resumeSoloPuzzle, snapshotSchema, sessionInclude, type SoloAction } from "@/lib/puzzle/solo";
import { MATCH_PIECE_COUNTS, type PuzzleDifficulty, type PuzzlePieceCount, type PuzzleSnapshot } from "@/lib/puzzle/types";

// Tegen elkaar: één competitief matchmodel, live of asynchroon. Elke deelnemer
// heeft een eigen PuzzleSession (mode MATCH) op dezelfde variant en dezelfde
// beginverdeling; alle puzzelregels komen uit dezelfde engine als Solo.
//
// Tijd: uitsluitend server-wandtijd. De klok start bij de officiële start van de
// deelnemer (async: wanneer hij op "Begin" drukt; live: het gezamenlijke
// startmoment) en stopt pas bij een correct antwoord op de verplichte vraag
// nadat de puzzel gelegd is. Eén officiële poging per deelnemer.
//
// Beleid voor afhaken/verlopen (zie ook docs/puzzle-v2/18-PHASE-3-MULTIPLAYER-ARCHITECTURE.md):
// - uitnodiging niet geaccepteerd voor de joinDeadline → DECLINED (uitnodiging EXPIRED);
// - geaccepteerd maar niet gestart, of gestart maar niet klaar voor de playDeadline → DNF;
// - puzzel gelegd maar vraag fout → INVALID (geen geldige tijd, wel zichtbaar als "ongeldig");
// - een async wedstrijd met minder dan twee deelnemers op de joinDeadline → CANCELLED;
// - een live lobby die niet start binnen de lobby-TTL → CANCELLED.

type Tx = Prisma.TransactionClient;
const txOptions = { timeout: 20_000, maxWait: 10_000 } as const;
const TERMINAL = ["FINISHED", "INVALID", "DNF", "DECLINED"] as const;
const isTerminal = (status: string) => (TERMINAL as readonly string[]).includes(status);

export interface MatchParticipantView {
  userId: string; handle: string; discriminator: string; status: string;
  /** Live voortgang (verbonden stukken); alleen tijdens een live wedstrijd. */
  progress: number | null;
  /** Resultaat; alleen zichtbaar als de kijker klaar is of de wedstrijd afgelopen is. */
  result: { rank: number | null; elapsedMs: number | null; valid: boolean; hintsUsed: number; extraHintsUsed: number } | null;
  /** Of deze deelnemer klaar is, zonder uitkomst te onthullen (voor "2 van 3 klaar"). */
  done: boolean;
}
export interface MatchView {
  id: string; kind: "LIVE" | "ASYNC"; status: string; organizerId: string;
  image: string; story: number; pieceCount: PuzzlePieceCount; difficulty: PuzzleDifficulty;
  createdAt: string; startsAt: string | null; joinDeadline: string; playDeadline: string; finishedAt: string | null; winnerId: string | null;
  me: { userId: string; status: string; sessionId: string | null; startedAt: string | null; canBegin: boolean; inviteId: string | null; visibleResults: boolean };
  participants: MatchParticipantView[];
  serverNow: number;
}

const matchInclude = { variant: { include: { definition: true } }, participants: { include: { user: { select: { id: true, handle: true, discriminator: true } } }, orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] } } satisfies Prisma.PuzzleMatchInclude;
type MatchRow = Prisma.PuzzleMatchGetPayload<{ include: typeof matchInclude }>;

async function lockMatch(tx: Tx, matchId: string) {
  await tx.$queryRaw`SELECT "id" FROM "PuzzleMatch" WHERE "id" = ${matchId} FOR UPDATE`;
  return tx.puzzleMatch.findUnique({ where: { id: matchId }, include: matchInclude });
}

function deadlineOf(match: { kind: string; startsAt: Date | null; playDeadline: Date }) { return match.playDeadline; }

// --- Aanmaken en uitnodigen ----------------------------------------------------------

export async function createMatch(userId: string, content: number | string, pieceCount: (typeof MATCH_PIECE_COUNTS)[number], difficulty: PuzzleDifficulty, friendIds: string[], kind: "LIVE" | "ASYNC") {
  const config = multiplayerConfig();
  if (!MATCH_PIECE_COUNTS.includes(pieceCount)) throw new PuzzleServiceError("INVALID");
  const invitees = [...new Set(friendIds)].filter((id) => id !== userId);
  if (invitees.length < 1 || invitees.length > config.maxMatchParticipants - 1) throw new PuzzleServiceError("CAPACITY");
  const { definition, variant } = await ensureVariant(content, pieceCount, difficulty);
  const choices = jigsawQuestionsForStory(definition.storyNumber);
  if (!choices.length) throw new PuzzleServiceError("INVALID");
  // Eén vooraf vastgelegde vraag en optievolgorde: alle deelnemers krijgen exact dezelfde.
  const question = choices[randomInt(choices.length)];
  const created = await prisma.$transaction(async (tx) => {
    for (const id of invitees) if (!(await areAcceptedFriends(tx, userId, id))) throw new PuzzleServiceError("NOT_FRIENDS");
    const now = new Date();
    const match = await tx.puzzleMatch.create({ data: {
      organizerId: userId, variantId: variant.id, kind, status: kind === "ASYNC" ? "RUNNING" : "LOBBY", questionId: question.id, optionOrder: JSON.stringify(optionOrder()),
      joinDeadline: new Date(now.getTime() + (kind === "ASYNC" ? config.asyncJoinWindowMs : config.liveLobbyTtlMs)),
      playDeadline: new Date(now.getTime() + (kind === "ASYNC" ? config.asyncPlayWindowMs : config.liveLobbyTtlMs + config.liveCountdownMs + config.liveMaxPlayMs)),
    } });
    await tx.puzzleMatchParticipant.create({ data: { matchId: match.id, userId, status: "ACCEPTED" } });
    for (const id of invitees) {
      await tx.puzzleMatchParticipant.create({ data: { matchId: match.id, userId: id, status: "INVITED" } });
      await tx.puzzleInvite.create({ data: { kind: "MATCH", matchId: match.id, fromUserId: userId, toUserId: id, expiresAt: match.joinDeadline } });
    }
    return { id: match.id, fromHandle: (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { handle: true } })).handle };
  }, txOptions);
  for (const id of invitees) { sendPuzzleNotice(id, { type: "MATCH_INVITE", fromHandle: created.fromHandle, matchId: created.id, live: kind === "LIVE" }); emitToUser(id, "puzzle_invites_changed"); }
  return created.id;
}

export async function respondToMatchInvite(userId: string, matchId: string, accept: boolean) {
  let notice: { to: string; fromHandle: string; accepted: boolean } | null = null;
  await prisma.$transaction(async (tx) => {
    const match = await lockMatch(tx, matchId);
    if (!match) throw new PuzzleServiceError("NOT_FOUND");
    const participant = match.participants.find((p) => p.userId === userId);
    if (!participant) throw new PuzzleServiceError("NOT_FOUND");
    const now = new Date();
    if (participant.status === "ACCEPTED" && accept) return;
    if (participant.status !== "INVITED") throw new PuzzleServiceError("EXPIRED");
    if (match.status !== "LOBBY" && match.status !== "RUNNING") throw new PuzzleServiceError("CLOSED");
    if (match.joinDeadline <= now) throw new PuzzleServiceError("EXPIRED");
    if (match.kind === "LIVE" && match.status !== "LOBBY") throw new PuzzleServiceError("CLOSED");
    const fromHandle = (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { handle: true } })).handle;
    await tx.puzzleMatchParticipant.update({ where: { id: participant.id }, data: { status: accept ? "ACCEPTED" : "DECLINED" } });
    await tx.puzzleInvite.updateMany({ where: { matchId, toUserId: userId, status: "PENDING" }, data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: now } });
    notice = { to: match.organizerId, fromHandle, accepted: accept };
    if (!accept) await finalizeIfDone(tx, match.id, now);
  }, txOptions);
  const result = notice as { to: string; fromHandle: string; accepted: boolean } | null;
  if (result) { sendPuzzleNotice(result.to, { type: result.accepted ? "MATCH_ACCEPTED" : "MATCH_DECLINED", fromHandle: result.fromHandle, matchId }); signalMatch(matchId); }
}

export async function revokeMatchInvite(userId: string, matchId: string, targetUserId: string) {
  let target: { fromHandle: string } | null = null;
  await prisma.$transaction(async (tx) => {
    const match = await lockMatch(tx, matchId);
    if (!match || match.organizerId !== userId) throw new PuzzleServiceError("NOT_FOUND");
    const participant = match.participants.find((p) => p.userId === targetUserId);
    if (!participant || participant.status !== "INVITED") return;
    await tx.puzzleMatchParticipant.update({ where: { id: participant.id }, data: { status: "DECLINED" } });
    await tx.puzzleInvite.updateMany({ where: { matchId, toUserId: targetUserId, status: "PENDING" }, data: { status: "REVOKED", respondedAt: new Date() } });
    target = { fromHandle: (await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { handle: true } })).handle };
    await finalizeIfDone(tx, matchId, new Date());
  }, txOptions);
  const result = target as { fromHandle: string } | null;
  if (result) { sendPuzzleNotice(targetUserId, { type: "MATCH_REVOKED", fromHandle: result.fromHandle, matchId }); emitToUser(targetUserId, "puzzle_invites_changed"); signalMatch(matchId); }
}

// --- Start ---------------------------------------------------------------------------

async function createSession(tx: Tx, match: MatchRow, userId: string, startedAt: Date) {
  const geometry = cachedPuzzleGeometry(match.variant.pieceCount as PuzzlePieceCount, match.variant.definition.seed, match.variant.definition.geometryVersion);
  // Dezelfde variant, geometrie, seed en beginverdeling voor iedereen.
  const snapshot = newPuzzleSnapshot(geometry, match.variant.difficulty as PuzzleDifficulty);
  return tx.puzzleSession.create({ data: { ownerId: userId, variantId: match.variantId, mode: "MATCH", matchId: match.id, snapshot: JSON.stringify(snapshot), questionId: match.questionId, optionOrder: match.optionOrder, startedAt } });
}

/** Live: de organisator start; alle geaccepteerde spelers beginnen op hetzelfde server-startmoment. */
export async function startLiveMatch(userId: string, matchId: string) {
  const config = multiplayerConfig();
  const started: string[] = [];
  await prisma.$transaction(async (tx) => {
    const match = await lockMatch(tx, matchId);
    if (!match || match.organizerId !== userId) throw new PuzzleServiceError("NOT_FOUND");
    if (match.kind !== "LIVE") throw new PuzzleServiceError("INVALID");
    if (match.status !== "LOBBY") throw new PuzzleServiceError(match.status === "RUNNING" ? "ALREADY" : "CLOSED");
    const now = new Date();
    if (match.joinDeadline <= now) throw new PuzzleServiceError("EXPIRED");
    const ready = match.participants.filter((p) => p.status === "ACCEPTED");
    if (ready.length < config.minMatchParticipants) throw new PuzzleServiceError("CAPACITY", { need: config.minMatchParticipants });
    const startsAt = new Date(now.getTime() + config.liveCountdownMs);
    for (const participant of ready) {
      const session = await createSession(tx, match, participant.userId, startsAt);
      await tx.puzzleMatchParticipant.update({ where: { id: participant.id }, data: { status: "PLAYING", sessionId: session.id, startedAt: startsAt } });
      if (participant.userId !== userId) started.push(participant.userId);
    }
    // Wie nog niet had geantwoord, doet niet meer mee.
    for (const late of match.participants.filter((p) => p.status === "INVITED")) await tx.puzzleMatchParticipant.update({ where: { id: late.id }, data: { status: "DECLINED" } });
    await tx.puzzleInvite.updateMany({ where: { matchId, status: "PENDING" }, data: { status: "EXPIRED", respondedAt: now } });
    await tx.puzzleMatch.update({ where: { id: matchId }, data: { status: "RUNNING", startsAt, startedAt: now, playDeadline: new Date(startsAt.getTime() + config.liveMaxPlayMs) } });
  }, txOptions);
  for (const id of started) sendPuzzleNotice(id, { type: "MATCH_STARTED", matchId });
  signalMatch(matchId);
}

/** Async: de deelnemer begint zelf zijn officiële poging; de klok start nu (server). */
export async function beginMatchAttempt(userId: string, matchId: string) {
  const sessionId = await prisma.$transaction(async (tx) => {
    const match = await lockMatch(tx, matchId);
    if (!match) throw new PuzzleServiceError("NOT_FOUND");
    const participant = match.participants.find((p) => p.userId === userId);
    if (!participant) throw new PuzzleServiceError("FORBIDDEN");
    if (match.kind !== "ASYNC") throw new PuzzleServiceError("INVALID");
    const now = new Date();
    // Eén officiële poging: opnieuw "Begin" geeft dezelfde sessie terug, nooit een nieuwe klok.
    if (participant.sessionId) return participant.sessionId;
    if (participant.status !== "ACCEPTED") throw new PuzzleServiceError("EXPIRED");
    if (match.status !== "RUNNING" || match.playDeadline <= now) throw new PuzzleServiceError("EXPIRED");
    const session = await createSession(tx, match, userId, now);
    await tx.puzzleMatchParticipant.update({ where: { id: participant.id }, data: { status: "PLAYING", sessionId: session.id, startedAt: now } });
    return session.id;
  }, txOptions);
  signalMatch(matchId);
  return sessionId;
}

// --- Spelen ------------------------------------------------------------------------------

async function participantFor(tx: Tx, matchId: string, userId: string) {
  const participant = await tx.puzzleMatchParticipant.findUnique({ where: { matchId_userId: { matchId, userId } } });
  if (!participant) throw new PuzzleServiceError("FORBIDDEN");
  return participant;
}

const lastSignal = new Map<string, number>();
/** Alleen de naam van de gebeurtenis naar alle deelnemers; de client haalt zelf opnieuw op. */
export function signalMatch(matchId: string) {
  void prisma.puzzleMatchParticipant.findMany({ where: { matchId }, select: { userId: true } }).then((rows) => { for (const { userId } of rows) emitToUser(userId, "puzzle_match_changed", { matchId }); }).catch(() => {});
}
function signalProgress(matchId: string) {
  const now = Date.now(); if (now - (lastSignal.get(matchId) ?? 0) < 1500) return; lastSignal.set(matchId, now); if (lastSignal.size > 500) lastSignal.clear();
  signalMatch(matchId);
}

export async function resumeMatchPuzzle(userId: string, matchId: string, language: string | null | undefined) {
  const participant = await prisma.puzzleMatchParticipant.findUnique({ where: { matchId_userId: { matchId, userId } } });
  if (!participant?.sessionId) throw new PuzzleServiceError("NOT_STARTED");
  await settleMatch(matchId);
  const state = await resumeSoloPuzzle(userId, participant.sessionId, language, "MATCH");
  if (!state) throw new PuzzleServiceError("NOT_FOUND");
  return state;
}

export async function applyMatchAction(userId: string, matchId: string, expectedVersion: number, actionId: string, action: SoloAction, language: string | null | undefined) {
  const participant = await prisma.puzzleMatchParticipant.findUnique({ where: { matchId_userId: { matchId, userId } } });
  if (!participant?.sessionId) throw new PuzzleServiceError("NOT_STARTED");
  const result = await applySoloAction(userId, participant.sessionId, expectedVersion, actionId, action, language, "MATCH", {
    guard: async (tx, row) => {
      const match = await tx.puzzleMatch.findUnique({ where: { id: matchId } });
      const current = await participantFor(tx, matchId, userId);
      const now = new Date();
      if (!match || match.id !== row.matchId || current.status !== "PLAYING") throw new PuzzleServiceError("CLOSED");
      if (match.startsAt && match.startsAt > now) throw new PuzzleServiceError("NOT_STARTED");
      // De officiële klok loopt door; na de deadline is de poging niet meer geldig.
      if (deadlineOf(match) <= now) throw new PuzzleServiceError("EXPIRED");
    },
    after: async (tx, row, snapshot: PuzzleSnapshot) => {
      await tx.puzzleMatchParticipant.updateMany({ where: { matchId, userId, status: "PLAYING" }, data: { progress: connectedPieces(snapshot) } });
    },
  });
  if (result) signalProgress(matchId);
  return result;
}

/** Het juiste antwoord blijft verborgen zolang de wedstrijd loopt, zodat niemand het kan doorgeven aan spelers die nog niet klaar zijn. */
export interface MatchAnswerResult { correct: boolean; correctChoice: number | null; valid: boolean; elapsedMs: number | null; status: string; counted: boolean }

/** Het definitieve antwoord. De klok stopt hier: alleen een goed antwoord geeft een geldige tijd. */
export async function answerMatch(userId: string, matchId: string, choice: number): Promise<MatchAnswerResult> {
  if (!Number.isInteger(choice) || choice < 0 || choice >= JIGSAW_OPTION_COUNT) throw new PuzzleServiceError("INVALID");
  let streak: { dayEarned: boolean; currentStreak: number } | null = null; let finished = false;
  const result = await prisma.$transaction(async (tx): Promise<MatchAnswerResult> => {
    // Lockvolgorde overal: wedstrijd → sessie → gebruiker.
    const match = await lockMatch(tx, matchId);
    if (!match) throw new PuzzleServiceError("NOT_FOUND");
    const participant = match.participants.find((p) => p.userId === userId);
    if (!participant) throw new PuzzleServiceError("FORBIDDEN");
    const order = JSON.parse(match.optionOrder) as number[]; const correctChoice = order.indexOf(0);
    // Idempotent: een tweede antwoord geeft de bestaande uitkomst, nooit een tweede kans.
    const revealed = (correct: boolean) => correct || match.status === "FINISHED";
    if (participant.status === "FINISHED" || participant.status === "INVALID") return { correct: participant.answeredCorrect === true, correctChoice: revealed(participant.answeredCorrect === true) ? correctChoice : null, valid: participant.status === "FINISHED", elapsedMs: participant.elapsedMs, status: participant.status, counted: false };
    if (participant.status === "DNF") throw new PuzzleServiceError("EXPIRED");
    if (participant.status !== "PLAYING" || !participant.sessionId) throw new PuzzleServiceError("NOT_STARTED");
    await tx.$queryRaw`SELECT "id" FROM "PuzzleSession" WHERE "id" = ${participant.sessionId} FOR UPDATE`;
    const session = await tx.puzzleSession.findUniqueOrThrow({ where: { id: participant.sessionId }, include: sessionInclude });
    if (session.status !== "COMPLETED") throw new PuzzleServiceError("CONFLICT");
    const geometry = cachedPuzzleGeometry(session.variant.pieceCount as PuzzlePieceCount, session.variant.definition.seed, session.variant.definition.geometryVersion);
    void geometry;
    const snapshot = snapshotSchema.parse(JSON.parse(session.snapshot)) as PuzzleSnapshot;
    const now = new Date();
    if (deadlineOf(match) <= now) {
      await tx.puzzleMatchParticipant.update({ where: { id: participant.id }, data: { status: "DNF", finishedAt: now } });
      await finalizeIfDone(tx, matchId, now);
      return { correct: false, correctChoice: null, valid: false, elapsedMs: null, status: "DNF", counted: false };
    }
    const correct = order[choice] === 0;
    const elapsedMs = Math.max(0, now.getTime() - (participant.startedAt ?? session.startedAt).getTime());
    const hints = snapshot.hints;
    await tx.puzzleMatchParticipant.update({ where: { id: participant.id }, data: { status: correct ? "FINISHED" : "INVALID", finishedAt: now, elapsedMs: correct ? elapsedMs : null, answeredCorrect: correct, hintsUsed: hints.length, extraHintsUsed: hints.filter((hint) => hint.extra).length, progress: connectedPieces(snapshot) } });
    // Reeks: dezelfde centrale regel als Solo; alleen een correct antwoord telt.
    const outcome = await completeJigsaw(userId, `m:${participant.id}`, correct, tx);
    if (outcome.result && !outcome.alreadyAnswered) streak = { dayEarned: outcome.result.dayEarned === true, currentStreak: outcome.result.currentStreak };
    const answer = { correct, correctChoice: correct ? correctChoice : null, counted: outcome.counted, streak: null };
    await tx.puzzleSession.update({ where: { id: session.id }, data: { status: "ANSWERED", answeredAt: now, answerResult: JSON.stringify(answer), version: { increment: 1 }, lastActivityAt: now } });
    finished = await finalizeIfDone(tx, matchId, now);
    return { correct, correctChoice: correct || finished ? correctChoice : null, valid: correct, elapsedMs: correct ? elapsedMs : null, status: correct ? "FINISHED" : "INVALID", counted: outcome.counted };
  }, txOptions);
  const event = streak as { dayEarned: boolean; currentStreak: number } | null;
  if (event) emitToUser(userId, "streak_changed", event);
  signalMatch(matchId);
  if (finished) await announceResult(matchId);
  return result;
}

// --- Afronden, deadlines en uitslag --------------------------------------------------------

/** Als iedereen klaar is (of het uiterste moment voorbij), legt dit de uitslag vast. Geeft true bij de overgang naar FINISHED. */
async function finalizeIfDone(tx: Tx, matchId: string, now: Date): Promise<boolean> {
  const match = await tx.puzzleMatch.findUnique({ where: { id: matchId }, include: { participants: true } });
  if (!match || match.status === "FINISHED" || match.status === "CANCELLED") return false;
  const config = multiplayerConfig();
  // Verlopen pogingen en onbeantwoorde uitnodigingen.
  const expired = match.playDeadline <= now;
  for (const participant of match.participants) {
    if (isTerminal(participant.status)) continue;
    if (expired && (participant.status === "PLAYING" || participant.status === "ACCEPTED")) await tx.puzzleMatchParticipant.update({ where: { id: participant.id }, data: { status: "DNF", finishedAt: now } });
    else if (match.joinDeadline <= now && participant.status === "INVITED") await tx.puzzleMatchParticipant.update({ where: { id: participant.id }, data: { status: "DECLINED" } });
  }
  if (match.joinDeadline <= now) await tx.puzzleInvite.updateMany({ where: { matchId, status: "PENDING" }, data: { status: "EXPIRED", respondedAt: now } });
  const fresh = await tx.puzzleMatchParticipant.findMany({ where: { matchId } });
  const active = fresh.filter((p) => p.status === "ACCEPTED" || p.status === "PLAYING").length + fresh.filter((p) => p.status === "INVITED").length;
  const joined = fresh.filter((p) => p.status !== "DECLINED" && p.status !== "INVITED").length;
  if (match.status === "LOBBY" && (match.joinDeadline <= now || joined < 1)) {
    await tx.puzzleMatch.update({ where: { id: matchId }, data: { status: "CANCELLED", finishedAt: now } });
    return false;
  }
  // Een async wedstrijd met te weinig deelnemers op de joinDeadline wordt geannuleerd.
  if (match.kind === "ASYNC" && match.status === "RUNNING" && match.joinDeadline <= now && joined < config.minMatchParticipants && !fresh.some((p) => p.status === "PLAYING" || p.status === "FINISHED" || p.status === "INVALID")) {
    await tx.puzzleMatch.update({ where: { id: matchId }, data: { status: "CANCELLED", finishedAt: now } });
    return false;
  }
  if (active > 0 && !expired) return false;
  // Uitslag: snelste geldige tijd wint; stabiele tie-breaker = eerder klaar, dan gebruikers-id.
  const valid = fresh.filter((p) => p.status === "FINISHED" && p.elapsedMs !== null).sort((a, b) => (a.elapsedMs! - b.elapsedMs!) || ((a.finishedAt?.getTime() ?? 0) - (b.finishedAt?.getTime() ?? 0)) || a.userId.localeCompare(b.userId));
  for (const [index, participant] of valid.entries()) await tx.puzzleMatchParticipant.update({ where: { id: participant.id }, data: { rank: index + 1 } });
  await tx.puzzleMatch.update({ where: { id: matchId }, data: { status: "FINISHED", finishedAt: now, winnerId: valid[0]?.userId ?? null } });
  return true;
}

async function announceResult(matchId: string) {
  const participants = await prisma.puzzleMatchParticipant.findMany({ where: { matchId, status: { in: ["FINISHED", "INVALID", "DNF"] } }, select: { userId: true } });
  for (const { userId } of participants) sendPuzzleNotice(userId, { type: "MATCH_RESULT", matchId });
}

/** Verwerkt verlopen deadlines van één wedstrijd (lui, bij lezen) of van alle (scheduler). */
export async function settleMatch(matchId: string, now: Date = new Date()) {
  let finished = false;
  await prisma.$transaction(async (tx) => {
    const match = await lockMatch(tx, matchId);
    if (!match || match.status === "FINISHED" || match.status === "CANCELLED") return;
    if (match.playDeadline > now && match.joinDeadline > now) return;
    finished = await finalizeIfDone(tx, matchId, now);
  }, txOptions);
  if (finished) { await announceResult(matchId); signalMatch(matchId); }
}

export async function settleExpiredMatches(now: Date = new Date()): Promise<number> {
  const due = await prisma.puzzleMatch.findMany({ where: { status: { in: ["LOBBY", "RUNNING"] }, OR: [{ playDeadline: { lte: now } }, { joinDeadline: { lte: now } }] }, select: { id: true }, take: 100 });
  for (const { id } of due) await settleMatch(id, now).catch(() => {});
  return due.length;
}

export async function cancelMatch(userId: string, matchId: string) {
  await prisma.$transaction(async (tx) => {
    const match = await lockMatch(tx, matchId);
    if (!match || match.organizerId !== userId) throw new PuzzleServiceError("NOT_FOUND");
    if (match.status !== "LOBBY") throw new PuzzleServiceError("CLOSED");
    const now = new Date();
    await tx.puzzleMatch.update({ where: { id: matchId }, data: { status: "CANCELLED", finishedAt: now } });
    await tx.puzzleInvite.updateMany({ where: { matchId, status: "PENDING" }, data: { status: "REVOKED", respondedAt: now } });
  }, txOptions);
  signalMatch(matchId);
}

// --- Lezen ------------------------------------------------------------------------------------

export async function getMatch(userId: string, matchId: string): Promise<MatchView> {
  await settleMatch(matchId);
  const match = await prisma.puzzleMatch.findUnique({ where: { id: matchId }, include: matchInclude });
  if (!match) throw new PuzzleServiceError("NOT_FOUND");
  const mine = match.participants.find((p) => p.userId === userId);
  if (!mine) throw new PuzzleServiceError("FORBIDDEN");
  const now = new Date();
  const closed = match.status === "FINISHED" || match.status === "CANCELLED";
  // Beleid: uitslagen en tijden zijn pas zichtbaar als je zelf klaar bent of de wedstrijd voorbij is,
  // zodat iemand die nog niet begon niet door andermans tijd wordt beïnvloed. Nooit het juiste antwoord.
  const visibleResults = closed || isTerminal(mine.status) && mine.status !== "DECLINED";
  const invite = mine.status === "INVITED" ? await prisma.puzzleInvite.findFirst({ where: { matchId, toUserId: userId, status: "PENDING" }, select: { id: true } }) : null;
  const live = match.kind === "LIVE" && match.status === "RUNNING";
  return {
    id: match.id, kind: match.kind, status: match.status, organizerId: match.organizerId, image: match.variant.definition.imageUrl, story: match.variant.definition.storyNumber,
    pieceCount: match.variant.pieceCount as PuzzlePieceCount, difficulty: match.variant.difficulty as PuzzleDifficulty,
    createdAt: match.createdAt.toISOString(), startsAt: match.startsAt?.toISOString() ?? null, joinDeadline: match.joinDeadline.toISOString(), playDeadline: match.playDeadline.toISOString(), finishedAt: match.finishedAt?.toISOString() ?? null, winnerId: visibleResults ? match.winnerId : null,
    me: { userId, status: mine.status, sessionId: mine.sessionId, startedAt: mine.startedAt?.toISOString() ?? null, canBegin: match.kind === "ASYNC" && match.status === "RUNNING" && mine.status === "ACCEPTED" && match.playDeadline > now, inviteId: invite?.id ?? null, visibleResults },
    participants: match.participants.map((p) => ({
      userId: p.userId, handle: p.user.handle, discriminator: p.user.discriminator,
      // Zonder uitslagrechten alleen grove statussen; een ongeldige poging blijft verborgen als "klaar".
      status: visibleResults || p.userId === userId ? p.status : p.status === "INVALID" || p.status === "FINISHED" ? "FINISHED" : p.status === "DNF" ? "DNF" : p.status,
      progress: live && p.status === "PLAYING" ? p.progress : null,
      result: visibleResults ? { rank: p.rank, elapsedMs: p.elapsedMs, valid: p.status === "FINISHED", hintsUsed: p.hintsUsed, extraHintsUsed: p.extraHintsUsed } : null,
      done: isTerminal(p.status) && p.status !== "DECLINED",
    })),
    serverNow: now.getTime(),
  };
}

/** Vraag voor het resultaatscherm van de eigen poging (met het juiste antwoord pas na afloop). */
export async function matchQuestion(userId: string, matchId: string, language: string | null | undefined) {
  const match = await prisma.puzzleMatch.findUnique({ where: { id: matchId }, include: { participants: { where: { userId } } } });
  const participant = match?.participants[0];
  if (!match || !participant) throw new PuzzleServiceError("FORBIDDEN");
  const question = jigsawQuestionById(match.questionId); if (!question) return null;
  const lang = jigsawQuestionLanguage(language); const order = JSON.parse(match.optionOrder) as number[];
  const answered = participant.status === "FINISHED" || participant.status === "INVALID";
  const reveal = (participant.status === "FINISHED") || match.status === "FINISHED";
  return { text: question.text[lang], options: order.map((index) => question.options[lang][index]), ...(answered && reveal ? { correctChoice: order.indexOf(0) } : {}) };
}

export async function listMatchOverview(userId: string) {
  const now = new Date();
  const rows = await prisma.puzzleMatchParticipant.findMany({
    where: { userId, status: { not: "DECLINED" }, match: { OR: [{ status: { in: ["LOBBY", "RUNNING"] } }, { status: "FINISHED", finishedAt: { gt: new Date(now.getTime() - 3 * 86_400_000) } }] } },
    orderBy: { createdAt: "desc" }, take: 20,
    include: { match: { include: { variant: { include: { definition: true } }, organizer: { select: { id: true, handle: true } }, participants: { include: { user: { select: { id: true, handle: true } } } } } } },
  });
  return rows;
}
