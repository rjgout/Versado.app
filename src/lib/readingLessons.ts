import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";
import { recordLearningActivity } from "@/lib/streak";
import {
  ExerciseSessionError,
  getChapterStates,
  markStepRead,
  type ContentExerciseResult,
  type SessionHooks,
  type SubmittedAnswer,
  submitExerciseSession,
} from "@/lib/learning/contentProgress";

// Stap voor stap: de route die een hoofdstuk in leesgedeelten (stappen)
// aanbiedt, met per stap de vragen van dat deel. Alleen de presentatie is
// hier routegebonden (volgorde, welke stap open is); voortgang en beloning
// gaan via de gedeelde voortgang per inhoud (src/lib/learning/).

type Db = PrismaClient | Prisma.TransactionClient;

export interface StepStatus {
  id: string;
  chapterId: string;
  order: number;
  startVerse: number;
  endVerse: number;
  /** Afgevinkt in deze route, of het hoofdstuk is (via welke route ook) gelezen én geoefend. */
  done: boolean;
  /** Mag nu geopend worden. */
  available: boolean;
}

export interface StepOverview {
  steps: StepStatus[];
  /** De eerste stap die nog niet af is: "vandaag". */
  next: StepStatus | null;
}

/**
 * De status van alle stappen van een cursus voor één gebruiker. Een stap is
 * open als hij af is, of als alle eerdere stappen van zijn hoofdstuk af zijn
 * én het hoofdstuk aan de beurt is: het hoofdstuk van de volgende stap of
 * eerder, of een hoofdstuk waar je (in welke route ook) al mee bezig bent.
 * Zo kun je een lang hoofdstuk dat je via een andere route begon, hier in
 * stappen afmaken.
 */
export async function getStepOverview(db: Db, userId: string, courseId: string): Promise<StepOverview> {
  const lessons = await db.courseLesson.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      chapterId: true,
      order: true,
      startVerse: true,
      endVerse: true,
      chapter: { select: { id: true, number: true, book: { select: { key: true } } } },
      progress: { where: { userId, completed: true }, select: { id: true } },
    },
  });
  const chapters = [...new Map(lessons.map((lesson) => [lesson.chapterId, lesson.chapter])).values()];
  const states = await getChapterStates(db, userId, chapters);

  const steps: StepStatus[] = lessons.map((lesson) => ({
    id: lesson.id,
    chapterId: lesson.chapterId,
    order: lesson.order,
    startVerse: lesson.startVerse,
    endVerse: lesson.endVerse,
    done: lesson.progress.length > 0 || (states.get(lesson.chapterId)?.done ?? false),
    available: false,
  }));
  const next = steps.find((step) => !step.done) ?? null;
  const firstOrderByChapter = new Map<string, number>();
  for (const step of steps) if (!firstOrderByChapter.has(step.chapterId)) firstOrderByChapter.set(step.chapterId, step.order);

  let previousInChapterDone = true;
  let previousChapterId: string | null = null;
  for (const step of steps) {
    if (step.chapterId !== previousChapterId) previousInChapterDone = true;
    const state = states.get(step.chapterId);
    const started = state ? state.read !== "UNREAD" || state.exercisesAnswered > 0 : false;
    const chapterOpen = next === null || firstOrderByChapter.get(step.chapterId)! <= next.order || started;
    step.available = step.done || (chapterOpen && previousInChapterDone);
    previousInChapterDone = previousInChapterDone && step.done;
    previousChapterId = step.chapterId;
  }
  return { steps, next };
}

async function stepAvailable(db: Db, userId: string, lessonId: string): Promise<{ courseId: string; available: boolean }> {
  const lesson = await db.courseLesson.findUnique({ where: { id: lessonId }, select: { courseId: true, course: { select: { type: true } } } });
  if (!lesson || lesson.course.type !== "READING_LESSONS") throw new ExerciseSessionError("NOT_FOUND");
  const overview = await getStepOverview(db, userId, lesson.courseId);
  return { courseId: lesson.courseId, available: overview.steps.find((step) => step.id === lessonId)?.available ?? false };
}

/** Na het afronden van een stap: afvinken in deze route en de cursor bijwerken. */
async function recordStepDone(tx: Prisma.TransactionClient, userId: string, lessonId: string, courseId: string, scorePercent: number, xpEarned: number) {
  const existing = await tx.userCourseLessonProgress.findUnique({ where: { userId_lessonId: { userId, lessonId } } });
  await tx.userCourseLessonProgress.upsert({
    where: { userId_lessonId: { userId, lessonId } },
    create: { userId, lessonId, completed: true, bestScore: scorePercent, xpEarned, completedAt: new Date() },
    update: {
      completed: true,
      bestScore: Math.max(existing?.bestScore ?? 0, scorePercent),
      xpEarned: { increment: xpEarned },
      completedAt: existing?.completedAt ?? new Date(),
    },
  });
  const overview = await getStepOverview(tx, userId, courseId);
  await tx.userCourseProgress.upsert({
    where: { userId_courseId: { userId, courseId } },
    create: { userId, courseId, currentLessonId: overview.next?.id ?? null, currentChapterId: overview.next?.chapterId ?? null },
    update: { currentLessonId: overview.next?.id ?? null, currentChapterId: overview.next?.chapterId ?? null, lastActivityAt: new Date() },
  });
  return overview.next?.id ?? null;
}

export interface ReadingLessonResult extends ContentExerciseResult {
  nextLessonId: string | null;
}

/** Levert de vragen van een stap in (zie submitExerciseSession). */
export async function completeReadingLesson(userId: string, lessonId: string, sessionId: string, answers: SubmittedAnswer[]): Promise<ReadingLessonResult> {
  let nextLessonId: string | null = null;
  const hooks: SessionHooks = {
    validate: async (tx, session) => {
      if (session.courseLessonId !== lessonId) throw new ExerciseSessionError("NOT_FOUND");
      const { available } = await stepAvailable(tx, userId, lessonId);
      if (!available) throw new ExerciseSessionError("LOCKED");
    },
    afterGrade: async (tx, _session, outcome) => {
      const lesson = await tx.courseLesson.findUniqueOrThrow({ where: { id: lessonId }, select: { courseId: true } });
      nextLessonId = await recordStepDone(tx, userId, lessonId, lesson.courseId, outcome.scorePercent, outcome.xpEarned);
    },
  };
  const result = await submitExerciseSession(userId, sessionId, answers, hooks);
  return { ...result, nextLessonId };
}

/**
 * Een stap zonder vragen: alleen lezen. De stap is af en het leesgedeelte
 * gelezen. Dit levert geen XP op, maar de uitdrukkelijk afgeronde stap telt
 * wel (één keer per stap) als activiteit voor de reeks.
 */
export async function completeReadingOnlyStep(userId: string, lessonId: string): Promise<{ nextLessonId: string | null }> {
  const { nextLessonId, streak } = await prisma.$transaction(async (tx) => {
    const { courseId, available } = await stepAvailable(tx, userId, lessonId);
    if (!available) throw new ExerciseSessionError("LOCKED");
    await markStepRead(tx, userId, lessonId);
    const nextLessonId = await recordStepDone(tx, userId, lessonId, courseId, 100, 0);
    const streak = await recordLearningActivity(tx, userId, { kind: "READING", answered: 1, required: 1, key: `read-step:${lessonId}` });
    return { nextLessonId, streak };
  });
  if (streak.counted) emitToUser(userId, "streak_changed", { dayEarned: streak.dayEarned, currentStreak: streak.currentStreak });
  return { nextLessonId };
}
