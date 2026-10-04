import type { ChapterGuessLevel, XPReason, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { userTimeZone } from "@/lib/timeZone";
import { awardXp } from "@/lib/xp";
import { checkAndAwardAchievements } from "@/lib/achievements";
import { awardCompetitionXp } from "@/lib/competitionXp";
import { XP_PER_CORRECT_LIGHT, applyRepeatDiscount } from "@/lib/xpRules";
import { notifyFreezeReceived } from "@/lib/notify";
import { qualifiesForStreak, type LearningActivity } from "@/lib/learning/streakRules";
import { continuationView } from "@/lib/learning/streakReturnRules";
import { settleStreakDays } from "@/lib/streakContinuation";
import { emitToUser } from "@/lib/realtime";

const PASS_THRESHOLD = 60; // percentage nodig om een les (podcast, kinderen, introductie) als voltooid te tellen
const STREAK_MILESTONE_FOR_FREEZE = 7; // elke 7-daagse streak levert een freeze op

export interface StudyResult {
  xpEarned: number;
  chapterCompleted: boolean;
  scorePercent: number;
  currentStreak: number;
  longestStreak: number;
  streakBroken: boolean;
  freezeUsed: boolean;
  freezesEarned: number;
  freezeCount: number;
  newAchievements: string[];
  // Had je vandaag al eerder iets afgerond? Dan is de reeks nu niet verder
  // opgelopen (die stond al goed) — de client gebruikt dit om de
  // vlammetje-viering alleen bij de EERSTE afronding per dag te tonen, niet
  // bij elke volgende les diezelfde dag.
  alreadyStudiedToday: boolean;
  dayEarned?: boolean;
  duplicate?: boolean;
}

type Tx = Prisma.TransactionClient;

async function activityTransaction(userId: string, work: (tx: Tx) => Promise<StudyResult>): Promise<StudyResult> {
  const result = await prisma.$transaction(work);
  // Pas na commit opnieuw uitlezen, ook op een ander geopend apparaat.
  emitToUser(userId, "streak_changed");
  return result;
}


export interface StreakSnapshot {
  dayEarned: boolean;
  duplicate: boolean;
  currentStreak: number;
  longestStreak: number;
  streakBroken: boolean;
  freezeUsed: boolean;
  freezesEarned: number;
  freezeCount: number;
  alreadyStudiedToday: boolean;
  /** Telde deze activiteit mee voor de reeks (zie qualifiesForStreak)? */
  counted: boolean;
}

/**
 * De enige ingang om de dagelijkse reeks bij te werken. Elke afgeronde
 * leeractiviteit meldt zich hier; of hij meetelt, beslist uitsluitend
 * qualifiesForStreak (src/lib/learning/streakRules.ts). Lezen telt nooit,
 * een lege of half afgemaakte inzending ook niet: dan blijft de reeks zoals
 * hij was.
 */
export async function recordLearningActivity(
  tx: Tx,
  userId: string,
  activity: LearningActivity & { key: string },
  /** Altijd de servertijd; alleen tests geven een ander moment mee. */
  now: Date = new Date()
): Promise<StreakSnapshot> {
  const { user, freezesUsed } = await settleStreakDays(tx, userId, now);
  const view = continuationView(user, now);
  const snapshot: StreakSnapshot = {
    currentStreak: user.currentStreak, longestStreak: user.longestStreak,
    streakBroken: false, freezeUsed: freezesUsed > 0, freezesEarned: 0,
    freezeCount: user.freezeCount, alreadyStudiedToday: view.studiedToday,
    counted: false, dayEarned: false, duplicate: false,
  };

  // De stabiele sleutel hoort bij de echte sessie/ronde, niet bij de request.
  // Hierdoor tellen retries ook op een latere dag niet opnieuw.
  const claimed = await tx.streakActivity.createMany({
    data: [{ userId, key: activity.key }], skipDuplicates: true,
  });
  if (!claimed.count) return { ...snapshot, duplicate: true };
  if (!qualifiesForStreak(activity)) return snapshot;

  if (user.streakInterruptedDay) {
    const completed = view.completed + 1;
    if (completed < view.required) {
      await tx.user.update({ where: { id: userId }, data: {
        streakReturnDay: view.day, streakReturnTimeZone: userTimeZone(user),
        streakReturnCount: completed, streakReturnRequired: view.required,
        streakReturnSeenAt: now,
      } });
      return { ...snapshot, counted: true };
    }
  } else if (view.studiedToday) {
    return { ...snapshot, counted: true };
  }

  const currentStreak = user.currentStreak + 1;
  const longestStreak = Math.max(user.longestStreak, currentStreak);
  const freezesEarned = currentStreak % STREAK_MILESTONE_FOR_FREEZE === 0 ? 1 : 0;
  const status = user.streakInterruptedDay ? "RETURNED" : "STUDIED";
  // Een terugkeerdag is één nieuwe dag. De gemiste dagen worden nooit gevuld.
  await tx.streakDay.upsert({
    where: { userId_dayKey: { userId, dayKey: view.day } },
    create: { userId, dayKey: view.day, status },
    update: { status },
  });
  await tx.user.update({ where: { id: userId }, data: {
    currentStreak, longestStreak, lastStudyDate: view.day,
    lastStudyTimeZone: userTimeZone(user), streakGraceDay: null,
    streakInterruptedDay: null, streakReturnDay: null, streakReturnTimeZone: null,
    streakReturnCount: 0, streakReturnRequired: 0, streakReturnSeenAt: null, streakReminderDay: 0,
    freezeCount: { increment: freezesEarned },
  } });
  if (freezesEarned) {
    await tx.freezeTransaction.create({
      data: { userId, type: "EARNED", amount: freezesEarned, reason: "Mijlpaal bereikt" },
    });
  }
  return {
    ...snapshot, currentStreak, longestStreak, counted: true, dayEarned: true,
    freezesEarned, freezeCount: user.freezeCount + freezesEarned,
  };
}

/** Een extra freeze voor een mijlpaal bovenop de reeks (bv. afgeronde hoofdstukken). */
export async function grantMilestoneFreeze(tx: Tx, userId: string, snapshot: StreakSnapshot): Promise<StreakSnapshot> {
  await tx.user.update({ where: { id: userId }, data: { freezeCount: { increment: 1 } } });
  await tx.freezeTransaction.create({ data: { userId, type: "EARNED", amount: 1, reason: "Mijlpaal bereikt" } });
  return { ...snapshot, freezesEarned: snapshot.freezesEarned + 1, freezeCount: snapshot.freezeCount + 1 };
}

interface ActivityXp {
  amount: number;
  reason: XPReason;
  metadata?: Record<string, unknown>;
  competitionKey: string;
  competition?: { won?: boolean; level?: string; metadata?: Record<string, unknown> };
}

/**
 * Gedeeld slot van elke afrondfunctie hieronder: reeks (volgens de
 * centrale regel), XP met audittrail, divisie-XP en prestaties.
 */
async function finishActivity(
  tx: Tx,
  userId: string,
  activity: LearningActivity & { key: string },
  xp: ActivityXp | null,
  result: { chapterCompleted: boolean; scorePercent: number }
): Promise<StudyResult> {
  const streak = await recordLearningActivity(tx, userId, activity);
  const amount = streak.duplicate ? 0 : xp?.amount ?? 0;
  if (xp && amount > 0) {
    await awardXp(tx, userId, amount, xp.reason, xp.metadata);
    await awardCompetitionXp(tx, userId, xp.competitionKey, amount, xp.competition);
  }
  const newAchievements = await checkAndAwardAchievements(tx, userId);
  return {
    xpEarned: amount,
    chapterCompleted: result.chapterCompleted,
    scorePercent: result.scorePercent,
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
    streakBroken: streak.streakBroken,
    freezeUsed: streak.freezeUsed,
    freezesEarned: streak.freezesEarned,
    freezeCount: streak.freezeCount,
    newAchievements,
    alreadyStudiedToday: streak.alreadyStudiedToday,
    dayEarned: streak.dayEarned,
    duplicate: streak.duplicate,
  };
}

function percent(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((correct / total) * 100);
}

/**
 * Een live quiz over een hoofdstuk afgerond (src/server/gameServer.ts). Een
 * spel, geen oefenset: het raakt de leesvoortgang en de basisbeloning van
 * het hoofdstuk niet (zie docs/LEERVOORTGANG.md), maar meespelen telt wel
 * als leeractiviteit voor de reeks.
 */
export async function completeLiveQuiz(
  userId: string,
  chapterId: string,
  scorePercent: number,
  xp: number,
  won: boolean,
  activityKey: string
): Promise<StudyResult> {
  const reason: XPReason = won ? "LIVE_GAME_WON" : "LIVE_GAME_PLAYED";
  return activityTransaction(userId, (tx) =>
    finishActivity(
      tx,
      userId,
      { kind: "GAME", answered: 1, required: 1, key: activityKey },
      { amount: xp, reason, metadata: { chapterId, scorePercent }, competitionKey: "LESSON", competition: { won, metadata: { chapterId, scorePercent, xpReason: reason } } },
      { chapterCompleted: false, scorePercent }
    )
  );
}

/**
 * Een korte, hoofdstukloze oefenronde ("Snelle ronde"): telt voor de reeks,
 * levert de lichte XP per goed antwoord op en raakt geen voortgang van
 * inhoud.
 */
export async function completeQuickPractice(userId: string, correctCount: number, total: number, activityKey: string): Promise<StudyResult> {
  const xp = correctCount * XP_PER_CORRECT_LIGHT;
  return activityTransaction(userId, (tx) =>
    finishActivity(
      tx,
      userId,
      { kind: "PRACTICE", answered: total, required: 1, key: activityKey },
      { amount: xp, reason: "QUICK_PRACTICE", metadata: { correctCount, total }, competitionKey: "QUICK_PRACTICE", competition: { metadata: { correctCount, total } } },
      { chapterCompleted: false, scorePercent: percent(correctCount, total) }
    )
  );
}

/**
 * Rondt een stap van Samen studeren af voor één deelnemer (zie
 * src/server/study.ts). Telt voor de reeks en geeft een lichte XP per goed
 * antwoord, maar schuift de cursus zelf niet door en raakt de
 * basisbeloning van de inhoud niet: de stap is door de host gekozen. De
 * competitie-XP heeft een eigen dagelijkse limiet.
 */
export async function completeStudyRound(userId: string, correctCount: number, answered: number, total: number, won: boolean, activityKey: string): Promise<StudyResult> {
  const xp = correctCount * XP_PER_CORRECT_LIGHT;
  return activityTransaction(userId, (tx) =>
    finishActivity(
      tx,
      userId,
      { kind: "GAME", answered, required: 1, key: activityKey },
      { amount: xp, reason: "STUDY_TOGETHER", metadata: { correctCount, total, won }, competitionKey: "STUDY_TOGETHER", competition: { won, metadata: { correctCount, total } } },
      { chapterCompleted: false, scorePercent: percent(correctCount, total) }
    )
  );
}

/** Een potje "Raad het hoofdstuk" (alleen of live, zie src/lib/chapterGuess.ts). */
export async function completeChapterGuess(
  userId: string,
  correctCount: number,
  total: number,
  level: ChapterGuessLevel | undefined,
  activityKey: string
): Promise<StudyResult> {
  const xp = correctCount * XP_PER_CORRECT_LIGHT;
  return activityTransaction(userId, (tx) =>
    finishActivity(
      tx,
      userId,
      { kind: "GAME", answered: total, required: 1, key: activityKey },
      { amount: xp, reason: "CHAPTER_GUESS_COMPLETED", metadata: { correctCount, total }, competitionKey: "CHAPTER_GUESS", competition: { level, metadata: { correctCount, total, level } } },
      { chapterCompleted: false, scorePercent: percent(correctCount, total) }
    )
  );
}

/**
 * Een potje van het dagelijkse woordspel (src/lib/wordGame.ts): winst of
 * verlies telt mee voor de reeks; de XP is vooraf berekend (bij verlies 0).
 */
export async function completeWordGame(userId: string, xpEarned: number, activityKey: string): Promise<StudyResult> {
  return activityTransaction(userId, (tx) =>
    finishActivity(
      tx,
      userId,
      { kind: "GAME", answered: 1, required: 1, key: activityKey },
      { amount: xpEarned, reason: "WORD_GAME_WON", metadata: { xpEarned }, competitionKey: "WORD_GAME" },
      { chapterCompleted: false, scorePercent: xpEarned > 0 ? 100 : 0 }
    )
  );
}

/**
 * De Slimste Heilige alleen gespeeld (src/lib/alleskenner/solo.ts): telt
 * voor de reeks; de XP is al berekend uit de eindstand.
 */
export async function completeAlleskennerSolo(
  userId: string,
  xpEarned: number,
  metadata: Record<string, unknown>,
  activityKey: string
): Promise<StudyResult> {
  return activityTransaction(userId, (tx) =>
    finishActivity(
      tx,
      userId,
      { kind: "GAME", answered: 1, required: 1, key: activityKey },
      { amount: xpEarned, reason: "ALLESKENNER_SOLO", metadata, competitionKey: "ALLESKENNER_SOLO" },
      { chapterCompleted: false, scorePercent: 100 }
    )
  );
}

interface LessonProgressRow {
  completed: boolean;
  bestScore: number;
}

/**
 * Gedeelde boekhouding voor cursussen met eigen lessen en vragen (podcast,
 * kinderen, introductie): één route per les, dus de herhalingskorting na een
 * perfecte score is hier genoeg om dubbele basis-XP te voorkomen. De les
 * telt pas mee voor de reeks als alle vragen beantwoord zijn.
 */
async function completeCourseLesson(
  tx: Tx,
  userId: string,
  existing: LessonProgressRow | null,
  save: (data: { nowCompleted: boolean; wasAlreadyCompleted: boolean; xpToAward: number }) => Promise<void>,
  attempt: { scorePercent: number; xp: number; answered: number; total: number },
  xp: Omit<ActivityXp, "amount">,
  activityKey: string
): Promise<StudyResult> {
  const wasAlreadyCompleted = existing?.completed ?? false;
  const nowCompleted = wasAlreadyCompleted || attempt.scorePercent >= PASS_THRESHOLD;
  const alreadyPerfect = (existing?.bestScore ?? 0) === 100;
  const xpToAward = alreadyPerfect ? applyRepeatDiscount(attempt.xp) : attempt.xp;
  const result = await finishActivity(
    tx,
    userId,
    { kind: "COURSE_LESSON", answered: attempt.answered, required: attempt.total, key: activityKey },
    { ...xp, amount: xpToAward },
    { chapterCompleted: nowCompleted, scorePercent: attempt.scorePercent }
  );
  if (!result.duplicate) await save({ nowCompleted, wasAlreadyCompleted, xpToAward });
  // Cursusprestaties hebben ook de zojuist opgeslagen voortgang nodig.
  if (!result.duplicate) result.newAchievements.push(...await checkAndAwardAchievements(tx, userId));
  return result;
}

function progressData(userId: string, scorePercent: number, existing: LessonProgressRow | null, d: { nowCompleted: boolean; wasAlreadyCompleted: boolean; xpToAward: number }) {
  return {
    create: { userId, completed: d.nowCompleted, bestScore: scorePercent, xpEarned: d.xpToAward, completedAt: d.nowCompleted ? new Date() : null },
    update: {
      completed: d.nowCompleted,
      bestScore: Math.max(existing?.bestScore ?? 0, scorePercent),
      xpEarned: { increment: d.xpToAward },
      completedAt: !d.wasAlreadyCompleted && d.nowCompleted ? new Date() : undefined,
    },
  };
}

/** Eén van de twee modi (inhoud/verband) van een podcastaflevering afgerond. */
export async function completePodcastLesson(
  userId: string,
  episodeId: string,
  mode: "CONTENT" | "BOM_CONNECTION",
  scorePercent: number,
  xpForThisAttempt: number,
  answered: number,
  total: number,
  activityKey: string
): Promise<StudyResult> {
  return activityTransaction(userId, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const where = { userId_episodeId_mode: { userId, episodeId, mode } };
    const existing = await tx.podcastEpisodeProgress.findUnique({ where });
    return completeCourseLesson(
      tx,
      userId,
      existing,
      async (d) => {
        const data = progressData(userId, scorePercent, existing, d);
        await tx.podcastEpisodeProgress.upsert({ where, create: { ...data.create, episodeId, mode }, update: data.update });
      },
      { scorePercent, xp: xpForThisAttempt, answered, total },
      { reason: "PODCAST_LESSON_COMPLETED", metadata: { episodeId, mode, scorePercent }, competitionKey: "PODCAST_LESSON", competition: { metadata: { episodeId, mode, scorePercent } } },
      activityKey
    );
  });
}

