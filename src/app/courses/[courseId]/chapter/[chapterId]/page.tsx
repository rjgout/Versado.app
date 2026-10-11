import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import ReadingChapterView from "@/components/ReadingChapterView";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { getT } from "@/lib/i18n";
import { getStepOverview } from "@/lib/readingLessons";
import { getChapterState } from "@/lib/learning/contentProgress";

export default async function ReadingChapterPage({
  params,
}: {
  params: Promise<{ courseId: string; chapterId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { courseId, chapterId } = await params;
  const course = await prisma.course.findFirst({
    where: { id: courseId, contentCollection: readingAccessWhere(user) },
    select: { id: true, type: true },
  });
  if (!course || course.type !== "READING_LESSONS") redirect("/courses");

  const chapter = await prisma.chapter.findFirst({
    where: { id: chapterId, book: { contentCollection: readingAccessWhere(user) } },
    include: { book: true },
  });
  if (!chapter) redirect(`/courses/${courseId}`);

  const [lessons, overview, content] = await Promise.all([
    prisma.courseLesson.findMany({
      where: { courseId, chapterId },
      orderBy: { order: "asc" },
      include: { progress: { where: { userId: user.id } } },
    }),
    getStepOverview(prisma, user.id, courseId),
    getChapterState(prisma, user.id, chapterId),
  ]);
  const stepById = new Map(overview.steps.map((step) => [step.id, step]));
  const firstLesson = lessons[0];

  return (
    <ReadingChapterView
      courseId={courseId}
      bookName={chapter.book.name}
      chapterNumber={chapter.number}
      thisOne={localizeTerm(chapterTerm(chapter.book.slug), getT(user.uiLanguage)).thisOne}
      content={{ read: content.read, exercisesAnswered: content.exercisesAnswered, exercisesTotal: content.exercisesTotal }}
      lessons={lessons.map((lesson) => {
        const step = stepById.get(lesson.id);
        return {
          id: lesson.id,
          number: firstLesson ? lesson.order - firstLesson.order + 1 : 1,
          startVerse: lesson.startVerse,
          endVerse: lesson.endVerse,
          verseCount: lesson.endVerse - lesson.startVerse + 1,
          completed: step?.done ?? false,
          bestScore: lesson.progress[0]?.bestScore ?? null,
          locked: !(step?.available ?? false),
        };
      })}
    />
  );
}
