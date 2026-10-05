import { prisma } from "@/lib/db";
import { getContentContext } from "@/lib/contentCollections";
import { dayKeyInZone, resolveTimeZone } from "@/lib/timeZone";
import { shuffleForDisplay } from "@/lib/exerciseGen";
import { validateReportedScore } from "./validation";
import { applyReviveAnswer, reviveQuestionContext, selectReviveOptions } from "./rules";
import { rankScores } from "./ranking";

const TOP_SIZE = 50;

export type RunStatus = "IN_PROGRESS" | "DEAD_AWAITING_REVIVE" | "REVIVE_READY" | "FINISHED";

export interface ReviveQuestion {
  exerciseId: string;
  context: { kind: "chapter"; label: string } | null;
  prompt: string;
  options: { id: string; label: string }[];
}

export interface QuickMissionaryRunView {
  runId: string;
  status: RunStatus;
  score: number;
  reviveUsed: boolean;
  reviveAvailable: boolean;
  reviveQuestion: ReviveQuestion | null;
  dailyBest: number;
  allTimeBest: number;
}

export interface QuickMissionaryLeaderboardEntry {
  rank: number;
  userId: string;
  handle: string;
  discriminator: string;
  score: number;
  finishedAt: string;
}

function now(): Date {
  // De serverklok is de enige autoriteit; deze functie maakt dat expliciet in
  // de runlogica en houdt tests eenvoudig.
  return new Date();
}

function runDayKey(user: { timeZone: string | null }, at: Date): string {
  return dayKeyInZone(at, resolveTimeZone(user.timeZone));
}

async function activeCollectionId(userId: string): Promise<string> {
  return (await getContentContext(userId)).active.id;
}

function optionIdsFromRun(run: { reviveOptionIds: string | null }): string[] {
  if (!run.reviveOptionIds) return [];
  try {
    const ids = JSON.parse(run.reviveOptionIds);
    return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? ids : [];
  } catch {
    return [];
  }
}

async function reviveQuestionForRun(run: { reviveExerciseId: string | null; reviveOptionIds: string | null }): Promise<ReviveQuestion | null> {
  if (!run.reviveExerciseId) return null;
  const ids = optionIdsFromRun(run);
  if (ids.length !== 3) return null;
  const exercise = await prisma.exercise.findUnique({
    where: { id: run.reviveExerciseId },
    select: {
      id: true,
      prompt: true,
      chapter: { select: { number: true, book: { select: { name: true } } } },
      options: { where: { id: { in: ids } }, select: { id: true, label: true } },
    },
  });
  if (!exercise || exercise.options.length !== 3) return null;
  const byId = new Map(exercise.options.map((option) => [option.id, option]));
  const options = ids.map((id) => byId.get(id)).filter((option): option is { id: string; label: string } => !!option);
  return options.length === 3 ? { exerciseId: exercise.id, context: reviveQuestionContext(exercise), prompt: exercise.prompt, options } : null;
}

async function bestScores(userId: string, dayKey: string): Promise<{ dailyBest: number; allTimeBest: number }> {
  const [daily, allTime] = await Promise.all([
    prisma.quickMissionaryRun.findFirst({ where: { userId, dayKey, status: "FINISHED" }, orderBy: [{ score: "desc" }, { finishedAt: "asc" }], select: { score: true } }),
    prisma.quickMissionaryRun.findFirst({ where: { userId, status: "FINISHED" }, orderBy: [{ score: "desc" }, { finishedAt: "asc" }], select: { score: true } }),
  ]);
  return { dailyBest: daily?.score ?? 0, allTimeBest: allTime?.score ?? 0 };
}

export async function startQuickMissionaryRun(userId: string): Promise<{ runId: string }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const created = await prisma.quickMissionaryRun.create({ data: { userId, dayKey: runDayKey(user, now()) } });
  return { runId: created.id };
}

async function getOwnedRun(runId: string, userId: string) {
  const run = await prisma.quickMissionaryRun.findUnique({ where: { id: runId } });
  if (!run || run.userId !== userId) throw new Error("NOT_FOUND");
  return run;
}

export async function getQuickMissionaryRunView(runId: string, userId: string): Promise<QuickMissionaryRunView> {
  const run = await getOwnedRun(runId, userId);
  const question = run.status === "DEAD_AWAITING_REVIVE" ? await reviveQuestionForRun(run) : null;
  const scores = await bestScores(userId, run.dayKey);
  return {
    runId: run.id,
    status: run.status,
    score: run.score,
    reviveUsed: run.reviveUsed,
    reviveAvailable: run.status === "DEAD_AWAITING_REVIVE" && !run.reviveUsed,
    reviveQuestion: question,
    ...scores,
  };
}

export async function reportDeath(runId: string, userId: string, score: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "QuickMissionaryRun" WHERE "id" = ${runId} AND "userId" = ${userId} FOR UPDATE`;
    const run = await tx.quickMissionaryRun.findUnique({ where: { id: runId } });
    if (!run || run.userId !== userId) throw new Error("NOT_FOUND");
    if (run.status === "DEAD_AWAITING_REVIVE" || run.status === "FINISHED") return;
    if (run.status !== "IN_PROGRESS") throw new Error("INVALID_STATE");
    const check = validateReportedScore(run.startedAt, now(), run.score, score);
    if (!check.ok) throw new Error(check.reason);
    await tx.quickMissionaryRun.update({ where: { id: run.id }, data: { score: check.score, status: "DEAD_AWAITING_REVIVE" } });
  });
}

export async function finishQuickMissionaryRun(runId: string, userId: string, score: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "QuickMissionaryRun" WHERE "id" = ${runId} AND "userId" = ${userId} FOR UPDATE`;
    const run = await tx.quickMissionaryRun.findUnique({ where: { id: runId } });
    if (!run || run.userId !== userId) throw new Error("NOT_FOUND");
    if (run.status === "FINISHED") return;
    if (!["IN_PROGRESS", "DEAD_AWAITING_REVIVE", "REVIVE_READY"].includes(run.status)) throw new Error("INVALID_STATE");
    const check = validateReportedScore(run.startedAt, now(), run.score, score);
    if (!check.ok) throw new Error(check.reason);
    await tx.quickMissionaryRun.update({ where: { id: run.id }, data: { score: check.score, status: "FINISHED", finishedAt: now() } });
  });
}

