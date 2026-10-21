import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { findDuplicateReadingCourses, type DuplicateGroup } from "./courseIntegrity";
import type { ReadingPathCourseType } from "./readingCourses";

// Herstel van dubbele leescursussen (zie docs/CURSUSIDENTITEIT.md). Twee stappen die nooit samenvallen met een normale import of build:
//   planDuplicateRepair  — alleen lezen: inventaris per dubbele cursus en een oordeel per groep ("merge" of "blocked").
//   applyDuplicateRepair — voert alleen groepen uit die "merge" zijn, elke groep in één transactie met hervalidatie en een
//                          eindcontrole; elke afhankelijkheid verhuist naar de canonieke cursus, er wordt niets overschreven met
//                          minder voortgang (alleen maximum/samenvoegen) en daarna pas wordt de dubbele cursus verwijderd.
// Idempotent: na een geslaagde run is er niets meer te plannen.

export interface CourseInventory {
  id: string;
  slug: string;
  canonical: boolean;
  chapters: number;
  lessons: number;
  subscriptions: number;
  usersWithProgress: number;
  activeForUsers: number;
  lessonProgressRows: number;
  exerciseSessions: number;
  studySessions: number;
  listOrderRows: number;
  feedbackRows: number;
  /** Samen-studeren-rondes en feedbackregels die via tekst naar een les van deze cursus wijzen. */
  looseLessonRefs: number;
}

export interface RepairGroupPlan {
  group: DuplicateGroup;
  canonicalId: string | null;
  duplicateIds: string[];
  inventory: CourseInventory[];
  verdict: "merge" | "blocked";
  /** Waarom een groep geblokkeerd is of welke samenvoegregels ertoe doen (voor de beheerder). */
  notes: string[];
}

type Db = PrismaClient | Prisma.TransactionClient;

async function inventory(db: Db, course: { id: string; slug: string; canonical: boolean }): Promise<CourseInventory> {
  const lessonIds = (await db.courseLesson.findMany({ where: { courseId: course.id }, select: { id: true } })).map((lesson) => lesson.id);
  const loose = await looseLessonRefs(db, lessonIds);
  const looseCount = [...loose.rounds.values(), ...loose.feedback.values()].reduce((sum, count) => sum + count, 0);
  const [chapters, lessons, subscriptions, usersWithProgress, activeForUsers, lessonProgressRows, exerciseSessions, studySessions, listOrderRows, feedbackRows] = await Promise.all([
    db.courseChapter.count({ where: { courseId: course.id } }),
    db.courseLesson.count({ where: { courseId: course.id } }),
    db.userCourseProgress.count({ where: { courseId: course.id, subscribed: true } }),
    db.userCourseProgress.count({ where: { courseId: course.id } }),
    db.user.count({ where: { activeCourseId: course.id } }),
    db.userCourseLessonProgress.count({ where: { lesson: { courseId: course.id } } }),
    db.exerciseSession.count({ where: { courseLesson: { courseId: course.id } } }),
    db.studySession.count({ where: { courseId: course.id } }),
    db.userListOrder.count({ where: { listKey: "courses", itemKey: course.id } }),
    db.feedback.count({ where: { courseId: course.id } }),
  ]);
  return { id: course.id, slug: course.slug, canonical: course.canonical, chapters, lessons, subscriptions, usersWithProgress, activeForUsers, lessonProgressRows, exerciseSessions, studySessions, listOrderRows, feedbackRows, looseLessonRefs: looseCount };
}

// Gelijkwaardig = zelfde hoofdstuk, beginvers én eindvers: dezelfde beginvers met een ander eindvers is een ander leesgedeelte
// (andere oefeningen), en daar mag voortgang niet in samenvloeien.
const lessonKey = (lesson: { chapterId: string; startVerse: number; endVerse: number }) => `${lesson.chapterId}:${lesson.startVerse}:${lesson.endVerse}`;

/** Samen studeren bewaart een les als tekst ("rl:<courseLessonId>") zonder foreign key. */
const studyUnitKey = (lessonId: string) => `rl:${lessonId}`;

/**
 * Losse verwijzingen (tekst, geen foreign key) naar lessen van de dubbele cursus: Samen-studeren-rondes (`StudyRound.unitKey`)
 * en feedback (`Feedback.lessonId`, bij leeslesvragen een CourseLesson-id). Een id kan alleen een lesverwijzing zijn als het
 * een bestaande les van de dubbele cursus is; id's van intro-, kinder- en podcastlessen botsen daar niet mee (cuid).
 */
