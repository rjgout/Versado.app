import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { syncCourses } from "@/lib/courses";
import { getChapterStates } from "@/lib/learning/contentProgress";
import { getStepOverview } from "@/lib/readingLessons";
import { buildPathChapters, type PathChapter } from "@/lib/readingPath";

/**
 * De gegevens van het leerpad van Stap voor stap (READING_LESSONS) voor één gebruiker: elk hoofdstuk met zijn echte
 * stappen en de status uit getStepOverview. Eén bron voor het leerpad; een gewone cursuspagina berekent dit niet zelf.
 */
export async function loadReadingPath(db: PrismaClient | Prisma.TransactionClient, userId: string, courseId: string, options: { readOnly?: boolean } = {}): Promise<{ chapters: PathChapter[]; todayId: string | null }> {
  // Alleen de normale webclient mag de bestaande initialisatie uitvoeren.
  const writableDb = "$transaction" in db ? db as PrismaClient : null;
  if (!options.readOnly && !writableDb) throw new Error("Transactie vereist readOnly-leerpad");
  // Bestaande installaties krijgen de nieuwe cursus al via de migratie.
  // De vaste lesindeling wordt één keer opgebouwd zodra de cursus voor het
  // eerst wordt geopend; daarna blijven de grenzen en voortgang bewaard.
  if (!options.readOnly && writableDb && (await db.courseLesson.count({ where: { courseId } })) === 0 && (await db.chapter.count()) > 0) {
    await syncCourses(writableDb);
  }
  const [lessons, overview] = await Promise.all([
    db.courseLesson.findMany({
      where: { courseId },
      orderBy: { order: "asc" },
      select: { id: true, chapterId: true, order: true, startVerse: true, endVerse: true, chapter: { select: { id: true, number: true, book: { select: { name: true, key: true } } } } },
    }),
    getStepOverview(db, userId, courseId),
  ]);
  const stepById = new Map(overview.steps.map((step) => [step.id, step]));
  const states = await getChapterStates(db, userId, [...new Map(lessons.map((l) => [l.chapterId, l.chapter])).values()]);

  // De cursor (voor Vandaag en "ga verder") volgt de gedeelde voortgang:
  // wat via een andere route al gedaan is, slaat Stap voor stap over.
  if (!options.readOnly) await db.userCourseProgress.upsert({
    where: { userId_courseId: { userId, courseId } },
    create: { userId, courseId, currentLessonId: overview.next?.id ?? null, currentChapterId: overview.next?.chapterId ?? null },
    update: { currentLessonId: overview.next?.id ?? null, currentChapterId: overview.next?.chapterId ?? null },
  });

  return { chapters: buildPathChapters(lessons, stepById, (chapterId) => states.get(chapterId)!), todayId: overview.next?.id ?? null };
}