/** Een verhaal uit de kindercursus afgerond. */
export async function completeKidsStory(
  userId: string,
  storyId: string,
  scorePercent: number,
  xpForThisAttempt: number,
  answered: number,
  total: number,
  activityKey: string
): Promise<StudyResult> {
  return activityTransaction(userId, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const where = { userId_storyId: { userId, storyId } };
    const existing = await tx.kidsStoryProgress.findUnique({ where });
    return completeCourseLesson(
      tx,
      userId,
      existing,
      async (d) => {
        const data = progressData(userId, scorePercent, existing, d);
        await tx.kidsStoryProgress.upsert({ where, create: { ...data.create, storyId }, update: data.update });
      },
      { scorePercent, xp: xpForThisAttempt, answered, total },
      { reason: "KIDS_STORY_COMPLETED", metadata: { storyId, scorePercent }, competitionKey: "KIDS_STORY", competition: { metadata: { storyId, scorePercent } } },
      activityKey
    );
  });
}

/** Een les uit de introductiecursus afgerond. */
export async function completeIntroLesson(
  userId: string,
  lessonId: string,
  scorePercent: number,
  xpForThisAttempt: number,
  answered: number,
  total: number,
  activityKey: string
): Promise<StudyResult> {
  return activityTransaction(userId, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const where = { userId_lessonId: { userId, lessonId } };
    const existing = await tx.introLessonProgress.findUnique({ where });
    return completeCourseLesson(
      tx,
      userId,
      existing,
      async (d) => {
        const data = progressData(userId, scorePercent, existing, d);
        await tx.introLessonProgress.upsert({ where, create: { ...data.create, lessonId }, update: data.update });
      },
      { scorePercent, xp: xpForThisAttempt, answered, total },
      { reason: "INTRO_LESSON_COMPLETED", metadata: { lessonId, scorePercent }, competitionKey: "INTRO_LESSON", competition: { metadata: { lessonId, scorePercent } } },
      activityKey
    );
  });
}

