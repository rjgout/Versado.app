// Leervoortgang per inhoud: de enige plek die ContentProgress,
// ContentExerciseCredit en ExerciseSession schrijft (zie
// docs/LEERVOORTGANG.md). Routes en pagina's roepen alleen deze functies
// aan, ongeacht de leesroute of het boek.
//
// - Lezen (markReadingStarted, markChapterRead, de leesgedeelten van een
//   stap) geeft nooit XP en verlengt nooit de reeks.
// - Oefenen gaat altijd via een door de server uitgedeelde set
//   (issueExerciseSession/submitExerciseSession): alleen die vragen tellen,
//   alles moet beantwoord zijn, een set telt één keer, en de basis-XP per
//   inhoud is begrensd (rewards.ts), ook bij gelijktijdige inzendingen.
//
// Staat in de eager-keten van server.ts? Nee, maar houd het zo: geen
// next/headers of andere request-API's hier.

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";
import { isExerciseCorrect } from "@/lib/exerciseGen";
import { awardXp } from "@/lib/xp";
import { awardCompetitionXp } from "@/lib/competitionXp";
import { checkAndAwardAchievements } from "@/lib/achievements";
import { grantMilestoneFreeze, recordLearningActivity, type StudyResult } from "@/lib/streak";
import { contentKeyForChapter } from "@/lib/learning/contentIdentity";
import {
  pickChapterExercises,
  pickPartExercises,
  planChapterExercises,
  QUESTIONS_PER_PART,
  type ExercisePart,
  type ExercisePlan,
} from "@/lib/learning/exercisePlan";
import { applyAttempt, COMPLETION_BONUS, maxContentBaseXp, withLegacy, XP_PER_CORRECT } from "@/lib/learning/rewards";
import { resolveContentState, type ContentState, type StoredContentProgress } from "@/lib/learning/progressState";

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

/** Elke 10 hoofdstukken met een volledig gemaakte oefenset levert een freeze op. */
const CHAPTERS_MILESTONE_FOR_FREEZE = 10;
/** Niet ingeleverde sets (pagina geopend, niet afgemaakt) ruimen we na een week op. */
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// --- Oefenplan per hoofdstuk -------------------------------------------------
// Het plan hangt alleen af van de inhoud (verzen en goedgekeurde vragen), die
// alleen bij een import verandert. Kort cachen scheelt bij een cursuslijst
// van honderden hoofdstukken duizenden rijen per paginabezoek.

const PLAN_TTL_MS = 10 * 60 * 1000;
const planCache = new Map<string, { plan: ExercisePlan; at: number }>();

export async function getExercisePlans(db: Db, chapterIds: string[]): Promise<Map<string, ExercisePlan>> {
  const now = Date.now();
  const result = new Map<string, ExercisePlan>();
  const missing: string[] = [];
  for (const id of new Set(chapterIds)) {
    const cached = planCache.get(id);
    if (cached && now - cached.at < PLAN_TTL_MS) result.set(id, cached.plan);
    else missing.push(id);
  }
  if (missing.length > 0) {
    const [verseCounts, exercises] = await Promise.all([
      db.verse.groupBy({ by: ["chapterId"], where: { chapterId: { in: missing } }, _count: { _all: true } }),
      db.exercise.findMany({
        where: { chapterId: { in: missing }, status: "APPROVED" },
        orderBy: { order: "asc" },
        select: { id: true, chapterId: true, sourceVerse: { select: { number: true } } },
      }),
    ]);
    const verseCountById = new Map(verseCounts.map((row) => [row.chapterId, row._count._all]));
    const exercisesById = new Map<string, { id: string; verseNumber: number | null }[]>();
    for (const exercise of exercises) {
      const list = exercisesById.get(exercise.chapterId) ?? [];
      list.push({ id: exercise.id, verseNumber: exercise.sourceVerse?.number ?? null });
      exercisesById.set(exercise.chapterId, list);
    }
    for (const id of missing) {
      const plan = planChapterExercises(verseCountById.get(id) ?? 0, exercisesById.get(id) ?? []);
      planCache.set(id, { plan, at: now });
      result.set(id, plan);
    }
  }
  return result;
}

export async function getExercisePlan(db: Db, chapterId: string): Promise<ExercisePlan> {
  return (await getExercisePlans(db, [chapterId])).get(chapterId)!;
}