async function looseLessonRefs(db: Db, lessonIds: string[]): Promise<{ rounds: Map<string, number>; feedback: Map<string, number> }> {
  const rounds = new Map<string, number>();
  const feedback = new Map<string, number>();
  if (lessonIds.length === 0) return { rounds, feedback };
  const [roundRows, feedbackRows] = await Promise.all([
    db.studyRound.groupBy({ by: ["unitKey"], where: { unitKey: { in: lessonIds.map(studyUnitKey) } }, _count: { _all: true } }),
    db.feedback.groupBy({ by: ["lessonId"], where: { lessonId: { in: lessonIds } }, _count: { _all: true } }),
  ]);
  for (const row of roundRows) rounds.set(row.unitKey.slice(3), row._count._all);
  for (const row of feedbackRows) if (row.lessonId) feedback.set(row.lessonId, row._count._all);
  return { rounds, feedback };
}

/**
 * Lessen van de dubbele cursus met gebruikersgegevens of losse verwijzingen die geen gelijkwaardige les (hoofdstuk, beginvers
 * en eindvers) in de canonieke cursus hebben. Zulke gegevens kunnen niet veilig worden vertaald: de groep wordt dan geblokkeerd.
 */
async function unmappedLessonsWithData(db: Db, canonicalId: string, duplicateId: string): Promise<string[]> {
  const [canonical, duplicate] = await Promise.all([
    db.courseLesson.findMany({ where: { courseId: canonicalId }, select: { chapterId: true, startVerse: true, endVerse: true } }),
    db.courseLesson.findMany({
      where: { courseId: duplicateId },
      select: { id: true, chapterId: true, startVerse: true, endVerse: true, _count: { select: { progress: true, exerciseSessions: true, currentForCourseProgress: true } } },
    }),
  ]);
  const known = new Set(canonical.map(lessonKey));
  const refs = await looseLessonRefs(db, duplicate.map((lesson) => lesson.id));
  return duplicate
    .filter(
      (lesson) =>
        !known.has(lessonKey(lesson)) &&
        (lesson._count.progress > 0 ||
          lesson._count.exerciseSessions > 0 ||
          lesson._count.currentForCourseProgress > 0 ||
          refs.rounds.has(lesson.id) ||
          refs.feedback.has(lesson.id)),
    )
    .map((lesson) => lesson.id);
}

export async function planDuplicateRepair(db: PrismaClient): Promise<RepairGroupPlan[]> {
  const groups = await findDuplicateReadingCourses(db);
  const plans: RepairGroupPlan[] = [];
  for (const group of groups) {
    const canonical = group.courses.filter((course) => course.canonical);
    const notes: string[] = [];
    let canonicalId: string | null = null;
    if (canonical.length === 1) canonicalId = canonical[0].id;
    else notes.push(canonical.length === 0 ? `Geen cursus met de canonieke slug ${group.canonicalSlug}; kies handmatig.` : "Meerdere canonieke cursussen; kies handmatig.");
    const duplicateIds = group.courses.filter((course) => course.id !== canonicalId).map((course) => course.id);
    const inv = await Promise.all(group.courses.map((course) => inventory(db, course)));
    let verdict: RepairGroupPlan["verdict"] = canonicalId ? "merge" : "blocked";
    if (canonicalId && group.type === "READING_LESSONS") {
      for (const duplicateId of duplicateIds) {
        const lost = await unmappedLessonsWithData(db, canonicalId, duplicateId);
        if (lost.length > 0) {
          verdict = "blocked";
          notes.push(`Cursus ${duplicateId}: ${lost.length} les(sen) met gebruikersgegevens of verwijzingen (voortgang, oefensessies, Samen-studeren-rondes, feedback) zonder gelijkwaardige les (hoofdstuk + beginvers + eindvers) in de canonieke cursus; handmatige beoordeling nodig.`);
        }
      }
    }
    if (verdict === "merge") notes.push("Samenvoegregels: voltooid = of, beste score en XP = maximum, abonnement = of, plek en combo van de recentste activiteit.");
    plans.push({ group, canonicalId, duplicateIds, inventory: inv, verdict, notes });
  }
  return plans;
}

export interface RepairResult {
  merged: Array<{ canonicalId: string; duplicateId: string; moved: Record<string, number> }>;
  blocked: RepairGroupPlan[];
}