/** Geeft een streak freeze weg aan een vriend. */
export async function giftFreeze(fromUserId: string, toUserId: string) {
  if (fromUserId === toUserId) {
    throw new Error("Je kan geen freeze aan jezelf geven.");
  }
  const sender = await prisma.$transaction(async (tx) => {
    const sender = await tx.user.findUniqueOrThrow({ where: { id: fromUserId } });
    // Atomair afboeken: twee gelijktijdige cadeaus mogen samen nooit meer
    // freezes weggeven dan de gever heeft.
    const debited = await tx.user.updateMany({
      where: { id: fromUserId, freezeCount: { gte: 1 } },
      data: { freezeCount: { decrement: 1 } },
    });
    if (debited.count === 0) {
      throw new Error("Je hebt geen streak freeze om weg te geven.");
    }
    await tx.user.update({
      where: { id: toUserId },
      data: { freezeCount: { increment: 1 } },
    });
    await tx.freezeTransaction.create({
      data: { userId: fromUserId, type: "GIFT_SENT", amount: -1, relatedId: toUserId },
    });
    await tx.freezeTransaction.create({
      data: { userId: toUserId, type: "GIFT_RECEIVED", amount: 1, relatedId: fromUserId },
    });
    await checkAndAwardAchievements(tx, fromUserId);
    return sender;
  });

  // Pas na de commit versturen: mail/push binnen de transactie kan de
  // transactie laten verlopen (standaard 5 s), waarna het cadeau wordt
  // teruggedraaid terwijl de ontvanger de melding al heeft.
  await notifyFreezeReceived(toUserId, `${sender.handle}#${sender.discriminator}`).catch(() => {});
}