/** Het deel van het plan dat bij een stap hoort (zelfde versbereik). */
function partForStep(plan: ExercisePlan, startVerse: number, endVerse: number): ExercisePart {
  const exact = plan.parts.find((part) => part.startVerse === startVerse && part.endVerse === endVerse);
  if (exact) return exact;
  // De stappen zijn bij de laatste cursussync uit dezelfde indeling gemaakt;
  // wijkt het af (inhoud sindsdien gewijzigd), dan de vragen bij deze verzen.
  const pool = plan.parts.filter((part) => part.startVerse <= endVerse && part.endVerse >= startVerse).flatMap((part) => part.pool);
  return { index: -1, startVerse, endVerse, pool, count: Math.min(QUESTIONS_PER_PART, pool.length) };
}

// --- Inhoud en status ----------------------------------------------------------

interface ChapterRow {
  id: string;
  number: number;
  book: { key: string | null };
}

export function contentKeyOf(chapter: ChapterRow): string {
  return contentKeyForChapter({ id: chapter.id, number: chapter.number, bookKey: chapter.book.key });
}

async function loadChapter(db: Db, chapterId: string): Promise<ChapterRow & { verseCount: number }> {
  const chapter = await db.chapter.findUniqueOrThrow({
    where: { id: chapterId },
    select: { id: true, number: true, book: { select: { key: true } }, _count: { select: { verses: true } } },
  });
  return { id: chapter.id, number: chapter.number, book: chapter.book, verseCount: chapter._count.verses };
}

const STORED_FIELDS = {
  contentKey: true,
  readStatus: true,
  readVerse: true,
  exerciseAnswered: true,
  rewardCorrect: true,
  rewardBonusAt: true,
  legacyScore: true,
  legacyXp: true,
  legacyCompleted: true,
} as const;

export interface ChapterContentState extends ContentState {
  contentKey: string;
  /** Nog te verdienen basis-XP voor deze inhoud. */
  xpAvailable: number;
}

/** De status van een reeks hoofdstukken voor één gebruiker, per hoofdstuk-id. */
export async function getChapterStates(db: Db, userId: string, chapters: ChapterRow[]): Promise<Map<string, ChapterContentState>> {
  const keyById = new Map(chapters.map((chapter) => [chapter.id, contentKeyOf(chapter)]));
  const [plans, rows] = await Promise.all([
    getExercisePlans(db, chapters.map((chapter) => chapter.id)),
    db.contentProgress.findMany({ where: { userId, contentKey: { in: [...new Set(keyById.values())] } }, select: STORED_FIELDS }),
  ]);
  const rowByKey = new Map(rows.map((row) => [row.contentKey, row]));
  const states = new Map<string, ChapterContentState>();
  for (const chapter of chapters) {
    const key = keyById.get(chapter.id)!;
    const total = plans.get(chapter.id)?.total ?? 0;
    const row = rowByKey.get(key) ?? null;
    const state = resolveContentState(row as StoredContentProgress | null, total);
    const reward = withLegacy(
      { answered: row?.exerciseAnswered ?? 0, rewardCorrect: row?.rewardCorrect ?? 0, bonusAwarded: row?.rewardBonusAt != null },
      { legacyXp: row?.legacyXp ?? 0, legacyCompleted: row?.legacyCompleted ?? false },
      total
    );
    const earned = Math.min(total, reward.rewardCorrect) * XP_PER_CORRECT + (reward.bonusAwarded && total > 0 ? COMPLETION_BONUS : 0);
    states.set(chapter.id, { ...state, contentKey: key, xpAvailable: Math.max(0, maxContentBaseXp(total) - earned) });
  }
  return states;
}

export async function getChapterState(db: Db, userId: string, chapterId: string): Promise<ChapterContentState> {
  const chapter = await loadChapter(db, chapterId);
  return (await getChapterStates(db, userId, [chapter])).get(chapterId)!;
}

/** Hoeveel van deze hoofdstukken gelezen én geoefend zijn (afgerond). */
export async function countDoneChapters(db: Db, userId: string, chapters: ChapterRow[]): Promise<number> {
  const states = await getChapterStates(db, userId, chapters);
  return [...states.values()].filter((state) => state.done).length;
}

// --- Lezen: nooit XP, nooit reeks ------------------------------------------------