export async function requestReviveQuestion(runId: string, userId: string): Promise<QuickMissionaryRunView> {
  const run = await getOwnedRun(runId, userId);
  if (run.status !== "DEAD_AWAITING_REVIVE" || run.reviveUsed) throw new Error("INVALID_STATE");
  if (!run.reviveExerciseId) {
    const collectionId = await activeCollectionId(userId);
    const candidates = await prisma.exercise.findMany({
      where: { status: "APPROVED", type: "MULTIPLE_CHOICE", chapter: { book: { contentCollectionId: collectionId } }, options: { some: {} } },
      include: {
        chapter: { select: { number: true, book: { select: { name: true } } } },
        options: { orderBy: { order: "asc" } },
        attempts: { where: { userId }, select: { id: true } },
      },
      take: 200,
    });
    const seen = candidates.filter((candidate) => candidate.attempts.length > 0);
    const selected = [...shuffleForDisplay(seen), ...shuffleForDisplay(candidates.filter((candidate) => candidate.attempts.length === 0))]
      .map((candidate) => {
        const options = selectReviveOptions(candidate.options);
        return { candidate, options: options ? shuffleForDisplay(options) : null };
      })
      .find((entry): entry is { candidate: typeof candidates[number]; options: { id: string; label: string; isCorrect: boolean }[] } => !!entry.options);
    if (!selected) throw new Error("NO_QUESTION");
    await prisma.quickMissionaryRun.update({ where: { id: runId }, data: { reviveExerciseId: selected.candidate.id, reviveOptionIds: JSON.stringify(selected.options.map((option) => option.id)) } });
  }
  return getQuickMissionaryRunView(runId, userId);
}

export async function answerReviveQuestion(runId: string, userId: string, exerciseId: string, optionId: string): Promise<{ correct: boolean; view: QuickMissionaryRunView }> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "QuickMissionaryRun" WHERE "id" = ${runId} AND "userId" = ${userId} FOR UPDATE`;
    const run = await tx.quickMissionaryRun.findUnique({ where: { id: runId } });
    if (!run || run.userId !== userId) throw new Error("NOT_FOUND");
    if (run.status !== "DEAD_AWAITING_REVIVE" || run.reviveUsed || run.reviveExerciseId !== exerciseId) throw new Error("INVALID_STATE");
    if (!optionIdsFromRun(run).includes(optionId)) throw new Error("INVALID_OPTION");
    const option = await tx.questionOption.findUnique({ where: { id: optionId }, select: { exerciseId: true, isCorrect: true } });
    if (!option || option.exerciseId !== exerciseId) throw new Error("INVALID_OPTION");
    const nextStatus = applyReviveAnswer(run.status, run.reviveUsed, option.isCorrect);
    if (!nextStatus) throw new Error("INVALID_STATE");
    await tx.quickMissionaryRun.update({ where: { id: run.id }, data: option.isCorrect ? { reviveUsed: true, status: nextStatus } : { status: nextStatus, finishedAt: now() } });
    return option.isCorrect;
  });
  return { correct: result, view: await getQuickMissionaryRunView(runId, userId) };
}

export async function resumeAfterRevive(runId: string, userId: string): Promise<void> {
  await prisma.quickMissionaryRun.updateMany({ where: { id: runId, userId, status: "REVIVE_READY", reviveUsed: true }, data: { status: "IN_PROGRESS", reviveExerciseId: null, reviveOptionIds: null } });
}

export async function getQuickMissionaryLeaderboard(userId: string, board: "today" | "all-time") {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { timeZone: true } });
  const dayKey = runDayKey(user, now());
  const runs = await prisma.quickMissionaryRun.findMany({
    where: { status: "FINISHED", ...(board === "today" ? { dayKey } : {}) },
    select: { userId: true, score: true, finishedAt: true },
  });
  const ranked = rankScores(runs.flatMap((run) => run.finishedAt ? [{ userId: run.userId, score: run.score, finishedAt: run.finishedAt }] : []));
  const visible = ranked.slice(0, TOP_SIZE);
  const mine = ranked.find((entry) => entry.userId === userId);
  if (mine && !visible.some((entry) => entry.userId === userId)) visible.push(mine);
  const users = await prisma.user.findMany({ where: { id: { in: visible.map((entry) => entry.userId) } }, select: { id: true, handle: true, discriminator: true } });
  const byId = new Map(users.map((entry) => [entry.id, entry]));
  return visible.flatMap((entry) => {
    const profile = byId.get(entry.userId);
    if (!profile) return [];
    return [{ rank: ranked.findIndex((item) => item.userId === entry.userId) + 1, userId: entry.userId, handle: profile.handle, discriminator: profile.discriminator, score: entry.score, finishedAt: entry.finishedAt.toISOString() }];
  });
}