async function mergeOne(tx: Prisma.TransactionClient, type: ReadingPathCourseType, canonicalId: string, duplicateId: string): Promise<Record<string, number>> {
  const moved: Record<string, number> = {};
  const bump = (name: string, count = 1) => void (moved[name] = (moved[name] ?? 0) + count);
  const [canonicalCourse, duplicateCourse] = await Promise.all([
    tx.course.findUnique({ where: { id: canonicalId }, select: { type: true, contentCollectionId: true } }),
    tx.course.findUnique({ where: { id: duplicateId }, select: { type: true, contentCollectionId: true } }),
  ]);
  if (!canonicalCourse || !duplicateCourse) throw new Error("Cursus bestaat niet meer; herstel afgebroken.");
  if (canonicalCourse.type !== type || duplicateCourse.type !== type || canonicalCourse.contentCollectionId !== duplicateCourse.contentCollectionId)
    throw new Error("Cursussen horen niet bij dezelfde collectie en hetzelfde type; herstel afgebroken.");

  // Lessen (alleen Stap voor stap): gelijkwaardig = zelfde hoofdstuk, beginvers en eindvers.
  const lessonMap = new Map<string, string>();
  let duplicateLessonIds: string[] = [];
  if (type === "READING_LESSONS") {
    const [canonicalLessons, duplicateLessons] = await Promise.all([
      tx.courseLesson.findMany({ where: { courseId: canonicalId }, select: { id: true, chapterId: true, startVerse: true, endVerse: true } }),
      tx.courseLesson.findMany({ where: { courseId: duplicateId }, select: { id: true, chapterId: true, startVerse: true, endVerse: true } }),
    ]);
    duplicateLessonIds = duplicateLessons.map((lesson) => lesson.id);
    const byKey = new Map(canonicalLessons.map((lesson) => [lessonKey(lesson), lesson.id]));
    for (const lesson of duplicateLessons) {
      const target = byKey.get(lessonKey(lesson));
      if (target) lessonMap.set(lesson.id, target);
    }
    for (const [fromId, toId] of lessonMap) {
      const rows = await tx.userCourseLessonProgress.findMany({ where: { lessonId: fromId } });
      for (const row of rows) {
        const existing = await tx.userCourseLessonProgress.findUnique({ where: { userId_lessonId: { userId: row.userId, lessonId: toId } } });
        if (!existing) {
          await tx.userCourseLessonProgress.update({ where: { id: row.id }, data: { lessonId: toId } });
        } else {
          // Nooit minder voortgang: voltooid als één van beide voltooid is, beste score en XP als maximum, vroegste voltooiing.
          const completedAts = [existing.completedAt, row.completedAt].filter((at): at is Date => at !== null);
          await tx.userCourseLessonProgress.update({
            where: { id: existing.id },
            data: {
              completed: existing.completed || row.completed,
              bestScore: Math.max(existing.bestScore, row.bestScore),
              xpEarned: Math.max(existing.xpEarned, row.xpEarned),
              completedAt: completedAts.length ? new Date(Math.min(...completedAts.map((at) => at.getTime()))) : null,
            },
          });
          await tx.userCourseLessonProgress.delete({ where: { id: row.id } });
        }
        bump("lessonProgress");
      }
      bump("exerciseSessions", (await tx.exerciseSession.updateMany({ where: { courseLessonId: fromId }, data: { courseLessonId: toId } })).count);
      // Losse tekstverwijzingen naar dezelfde les: Samen-studeren-rondes ("rl:<id>") en feedbackcontext.
      bump("studyRounds", (await tx.studyRound.updateMany({ where: { unitKey: studyUnitKey(fromId) }, data: { unitKey: studyUnitKey(toId) } })).count);
      bump("feedbackLessons", (await tx.feedback.updateMany({ where: { lessonId: fromId }, data: { lessonId: toId } })).count);
    }
  }

  // Cursusvoortgang per gebruiker.
  const progressRows = await tx.userCourseProgress.findMany({ where: { courseId: duplicateId } });
  for (const row of progressRows) {
    const mappedLesson = row.currentLessonId ? lessonMap.get(row.currentLessonId) ?? null : null;
    const existing = await tx.userCourseProgress.findUnique({ where: { userId_courseId: { userId: row.userId, courseId: canonicalId } } });
    if (!existing) {
      await tx.userCourseProgress.update({ where: { id: row.id }, data: { courseId: canonicalId, currentLessonId: row.currentLessonId ? mappedLesson : null } });
    } else {
      // De plek en combo volgen de recentste activiteit; abonnement blijft zodra één van beide actief is; nooit een oudere plek over een nieuwere.
      const newer = row.lastActivityAt.getTime() > existing.lastActivityAt.getTime() ? row : existing;
      const newerLesson = newer === row ? mappedLesson : existing.currentLessonId;
      await tx.userCourseProgress.update({
        where: { id: existing.id },
        data: {
          subscribed: existing.subscribed || row.subscribed,
          lastActivityAt: newer.lastActivityAt,
          currentChapterId: newer.currentChapterId,
          currentLessonId: newerLesson,
          comboCount: newer.comboCount,
          comboLastCompletedAt: newer.comboLastCompletedAt,
        },
      });
      await tx.userCourseProgress.delete({ where: { id: row.id } });
    }
    bump("courseProgress");
  }

  bump("activeCourse", (await tx.user.updateMany({ where: { activeCourseId: duplicateId }, data: { activeCourseId: canonicalId } })).count);
  bump("studySessions", (await tx.studySession.updateMany({ where: { courseId: duplicateId }, data: { courseId: canonicalId } })).count);
  bump("feedback", (await tx.feedback.updateMany({ where: { courseId: duplicateId }, data: { courseId: canonicalId } })).count);

  // Persoonlijke cursusvolgorde (itemKey = cursus-id, geen foreign key): de canonieke rij wint, verborgen alleen als beide verborgen zijn.
  const orders = await tx.userListOrder.findMany({ where: { listKey: "courses", itemKey: duplicateId } });
  for (const row of orders) {
    const existing = await tx.userListOrder.findUnique({ where: { userId_listKey_itemKey: { userId: row.userId, listKey: "courses", itemKey: canonicalId } } });
    if (!existing) await tx.userListOrder.update({ where: { id: row.id }, data: { itemKey: canonicalId } });
    else {
      await tx.userListOrder.update({ where: { id: existing.id }, data: { hidden: existing.hidden && row.hidden } });
      await tx.userListOrder.delete({ where: { id: row.id } });
    }
    bump("listOrder");
  }

  // Eindcontrole: er mag niets meer naar de dubbele cursus wijzen dat niet afgeleid is (hoofdstukkoppelingen, lessen en hun oefeningen), ook geen losse tekstverwijzingen.
  const left = {
    progress: await tx.userCourseProgress.count({ where: { courseId: duplicateId } }),
    lessonProgress: await tx.userCourseLessonProgress.count({ where: { lesson: { courseId: duplicateId } } }),
    sessions: await tx.exerciseSession.count({ where: { courseLesson: { courseId: duplicateId } } }),
    active: await tx.user.count({ where: { activeCourseId: duplicateId } }),
    study: await tx.studySession.count({ where: { courseId: duplicateId } }),
    order: await tx.userListOrder.count({ where: { listKey: "courses", itemKey: duplicateId } }),
    current: await tx.userCourseProgress.count({ where: { currentLesson: { courseId: duplicateId } } }),
    // Losse verwijzingen die niet naar de lessen van de dubbele cursus mogen blijven wijzen (die verdwijnen met de cursus).
    studyRounds: duplicateLessonIds.length ? await tx.studyRound.count({ where: { unitKey: { in: duplicateLessonIds.map(studyUnitKey) } } }) : 0,
    feedbackLessons: duplicateLessonIds.length ? await tx.feedback.count({ where: { lessonId: { in: duplicateLessonIds } } }) : 0,
  };
  if (Object.values(left).some((count) => count > 0)) throw new Error(`Er verwijzen nog gegevens naar de dubbele cursus (${JSON.stringify(left)}); herstel teruggedraaid.`);
  await tx.course.delete({ where: { id: duplicateId } });
  return moved;
}

