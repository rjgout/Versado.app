import type { Socket } from "socket.io";
import type { ChapterGuessLevel, LiveQuizActionKind, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { commitSocketMutation } from "@/lib/native/socketMutation";
import { isExerciseCorrect } from "@/lib/exerciseGen";
import { computeHintEffect, type LiveQuestionSeed, type ChapterLabel, type HintResult } from "@/lib/chapterGuess";

export interface QuizExercise {
  id: string;
  type: "FILL_BLANK" | "WORD_BANK" | "TRUE_FALSE" | "MULTIPLE_CHOICE" | "SEQUENCE";
  verseRef: string;
  prompt: string;
  answers: string[];
  wordBank?: string[];
  options?: string[];
}
export type QuizPayload =
  | { mode: "EXERCISES"; exercise: QuizExercise }
  | { mode: "CHAPTER_GUESS"; question: LiveQuestionSeed; level: ChapterGuessLevel; labels: ChapterLabel[] };
export interface QuizOutcome extends HintResult {
  correct?: boolean;
  points?: number;
  score?: number;
  hintBalance: number;
}
/** Bestaande spelregels, met uitsluitend canonieke servertijden en vraaginhoud. */
export function evaluateQuizAnswer(payload: QuizPayload, answers: string[], startedAt: number, deadline: number, now: number) {
  const correct = payload.mode === "EXERCISES"
    ? isExerciseCorrect(payload.exercise.type, answers, payload.exercise.answers)
    : answers.length === 1 && answers[0] === payload.question.chapterId;
  const fraction = Math.max(0, Math.min(1, (deadline - now) / (deadline - startedAt)));
  return {
    correct, points: correct ? Math.round(50 + 50 * fraction) : 0,
    hintReward: correct && payload.mode === "CHAPTER_GUESS" && payload.level !== "EXPERT" ? 1 : 0,
  };
}
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const delayMs = 3500;
async function transactionNow(tx: Prisma.TransactionClient) {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
  return rows[0].now;
}
async function lockGame(tx: Prisma.TransactionClient, gameId: string) {
  await tx.$queryRaw`SELECT "id" FROM "LiveGame" WHERE "id" = ${gameId} FOR UPDATE`;
  return tx.liveGame.findUnique({ where: { id: gameId } });
}

/** User → NativeSession (indien native) → LiveGame → deelnemer/claim.
 * Geen content-I/O, Redis, broadcast of andere gebruikerslocks onder deze locks.
 */
export async function startLiveQuiz(socket: Socket, gameId: string, candidates: QuizPayload[]) {
  return commitSocketMutation(socket, async tx => {
    const game = await lockGame(tx, gameId);
    if (!game || game.hostId !== socket.data.userId || !["EXERCISES", "CHAPTER_GUESS"].includes(game.mode)) return false;
    if (game.quizIndex !== null) return game.status !== "FINISHED";
    // Een oude, lopende geheugenquiz heeft geen herstelbare canonieke vraag.
    // Nooit stilzwijgend nieuwe vragen/beloningen invoegen in die oude ronde.
    if (game.status !== "LOBBY" || !candidates.length || candidates.some(q => q.mode !== game.mode)) return false;
    if (!await tx.liveGamePlayer.findUnique({ where: { gameId_userId: { gameId, userId: game.hostId } } })) return false;
    const now = await transactionNow(tx);
    await tx.liveQuizQuestion.createMany({ data: candidates.map((payload, questionIndex) => ({
      gameId, questionIndex, payload: json(payload),
      ...(questionIndex === 0 ? { startedAt: now, deadline: new Date(now.getTime() + (game.mode === "EXERCISES" ? 20000 : 60000)) } : {}),
    })) });
    await tx.liveGame.update({ where: { id: gameId }, data: { status: "IN_PROGRESS", quizIndex: 0 } });
    return true;
  }, true);
}

export function readLiveQuiz(gameId: string) {
  return prisma.liveGame.findUnique({ where: { id: gameId }, include: {
    quizQuestions: { orderBy: { questionIndex: "asc" } },
    players: { include: { user: { select: { handle: true } }, quizActions: { where: { actionKind: "ANSWER" } } } },
  } });
}

/** Systeemovergang: alleen de database bepaalt sluiten/openen; lokale timers zijn prikkels.
 * Geen User-lock nodig: deze overgang kent geen beloning toe en wijzigt geen gebruiker.
 */
export async function advanceLiveQuiz(gameId: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '1500ms'`;
    const game = await lockGame(tx, gameId);
    if (!game || game.status !== "IN_PROGRESS" || game.quizIndex === null) return;
    const question = await tx.liveQuizQuestion.findUniqueOrThrow({ where: { gameId_questionIndex: { gameId, questionIndex: game.quizIndex } } });
    const now = await transactionNow(tx);
    if (question.revealedAt) {
      if (now.getTime() - question.revealedAt.getTime() < delayMs) return;
      const next = await tx.liveQuizQuestion.findUnique({ where: { gameId_questionIndex: { gameId, questionIndex: game.quizIndex + 1 } } });
      if (!next) {
        await tx.liveGame.update({ where: { id: gameId }, data: { status: "FINISHED" } });
      } else {
        await tx.liveGame.update({ where: { id: gameId }, data: { quizIndex: next.questionIndex } });
        await tx.liveQuizQuestion.update({ where: { gameId_questionIndex: { gameId, questionIndex: next.questionIndex } }, data: {
          startedAt: now, deadline: new Date(now.getTime() + (game.mode === "EXERCISES" ? 20000 : 60000)),
        } });
      }
    } else {
      const count = await tx.liveQuizAction.count({ where: { gameId, questionIndex: game.quizIndex, actionKind: "ANSWER" } });
      const players = await tx.liveGamePlayer.count({ where: { gameId } });
      if (question.deadline && (now >= question.deadline || players > 0 && count >= players)) {
        await tx.liveQuizQuestion.update({ where: { gameId_questionIndex: { gameId, questionIndex: game.quizIndex } }, data: { revealedAt: now } });
      }
    }
  }, { maxWait: 2000, timeout: 4000 });
}

export async function actInLiveQuiz(socket: Socket, gameId: string, questionIndex: number, actionKind: LiveQuizActionKind, given: unknown = []): Promise<QuizOutcome | { error: string }> {
  if (!Number.isInteger(questionIndex) || questionIndex < 0 || !["ANSWER", "HINT_USE"].includes(actionKind)) return { error: "Ongeldige vraagactie." };
  if (actionKind === "ANSWER" && (!Array.isArray(given) || given.length > 64 || given.some(v => typeof v !== "string" || v.length > 2048))) return { error: "Ongeldig antwoord." };
  const userId = socket.data.userId as string;
  return commitSocketMutation(socket, async tx => {
    const game = await lockGame(tx, gameId);
    if (!game || !["EXERCISES", "CHAPTER_GUESS"].includes(game.mode)) return { error: "Spel niet gevonden." };
    const player = await tx.liveGamePlayer.findUnique({ where: { gameId_userId: { gameId, userId } } });
    if (!player) return { error: "Geen deelnemer." };
    const key = { gameId, questionIndex, userId, actionKind };
    const prior = await tx.liveQuizAction.findUnique({ where: { gameId_questionIndex_userId_actionKind: key } });
    if (prior) return prior.result as unknown as QuizOutcome;
    const row = await tx.liveQuizQuestion.findUnique({ where: { gameId_questionIndex: { gameId, questionIndex } } });
    const now = await transactionNow(tx);
    if (game.status !== "IN_PROGRESS" || game.quizIndex !== questionIndex || !row?.startedAt || !row.deadline || row.revealedAt || now >= row.deadline) return { error: "Deze vraag is gesloten." };
    const payload = row.payload as unknown as QuizPayload;
    if (payload.mode !== game.mode) throw new Error("Vraagmodus wijkt af.");
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { hintBalance: true } });
    let outcome: QuizOutcome;
    if (actionKind === "ANSWER") {
      const answers = given as string[];
      const { correct, points, hintReward: reward } = evaluateQuizAnswer(payload, answers, row.startedAt.getTime(), row.deadline.getTime(), now.getTime());
      outcome = { correct, points, score: player.score + points, hintBalance: user.hintBalance + reward };
      // De claim wordt vóór de writes aangemaakt, maar met precies dezelfde commitgrens.
      const claim = await tx.liveQuizAction.createMany({ data: [{ ...key, result: json(outcome) }], skipDuplicates: true });
      if (!claim.count) return (await tx.liveQuizAction.findUniqueOrThrow({ where: { gameId_questionIndex_userId_actionKind: key } })).result as unknown as QuizOutcome;
      await tx.liveGamePlayer.update({ where: { gameId_userId: { gameId, userId } }, data: { score: { increment: points } } });
      if (reward) await tx.user.update({ where: { id: userId }, data: { hintBalance: { increment: reward } } });
    } else {
      if (payload.mode !== "CHAPTER_GUESS" || payload.level === "EXPERT") return { error: "Hints zijn niet beschikbaar op dit niveau." };
      if (user.hintBalance < 1) return { error: "Je hebt geen hint beschikbaar — geef eerst een goed antwoord, of koop er een in de winkel." };
      outcome = { ...computeHintEffect(payload.level, payload.question.chapterId, payload.question.optionIds, payload.labels.find(l => l.chapterId === payload.question.chapterId) ?? null), hintBalance: user.hintBalance - 1 };
      const claim = await tx.liveQuizAction.createMany({ data: [{ ...key, result: json(outcome) }], skipDuplicates: true });
      if (!claim.count) return (await tx.liveQuizAction.findUniqueOrThrow({ where: { gameId_questionIndex_userId_actionKind: key } })).result as unknown as QuizOutcome;
      const spent = await tx.user.updateMany({ where: { id: userId, hintBalance: { gt: 0 } }, data: { hintBalance: { decrement: 1 } } });
      if (!spent.count) throw new Error("Hintvoorraad veranderde; transactie teruggerold.");
    }
    return outcome;
  }, true);
}
