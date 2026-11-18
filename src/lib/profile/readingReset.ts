import type { Prisma } from "@/generated/prisma/client";
import { resetReadingProgress } from "@/lib/learning/contentProgress";
const READING_COURSE_TYPES = ["FRONT_TO_BACK", "FREE_CHOICE", "BY_BOOK", "READING_LESSONS"] as const;
export async function resetProfileReading(tx: Prisma.TransactionClient, userId: string) {
    const readingCourses = await tx.course.findMany({
      where: { type: { in: [...READING_COURSE_TYPES] } },
      select: { id: true, type: true },
    });
    const readingCourseIds = readingCourses.map((course) => course.id);
    // Lezen en de zichtbare oefenvoortgang op nul; wat al beloond is blijft
    // staan, zodat de basis-XP niet opnieuw te verdienen is.
    await resetReadingProgress(tx, userId);

    const readingLessonsCourseIds = readingCourses
      .filter((course) => course.type === "READING_LESSONS")
      .map((course) => course.id);

    if (readingLessonsCourseIds.length > 0) {
      await tx.userCourseLessonProgress.deleteMany({
        where: {
          userId: userId,
          lesson: { courseId: { in: readingLessonsCourseIds } },
        },
      });
    }

    if (readingCourseIds.length > 0) {
      await tx.userCourseProgress.updateMany({
        where: { userId: userId, courseId: { in: readingCourseIds } },
        data: {
          currentChapterId: null,
          currentLessonId: null,
          comboCount: 0,
          comboLastCompletedAt: null,
          lastActivityAt: new Date(),
        },
      });
    }
}
