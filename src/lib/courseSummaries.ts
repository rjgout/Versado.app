import { prisma } from "@/lib/db";
import { getCourseChapterProgress } from "@/lib/learning/courseProgress";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { localizedCourse } from "@/lib/courseText";
import type { TFunction } from "@/lib/i18n/core";
import { courseTypeMatchesContent } from "@/lib/courseContent";

// Per cursus in de persoonlijke lijst van een gebruiker: voortgang,
// huidige plek en beschikbare XP. Eén berekening voor /api/courses (de
// cursuslijst) en "Ga verder" op Vandaag, zodat die nooit uiteenlopen.
// Geen next/headers: de aanroeper geeft gebruiker en collectie mee.

export type CourseSummary = Awaited<ReturnType<typeof getSubscribedCourseSummaries>>[number];

export async function getSubscribedCourseSummaries(
  user: { id: string; uiLanguage: string | null; activeCourseId: string | null },
  collectionId: string,
  t: TFunction
) {
  const [courses, userProgress] = await Promise.all([
    prisma.course.findMany({
      where: { enabled: true, contentCollectionId: collectionId },
      orderBy: { order: "asc" },
      include: {
        _count: { select: { chapters: true } },
        book: { select: { slug: true } },
        contentCollection: { select: { work: true } },
      },
    }),
    prisma.userCourseProgress.findMany({
      where: { userId: user.id, subscribed: true },
      include: { currentChapter: { include: { book: true } } },
    }),
  ]);

  const progressByCourseId = new Map(userProgress.map((p) => [p.courseId, p]));
  // Alleen de cursussen die deze gebruiker aan zijn persoonlijke lijst
  // toevoegde (zie subscribeUserToCourse) — de rest staat in de catalogus
  // (/api/courses/catalog, "Voeg nieuwe cursus toe").
  const subscribedCourses = courses.filter((c) => courseTypeMatchesContent(c.type, c.contentCollection.work) && progressByCourseId.has(c.id));

  const result = await Promise.all(
    subscribedCourses.map(async (course) => {
      const progress = progressByCourseId.get(course.id);
      let totalChapters = course._count.chapters;
      let completedCount = 0;
      let xpAvailable = 0;

      const chapterProgress = await getCourseChapterProgress(prisma, user.id, course, progress?.currentChapterId ?? null);
      if (chapterProgress) {
        totalChapters = chapterProgress.totalChapters;
        completedCount = chapterProgress.completedCount;
        xpAvailable = chapterProgress.xpAvailable;
      }

      return {
        id: course.id,
        slug: course.slug,
        type: course.type,
        ...localizedCourse({ ...course, work: course.contentCollection.work }, user.uiLanguage),
        work: course.contentCollection.work,
        totalChapters,
        unitPlural: localizeTerm(chapterTerm(course.book?.slug, course.contentCollectionId), t).plural,
        completedCount,
        xpAvailable,
        isActive: user.activeCourseId === course.id,
        lastActivityAt: progress?.lastActivityAt.toISOString() ?? null,
        currentChapter: progress?.currentChapter
          ? {
              id: progress.currentChapter.id,
              bookName: progress.currentChapter.book.name,
              bookKey: progress.currentChapter.book.key,
              number: progress.currentChapter.number,
            }
          : null,
      };
    })
  );

  return result;
}