/** Iemand is in een hoofdstuk begonnen: "bezig", tenzij het al gelezen is. */
export async function markReadingStarted(userId: string, chapterId: string): Promise<void> {
  const chapter = await loadChapter(prisma, chapterId);
  const contentKey = contentKeyOf(chapter);
  const now = new Date();
  await prisma.contentProgress.upsert({
    where: { userId_contentKey: { userId, contentKey } },
    create: { userId, contentKey, lastChapterId: chapterId, readStatus: "READING", readStartedAt: now },
    update: { lastChapterId: chapterId },
  });
  await prisma.contentProgress.updateMany({
    where: { userId, contentKey, readStatus: null },
    data: { readStatus: "READING", readStartedAt: now },
  });
}

/** Het hele hoofdstuk als gelezen markeren (Vrije keuze, Hoofdstuk voor hoofdstuk). */
export async function markChapterRead(userId: string, chapterId: string): Promise<ChapterContentState> {
  const chapter = await loadChapter(prisma, chapterId);
  await recordReadThrough(prisma, userId, contentKeyOf(chapter), chapterId, chapter.verseCount, chapter.verseCount);
  return getChapterState(prisma, userId, chapterId);
}

/** Het leesgedeelte van een stap (Stap voor stap) is gelezen. */
export async function markStepRead(db: Db, userId: string, lessonId: string): Promise<void> {
  const lesson = await db.courseLesson.findUniqueOrThrow({ where: { id: lessonId }, select: { chapterId: true, endVerse: true } });
  const chapter = await loadChapter(db, lesson.chapterId);
  await recordReadThrough(db, userId, contentKeyOf(chapter), chapter.id, lesson.endVerse, chapter.verseCount);
}

/**
 * Lezen tot en met `throughVerse` (een leesgedeelte van een stap, of het
 * hele hoofdstuk). Gelezen zodra het laatste vers bereikt is. Gaat nooit
 * terug: een eerder gelezen hoofdstuk blijft gelezen.
 */
async function recordReadThrough(db: Db, userId: string, contentKey: string, chapterId: string, throughVerse: number, verseCount: number): Promise<void> {
  const now = new Date();
  const complete = verseCount > 0 && throughVerse >= verseCount;
  await db.contentProgress.upsert({
    where: { userId_contentKey: { userId, contentKey } },
    create: {
      userId,
      contentKey,
      lastChapterId: chapterId,
      readStatus: complete ? "READ" : "READING",
      readVerse: throughVerse,
      readStartedAt: now,
      readAt: complete ? now : null,
    },
    update: { lastChapterId: chapterId },
  });
  await db.contentProgress.updateMany({ where: { userId, contentKey, readVerse: { lt: throughVerse } }, data: { readVerse: throughVerse } });
  if (complete) {
    await db.contentProgress.updateMany({ where: { userId, contentKey, readAt: null }, data: { readAt: now } });
    await db.contentProgress.updateMany({ where: { userId, contentKey }, data: { readStatus: "READ" } });
  } else {
    await db.contentProgress.updateMany({ where: { userId, contentKey, readStatus: null }, data: { readStatus: "READING", readStartedAt: now } });
  }
}

// --- Oefenen ---------------------------------------------------------------------

export type ClientExerciseType = "FILL_BLANK" | "WORD_BANK" | "TRUE_FALSE" | "MULTIPLE_CHOICE" | "SEQUENCE";

export interface IssuedExercise {
  id: string;
  type: ClientExerciseType;
  verseRef: string;
  prompt: string;
  hint?: string;
  blanks: number;
  wordBank?: string[];
  options?: string[];
}

export interface IssuedSet {
  /** Null als er voor dit deel geen vragen zijn. */
  sessionId: string | null;
  exercises: IssuedExercise[];
}

/**
 * Deelt een oefenset uit: de volledige set van het hoofdstuk, of (met
 * `step`) de vragen van één leesgedeelte. Welke vragen precies is
 * willekeurig; hoeveel volgt uit het oefenplan en is in elke route gelijk.
 */
