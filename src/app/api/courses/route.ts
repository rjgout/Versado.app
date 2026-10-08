import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCourseChapterProgress } from "@/lib/learning/courseProgress";
import { getCurrentUser } from "@/lib/session";
import { getContentContext } from "@/lib/contentCollections";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { localizedCourse } from "@/lib/courseText";
import { getT } from "@/lib/i18n";
import { apiError } from "@/lib/apiError";
import { courseArtworkKeys } from "@/lib/artwork";
import { readingResumeHref } from "@/lib/courseResume";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const contentContext = await getContentContext(user.id);
  const t = getT(user.uiLanguage);

  const [courses, userProgress] = await Promise.all([
    prisma.course.findMany({
      where: { enabled: true, contentCollectionId: contentContext.active.id },
      orderBy: { order: "asc" },
      include: {
        _count: { select: { chapters: true } },
        book: { select: { slug: true } },
        contentCollection: { select: { work: true } },
      },
    }),
    prisma.userCourseProgress.findMany({
      where: { userId: user.id, subscribed: true },
      include: {
        currentChapter: { include: { book: true } },
        currentLesson: { include: { chapter: { include: { book: true } } } },
      },
    }),
  ]);

  const progressByCourseId = new Map(userProgress.map((p) => [p.courseId, p]));
  // Alleen de cursussen die deze gebruiker aan zijn persoonlijke lijst
  // toevoegde (zie subscribeUserToCourse) — de rest staat in de catalogus
  // (/api/courses/catalog, "Voeg nieuwe cursus toe").
  const subscribedCourses = courses.filter((c) => progressByCourseId.has(c.id));

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
        totalChapters,
        unitPlural: localizeTerm(chapterTerm(course.book?.slug, course.contentCollectionId), t).plural,
        completedCount,
        xpAvailable,
        isActive: user.activeCourseId === course.id,
        // "Ga verder": meteen naar de volgende stap of het volgende
        // hoofdstuk, anders naar het cursusoverzicht (dat zelf de volgende
        // les aanwijst, bv. bij kinderverhalen of podcasts).
        resumeHref: readingResumeHref({
          courseId: course.id,
          type: course.type,
          currentChapterId: progress?.currentChapter?.id ?? null,
          currentLessonId: progress?.currentLesson?.id ?? null,
        }) ?? `/courses/${course.id}`,
        // Het beeld volgt het boek waar je nu bent, net als op Vandaag.
        artwork: courseArtworkKeys({
          slug: course.slug,
          type: course.type,
          work: course.contentCollection.work,
          bookKey: progress?.currentLesson?.chapter.book.key ?? progress?.currentChapter?.book.key,
        }),
        currentChapter: progress?.currentChapter
          ? {
              id: progress.currentChapter.id,
              bookName: progress.currentChapter.book.name,
              number: progress.currentChapter.number,
            }
          : progress?.currentLesson?.chapter
            ? {
                id: progress.currentLesson.chapter.id,
                bookName: progress.currentLesson.chapter.book.name,
                number: progress.currentLesson.chapter.number,
              }
            : null,
      };
    })
  );

  return NextResponse.json({ courses: result });
}
