import { prisma } from "@/lib/db";
import { getContentContext } from "@/lib/contentCollections";
import { dayKeyInZone, resolveTimeZone } from "@/lib/timeZone";
import { shuffleForDisplay } from "@/lib/exerciseGen";
import { validateReportedScore } from "./validation";
import { applyReviveAnswer, reviveQuestionContext, selectReviveOptions } from "./rules";
import { REVIVE_START, cursorAfterAnswer, pickReviveQuestion, type ReviveChapterEntry } from "./reviveSelection";
import { rankScores } from "./ranking";

const TOP_SIZE = 50;

export type RunStatus = "IN_PROGRESS" | "DEAD_AWAITING_REVIVE" | "REVIVE_READY" | "FINISHED";

export interface ReviveQuestion {
  exerciseId: string;
  context: { kind: "chapter"; label: string } | null;
  prompt: string;
  options: { id: string; label: string }[];
}

/** Na een fout Genees-antwoord: welk hoofdstuk de speler kan lezen. Nooit het antwoord zelf. */
export interface ReviveReading {
  chapterId: string;
  label: string;
}

export interface QuickMissionaryRunView {
  runId: string;
  status: RunStatus;
  score: number;
  reviveUsed: boolean;
  reviveAvailable: boolean;
  reviveQuestion: ReviveQuestion | null;
  reviveReading: ReviveReading | null;
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
  const question = await prisma.quickMissionaryReviveQuestion.findUnique({
    where: { id: run.reviveExerciseId },
    select: {
      id: true,
      prompt: true,
      chapter: { select: { number: true, book: { select: { name: true } } } },
      options: { where: { id: { in: ids } }, select: { id: true, label: true } },
    },
  });
  if (!question || question.options.length !== 3) return null;
  const byId = new Map(question.options.map((option) => [option.id, option]));
  const options = ids.map((id) => byId.get(id)).filter((option): option is { id: string; label: string } => !!option);
  // De wire-naam blijft exerciseId: een nog openstaande client van vóór deze
  // wijziging stuurt dat veld terug, en lopende runs bewaren deze id al.
  return options.length === 3 ? { exerciseId: question.id, context: reviveQuestionContext(question), prompt: question.prompt, options } : null;
}

/** Na een fout antwoord het hoofdstuk om te lezen; alleen voor een afgesloten run. */
async function reviveReadingForRun(run: { id: string; status: RunStatus; userId: string }): Promise<ReviveReading | null> {
  if (run.status !== "FINISHED") return null;
  const wrong = await prisma.quickMissionaryReviveSeen.findFirst({
    where: { runId: run.id, userId: run.userId, outcome: "WRONG" },
    select: { question: { select: { chapter: { select: { id: true, number: true, book: { select: { name: true } } } } } } },
  });
  const chapter = wrong?.question.chapter;
  const context = chapter ? reviveQuestionContext({ chapter }) : null;
  return chapter && context ? { chapterId: chapter.id, label: context.label } : null;
}