export async function issueExerciseSession(
  userId: string,
  chapterId: string,
  step?: { lessonId: string; startVerse: number; endVerse: number }
): Promise<IssuedSet> {
  const chapter = await loadChapter(prisma, chapterId);
  const plan = await getExercisePlan(prisma, chapterId);
  const ids = step ? pickPartExercises(partForStep(plan, step.startVerse, step.endVerse)) : pickChapterExercises(plan);

  await prisma.exerciseSession.deleteMany({
    where: { userId, submittedAt: null, createdAt: { lt: new Date(Date.now() - SESSION_MAX_AGE_MS) } },
  });
  if (ids.length === 0) return { sessionId: null, exercises: [] };

  const rows = await prisma.exercise.findMany({
    where: { id: { in: ids } },
    include: { options: { orderBy: { order: "asc" } } },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const exercises = ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => !!row)
    .map((e) => ({
      id: e.id,
      type: e.type as ClientExerciseType,
      verseRef: e.verseRef,
      prompt: e.prompt,
      hint: e.hint ?? undefined,
      blanks: (JSON.parse(e.answers) as string[]).length,
      wordBank: e.wordBank ? (JSON.parse(e.wordBank) as string[]) : undefined,
      options: e.options.length > 0 ? e.options.map((o) => o.label) : undefined,
    }));

  const session = await prisma.exerciseSession.create({
    data: {
      userId,
      chapterId,
      contentKey: contentKeyOf(chapter),
      exerciseIds: JSON.stringify(exercises.map((e) => e.id)),
      courseLessonId: step?.lessonId ?? null,
    },
  });
  return { sessionId: session.id, exercises };
}

export type ExerciseSessionErrorCode = "NOT_FOUND" | "ALREADY_SUBMITTED" | "INCOMPLETE" | "LOCKED";

export class ExerciseSessionError extends Error {
  constructor(public code: ExerciseSessionErrorCode) {
    super(code);
  }
}

export interface SubmittedAnswer {
  exerciseId: string;
  given: string[];
}

export interface ExerciseSessionContext {
  sessionId: string;
  userId: string;
  chapterId: string;
  contentKey: string;
  courseLessonId: string | null;
}

export interface ContentExerciseResult extends StudyResult {
  results: { exerciseId: string; correct: boolean; correctAnswer: string[] }[];
  correctCount: number;
  total: number;
  baseXp: number;
  bonusXp: number;
  repeatXp: number;
  content: ChapterContentState;
  chapterId: string;
}

export interface SessionHooks {
  /** Mag deze set nu ingeleverd worden? Gooi ExerciseSessionError("LOCKED") als dat niet zo is. */
  validate?: (tx: Tx, session: ExerciseSessionContext) => Promise<void>;
  /** Routegebonden boekhouding (bv. de stap afvinken), binnen dezelfde transactie. */
  afterGrade?: (tx: Tx, session: ExerciseSessionContext, outcome: { scorePercent: number; xpEarned: number }) => Promise<void>;
}

/**
 * Levert een uitgedeelde set in. Alles gebeurt in één transactie:
 * - de set wordt atomair geclaimd (submittedAt), dus dubbelklikken of twee
 *   gelijktijdige verzoeken leveren één keer XP op;
 * - per gebruiker en inhoud wordt vergrendeld, zodat twee verschillende sets
 *   over dezelfde inhoud de beloningsteller niet allebei vanaf dezelfde
 *   stand ophogen;
 * - XP volgt uit rewards.ts, de reeks uit recordLearningActivity.
 */
export async function submitExerciseSession(
  userId: string,
  sessionId: string,
  answers: SubmittedAnswer[],
  hooks: SessionHooks = {}
): Promise<ContentExerciseResult> {
  return prisma.$transaction(
    async (tx) => {
      // Dezelfde lockvolgorde als andere leeractiviteiten: gebruiker vóór XP/feed.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const session = await tx.exerciseSession.findUnique({ where: { id: sessionId } });
      if (!session || session.userId !== userId) throw new ExerciseSessionError("NOT_FOUND");
      if (session.submittedAt) throw new ExerciseSessionError("ALREADY_SUBMITTED");
      const context: ExerciseSessionContext = {
        sessionId,
        userId,
        chapterId: session.chapterId,
        contentKey: session.contentKey,
        courseLessonId: session.courseLessonId,
      };
      await hooks.validate?.(tx, context);

      const claimed = await tx.exerciseSession.updateMany({
        where: { id: sessionId, userId, submittedAt: null },
        data: { submittedAt: new Date() },
      });
      if (claimed.count === 0) throw new ExerciseSessionError("ALREADY_SUBMITTED");

      // Precies de uitgedeelde vragen, elk één keer, allemaal beantwoord.
      const issued = JSON.parse(session.exerciseIds) as string[];
      const givenById = new Map<string, string[]>();
      for (const answer of answers) {
        if (issued.includes(answer.exerciseId) && !givenById.has(answer.exerciseId)) givenById.set(answer.exerciseId, answer.given);
      }
      if (issued.length === 0 || givenById.size !== issued.length) throw new ExerciseSessionError("INCOMPLETE");

      const exercises = await tx.exercise.findMany({ where: { id: { in: issued } } });
      const results: ContentExerciseResult["results"] = [];
      for (const id of issued) {
        const exercise = exercises.find((e) => e.id === id);
        if (!exercise) throw new ExerciseSessionError("NOT_FOUND");
        const accepted = JSON.parse(exercise.answers) as string[];
        results.push({ exerciseId: id, correct: isExerciseCorrect(exercise.type, givenById.get(id)!, accepted), correctAnswer: accepted });
      }
      await tx.exerciseAttempt.createMany({
        data: results.map((r) => ({ userId, exerciseId: r.exerciseId, givenText: givenById.get(r.exerciseId)!.join(" "), correct: r.correct })),
      });
      const correctCount = results.filter((r) => r.correct).length;
      const scorePercent = Math.round((correctCount / results.length) * 100);

      // Eén inzending tegelijk per gebruiker en inhoud.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}), hashtext(${session.contentKey}))`;

      const credits = await tx.contentExerciseCredit.findMany({ where: { userId, exerciseId: { in: issued } } });
      const creditById = new Map(credits.map((c) => [c.exerciseId, c]));
      const newAnswered = results.filter((r) => !creditById.has(r.exerciseId));
      const newCorrect = results.filter((r) => r.correct && !creditById.get(r.exerciseId)?.correct);
      if (newAnswered.length > 0) {
        await tx.contentExerciseCredit.createMany({
          data: newAnswered.map((r) => ({ userId, exerciseId: r.exerciseId, contentKey: session.contentKey, correct: r.correct })),
          skipDuplicates: true,
        });
      }
      const improved = newCorrect.filter((r) => creditById.has(r.exerciseId)).map((r) => r.exerciseId);
      if (improved.length > 0) {
        await tx.contentExerciseCredit.updateMany({ where: { userId, exerciseId: { in: improved } }, data: { correct: true } });
      }

      const plan = await getExercisePlan(tx, session.chapterId);
      const total = plan.total;
      const row = await tx.contentProgress.upsert({
        where: { userId_contentKey: { userId, contentKey: session.contentKey } },
        create: { userId, contentKey: session.contentKey, lastChapterId: session.chapterId },
        update: { lastChapterId: session.chapterId },
      });
      const before = withLegacy(
        { answered: row.exerciseAnswered, rewardCorrect: row.rewardCorrect, bonusAwarded: row.rewardBonusAt !== null },
        { legacyXp: row.legacyXp, legacyCompleted: row.legacyCompleted },
        total
      );
      const outcome = applyAttempt(before, total, { newAnswered: newAnswered.length, newCorrect: newCorrect.length, correct: correctCount });
      const now = new Date();
      const exercisesCompletedNow = row.exercisesCompletedAt === null && total > 0 && outcome.next.answered >= total;
      await tx.contentProgress.update({
        where: { id: row.id },
        data: {
          exerciseAnswered: outcome.next.answered,
          rewardCorrect: outcome.next.rewardCorrect,
          rewardBonusAt: outcome.bonusXp > 0 ? now : undefined,
          exercisesCompletedAt: exercisesCompletedNow ? now : undefined,
          baseXpEarned: { increment: outcome.baseXp + outcome.bonusXp },
        },
      });

      // Een stap van een leesroute: dat leesgedeelte is daarmee gelezen.
      if (session.courseLessonId) await markStepRead(tx, userId, session.courseLessonId);

      const xpEarned = outcome.baseXp + outcome.bonusXp + outcome.repeatXp;
      await hooks.afterGrade?.(tx, context, { scorePercent, xpEarned });

      if (xpEarned > 0) {
        const metadata = {
          contentKey: session.contentKey,
          chapterId: session.chapterId,
          exerciseSessionId: sessionId,
          readingLessonId: session.courseLessonId ?? undefined,
          scorePercent,
          baseXp: outcome.baseXp,
          bonusXp: outcome.bonusXp,
          repeatXp: outcome.repeatXp,
        };
        await awardXp(tx, userId, xpEarned, "LESSON_COMPLETED", metadata);
        await awardCompetitionXp(tx, userId, "LESSON", xpEarned, { metadata });
      }

      let streak = await recordLearningActivity(tx, userId, { kind: "CONTENT_EXERCISES", answered: results.length, required: issued.length, key: `content:${sessionId}` });
      if (exercisesCompletedNow) {
        const completed = await tx.contentProgress.count({ where: { userId, exercisesCompletedAt: { not: null } } });
        if (completed % CHAPTERS_MILESTONE_FOR_FREEZE === 0) streak = await grantMilestoneFreeze(tx, userId, streak);
      }
      const newAchievements = await checkAndAwardAchievements(tx, userId);
      const content = (await getChapterStates(tx, userId, [await loadChapter(tx, session.chapterId)])).get(session.chapterId)!;

      return {
        results,
        correctCount,
        total: results.length,
        baseXp: outcome.baseXp,
        bonusXp: outcome.bonusXp,
        repeatXp: outcome.repeatXp,
        content,
        chapterId: session.chapterId,
        xpEarned,
        chapterCompleted: content.done,
        scorePercent,
        currentStreak: streak.currentStreak,
        longestStreak: streak.longestStreak,
        streakBroken: streak.streakBroken,
        freezeUsed: streak.freezeUsed,
        freezesEarned: streak.freezesEarned,
        freezeCount: streak.freezeCount,
        newAchievements,
        alreadyStudiedToday: streak.alreadyStudiedToday,
        dayEarned: streak.dayEarned,
      };
    },
    { timeout: 20000 }
  ).then((result) => {
    emitToUser(userId, "streak_changed", { dayEarned: result.dayEarned === true, currentStreak: result.currentStreak });
    return result;
  });
}

/**
 * Leesvoortgang opnieuw beginnen (profiel): lezen en de zichtbare
 * oefenvoortgang gaan terug naar nul, maar wat al beloond is blijft staan
 * (rewardCorrect, rewardBonusAt).
 * Anders is dezelfde basis-XP na een reset opnieuw te verdienen. Oude
 * voortgang (legacy) wordt daarvoor eerst omgerekend naar de vaste
 * beloningsteller, want die hangt af van het aantal vragen N.
 */
export async function resetReadingProgress(tx: Tx, userId: string): Promise<void> {
  const legacyRows = await tx.contentProgress.findMany({
    where: { userId, OR: [{ legacyXp: { gt: 0 } }, { legacyCompleted: true }] },
    select: { id: true, lastChapterId: true, rewardCorrect: true, rewardBonusAt: true, legacyXp: true, legacyCompleted: true },
  });
  const plans = await getExercisePlans(tx, legacyRows.flatMap((row) => (row.lastChapterId ? [row.lastChapterId] : [])));
  for (const row of legacyRows) {
    const total = row.lastChapterId ? plans.get(row.lastChapterId)?.total ?? 0 : 0;
    const reward = withLegacy(
      { answered: 0, rewardCorrect: row.rewardCorrect, bonusAwarded: row.rewardBonusAt !== null },
      { legacyXp: row.legacyXp, legacyCompleted: row.legacyCompleted },
      total
    );
    await tx.contentProgress.update({
      where: { id: row.id },
      data: {
        rewardCorrect: reward.rewardCorrect,
        rewardBonusAt: reward.bonusAwarded ? row.rewardBonusAt ?? new Date() : null,
        legacyXp: 0,
        legacyCompleted: false,
        legacyScore: null,
      },
    });
  }
  await tx.contentProgress.updateMany({
    where: { userId },
    data: { readStatus: null, readVerse: 0, readStartedAt: null, readAt: null, exerciseAnswered: 0, exercisesCompletedAt: null },
  });
  // Zonder deze rijen telt opnieuw oefenen weer als nieuwe voortgang. De
  // beloning kan daardoor niet boven het maximum per inhoud komen: de
  // teller rewardCorrect hierboven blijft staan en is begrensd op N.
  await tx.contentExerciseCredit.deleteMany({ where: { userId } });
}
