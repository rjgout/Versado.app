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
  return { id: course.id, slug: course.slug, canonical: course.canonical, chapters, lessons, subscriptions, usersWithProgress, activeForUsers, lessonProgressRows, exerciseSessions, studySessions, listOrderRows, feedbackRows };
}

const lessonKey = (lesson: { chapterId: string; startVerse: number }) => `${lesson.chapterId}:${lesson.startVerse}`;

/** Lessen van de dubbele cursus met gebruikersgegevens die geen gelijkwaardige les (zelfde hoofdstuk en beginvers) in de canonieke cursus hebben. */
async function unmappedLessonsWithData(db: Db, canonicalId: string, duplicateId: string): Promise<string[]> {
  const [canonical, duplicate] = await Promise.all([
    db.courseLesson.findMany({ where: { courseId: canonicalId }, select: { chapterId: true, startVerse: true } }),
    db.courseLesson.findMany({
      where: { courseId: duplicateId },
      select: { id: true, chapterId: true, startVerse: true, _count: { select: { progress: true, exerciseSessions: true, currentForCourseProgress: true } } },
    }),
  ]);
  const known = new Set(canonical.map(lessonKey));
  return duplicate
    .filter((lesson) => !known.has(lessonKey(lesson)) && (lesson._count.progress > 0 || lesson._count.exerciseSessions > 0 || lesson._count.currentForCourseProgress > 0))
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
          notes.push(`Cursus ${duplicateId}: ${lost.length} les(sen) met gebruikersgegevens zonder gelijkwaardige les (hoofdstuk + beginvers) in de canonieke cursus; handmatige beoordeling nodig.`);
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

  // Lessen (alleen Stap voor stap): gelijkwaardig = zelfde hoofdstuk en beginvers.
  const lessonMap = new Map<string, string>();
  if (type === "READING_LESSONS") {
    const [canonicalLessons, duplicateLessons] = await Promise.all([
      tx.courseLesson.findMany({ where: { courseId: canonicalId }, select: { id: true, chapterId: true, startVerse: true } }),
      tx.courseLesson.findMany({ where: { courseId: duplicateId }, select: { id: true, chapterId: true, startVerse: true } }),
    ]);
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

  // Eindcontrole: er mag niets meer naar de dubbele cursus wijzen dat niet afgeleid is (hoofdstukkoppelingen, lessen en hun oefeningen).
  const left = {
    progress: await tx.userCourseProgress.count({ where: { courseId: duplicateId } }),
    lessonProgress: await tx.userCourseLessonProgress.count({ where: { lesson: { courseId: duplicateId } } }),
    sessions: await tx.exerciseSession.count({ where: { courseLesson: { courseId: duplicateId } } }),
    active: await tx.user.count({ where: { activeCourseId: duplicateId } }),
    study: await tx.studySession.count({ where: { courseId: duplicateId } }),
    order: await tx.userListOrder.count({ where: { listKey: "courses", itemKey: duplicateId } }),
    current: await tx.userCourseProgress.count({ where: { currentLesson: { courseId: duplicateId } } }),
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