/** Voert alleen groepen met oordeel "merge" uit; elke dubbele cursus in een eigen transactie. Geblokkeerde groepen worden niet aangeraakt. */
export async function applyDuplicateRepair(db: PrismaClient, plans?: RepairGroupPlan[]): Promise<RepairResult> {
  const fresh = plans ?? (await planDuplicateRepair(db));
  const result: RepairResult = { merged: [], blocked: fresh.filter((plan) => plan.verdict === "blocked") };
  for (const plan of fresh) {
    if (plan.verdict !== "merge" || !plan.canonicalId) continue;
    for (const duplicateId of plan.duplicateIds) {
      const canonicalId = plan.canonicalId;
      const moved = await db.$transaction(
        async (tx) => {
          // Hervalidatie binnen de transactie: het plan kan verouderd zijn.
          if (plan.group.type === "READING_LESSONS" && (await unmappedLessonsWithData(tx, canonicalId, duplicateId)).length > 0)
            throw new Error(`Cursus ${duplicateId} bevat lessen met gebruikersgegevens zonder gelijkwaardige les; herstel afgebroken.`);
          return mergeOne(tx, plan.group.type, canonicalId, duplicateId);
        },
        { maxWait: 30_000, timeout: 5 * 60_000 },
      );
      result.merged.push({ canonicalId, duplicateId, moved });
    }
  }
  return result;
}