/** Zonder geschikte vragen in de actieve uitgave wordt Genees niet aangeboden. */
async function hasReviveQuestions(userId: string): Promise<boolean> {
  const collectionId = await activeCollectionId(userId);
  const any = await prisma.quickMissionaryReviveQuestion.findFirst({
    where: { status: "APPROVED", chapter: { book: { contentCollectionId: collectionId } } },
    select: { id: true },
  });
  return !!any;
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
  const awaiting = run.status === "DEAD_AWAITING_REVIVE" && !run.reviveUsed;
  const question = run.status === "DEAD_AWAITING_REVIVE" ? await reviveQuestionForRun(run) : null;
  const [scores, reviveReading, canRevive] = await Promise.all([
    bestScores(userId, run.dayKey),
    reviveReadingForRun(run),
    awaiting ? (run.reviveExerciseId ? Promise.resolve(true) : hasReviveQuestions(userId)) : Promise.resolve(false),
  ]);
  return {
    runId: run.id,
    status: run.status,
    score: run.score,
    reviveUsed: run.reviveUsed,
    reviveAvailable: canRevive,
    reviveQuestion: question,
    reviveReading,
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

const MAX_UNUSABLE_QUESTIONS = 50;

/**
 * Geeft de Genees-vraag van deze run uit. Dezelfde run krijgt bij verversen
 * dezelfde vraag terug; een nieuwe run krijgt per regel in reviveSelection.ts
 * een nieuwe. De vraag staat al als gezien geregistreerd vóórdat de speler
 * hem krijgt, zodat verlaten of verversen hem niet opnieuw oplevert.
 */
export async function requestReviveQuestion(runId: string, userId: string): Promise<QuickMissionaryRunView> {
  const run = await getOwnedRun(runId, userId);
  if (run.status !== "DEAD_AWAITING_REVIVE" || run.reviveUsed) throw new Error("INVALID_STATE");
  if (!run.reviveExerciseId) {
    const collectionId = await activeCollectionId(userId);
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "QuickMissionaryRun" WHERE "id" = ${runId} AND "userId" = ${userId} FOR UPDATE`;
      const locked = await tx.quickMissionaryRun.findUnique({ where: { id: runId } });
      if (!locked || locked.userId !== userId) throw new Error("NOT_FOUND");
      if (locked.status !== "DEAD_AWAITING_REVIVE" || locked.reviveUsed) throw new Error("INVALID_STATE");
      if (locked.reviveExerciseId) return;
      // Twee runs van dezelfde speler tegelijk mogen niet dezelfde vraag uitgeven.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`genees:${userId}`}, 0))`;

      const progress = await tx.quickMissionaryReviveProgress.findUnique({ where: { userId_contentCollectionId: { userId, contentCollectionId: collectionId } } });
      const cycle = progress?.cycle ?? 1;
      const cursor = progress ? { bookOrder: progress.cursorBookOrder, chapterOrder: progress.cursorChapterOrder } : REVIVE_START;
      const inCollection = { chapter: { book: { contentCollectionId: collectionId } } };
      const [rows, seenRows] = await Promise.all([
        tx.quickMissionaryReviveQuestion.findMany({
          where: { status: "APPROVED", ...inCollection },
          select: { id: true, chapterId: true, chapter: { select: { order: true, book: { select: { order: true } } } } },
        }),
        tx.quickMissionaryReviveSeen.findMany({ where: { userId, cycle, question: inCollection }, select: { questionId: true }, orderBy: { seenAt: "desc" } }),
      ]);
      const seen = new Set(seenRows.map((row) => row.questionId));
      const unusable = new Set<string>();

      for (let attempt = 0; attempt < MAX_UNUSABLE_QUESTIONS; attempt++) {
        const byChapter = new Map<string, ReviveChapterEntry>();
        for (const row of rows) {
          if (unusable.has(row.id)) continue;
          const entry = byChapter.get(row.chapterId) ?? { chapterId: row.chapterId, bookOrder: row.chapter.book.order, chapterOrder: row.chapter.order, questionIds: [] };
          entry.questionIds.push(row.id);
          byChapter.set(row.chapterId, entry);
        }
        const pick = pickReviveQuestion({ chapters: [...byChapter.values()], seen, cursor, lastSeenQuestionId: seenRows[0]?.questionId ?? null });
        if (!pick) throw new Error("NO_QUESTION");

        const question = await tx.quickMissionaryReviveQuestion.findUniqueOrThrow({
          where: { id: pick.questionId },
          select: { id: true, options: { orderBy: { order: "asc" }, select: { id: true, label: true, isCorrect: true } } },
        });
        const options = selectReviveOptions(question.options);
        if (!options) {
          unusable.add(question.id);
          continue;
        }

        const nextCycle = pick.cycleReset ? cycle + 1 : cycle;
        const chosen = byChapter.get(pick.chapterId)!;
        await tx.quickMissionaryReviveSeen.create({ data: { userId, questionId: question.id, cycle: nextCycle, runId, outcome: "SHOWN" } });
        await tx.quickMissionaryReviveProgress.upsert({
          where: { userId_contentCollectionId: { userId, contentCollectionId: collectionId } },
          create: { userId, contentCollectionId: collectionId, cycle: nextCycle, cursorBookOrder: cursor.bookOrder, cursorChapterOrder: cursor.chapterOrder },
          // Na een reset begint de uitgave opnieuw bij het eerste hoofdstuk.
          update: pick.cycleReset ? { cycle: nextCycle, cursorBookOrder: chosen.bookOrder, cursorChapterOrder: chosen.chapterOrder } : {},
        });
        await tx.quickMissionaryRun.update({
          where: { id: runId },
          data: { reviveExerciseId: question.id, reviveOptionIds: JSON.stringify(shuffleForDisplay(options).map((option) => option.id)) },
        });
        return;
      }
      throw new Error("NO_QUESTION");
    });
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
    const option = await tx.quickMissionaryReviveOption.findUnique({
      where: { id: optionId },
      select: {
        questionId: true,
        isCorrect: true,
        question: { select: { chapter: { select: { order: true, book: { select: { order: true, contentCollectionId: true } } } } } },
      },
    });
    if (!option || option.questionId !== exerciseId) throw new Error("INVALID_OPTION");
    const nextStatus = applyReviveAnswer(run.status, run.reviveUsed, option.isCorrect);
    if (!nextStatus) throw new Error("INVALID_STATE");
    await tx.quickMissionaryRun.update({ where: { id: run.id }, data: option.isCorrect ? { reviveUsed: true, status: nextStatus } : { status: nextStatus, finishedAt: now() } });

    // Geschiedenis en plek: goed -> volgend hoofdstuk, fout -> hetzelfde
    // hoofdstuk blijft staan (met een andere vraag). De vraag zelf stond al als gezien.
    await tx.quickMissionaryReviveSeen.updateMany({
      where: { userId, questionId: exerciseId, runId },
      data: { outcome: option.isCorrect ? "CORRECT" : "WRONG", answeredAt: now() },
    });
    const { chapter } = option.question;
    const cursor = cursorAfterAnswer({ bookOrder: chapter.book.order, chapterOrder: chapter.order }, option.isCorrect);
    const contentCollectionId = chapter.book.contentCollectionId;
    await tx.quickMissionaryReviveProgress.upsert({
      where: { userId_contentCollectionId: { userId, contentCollectionId } },
      create: { userId, contentCollectionId, cursorBookOrder: cursor.bookOrder, cursorChapterOrder: cursor.chapterOrder },
      update: { cursorBookOrder: cursor.bookOrder, cursorChapterOrder: cursor.chapterOrder },
    });
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
