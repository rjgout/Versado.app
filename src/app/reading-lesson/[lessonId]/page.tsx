import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { markCourseStarted } from "@/lib/courses";
import { playableAudioUrl } from "@/lib/audioMirror";
import { getStepOverview } from "@/lib/readingLessons";
import { issueExerciseSession } from "@/lib/learning/contentProgress";
import ReadingLessonFlow from "@/components/ReadingLessonFlow";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { getT } from "@/lib/i18n";
import CourseBackTarget from "@/components/CourseBackTarget";

export default async function ReadingLessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { lessonId } = await params;
  const lesson = await prisma.courseLesson.findUnique({
    where: { id: lessonId },
    include: {
      course: true,
      chapter: {
        include: { book: { include: { contentCollection: { select: { language: true } } } } },
      },
    },
  });

  if (!lesson || lesson.course.type !== "READING_LESSONS") redirect("/courses");

  // Open als de stap af is of aan de beurt (zie getStepOverview): ook een
  // hoofdstuk dat je via een andere route begon, kun je hier afmaken.
  const overview = await getStepOverview(prisma, user.id, lesson.courseId);
  const step = overview.steps.find((item) => item.id === lesson.id);
  if (!step?.available) {
    redirect(`/courses/${lesson.courseId}/chapter/${lesson.chapterId}`);
  }
  await markCourseStarted(prisma, user.id, lesson.courseId);

  const verses = await prisma.verse.findMany({
    where: {
      chapterId: lesson.chapterId,
      number: { gte: lesson.startVerse, lte: lesson.endVerse },
    },
    orderBy: { number: "asc" },
  });
  const verseIds = verses.map((verse) => verse.id);
  const [bookmarks, highlights, notes, chapterLessonCount] = await Promise.all([
    prisma.bookmark.findMany({ where: { userId: user.id, verseId: { in: verseIds } } }),
    prisma.highlight.findMany({ where: { userId: user.id, verseId: { in: verseIds } } }),
    prisma.note.findMany({ where: { userId: user.id, verseId: { in: verseIds } } }),
    prisma.courseLesson.count({ where: { courseId: lesson.courseId, chapterId: lesson.chapterId } }),
  ]);

  const bookmarkedVerseIds = new Set(bookmarks.map((bookmark) => bookmark.verseId));
  const highlightedVerseIds = new Set(highlights.map((highlight) => highlight.verseId));
  const notesByVerseId = Object.fromEntries(notes.map((note) => [note.verseId, note.text]));

  // Voorlezen stopt aan het eind van deze les: bij het begin van het vers
  // ná de laatste, of pas aan het eind van het bestand als dat er niet is.
  const verseAfter = lesson.chapter.audioUrl
    ? await prisma.verse.findFirst({
        where: { chapterId: lesson.chapterId, number: lesson.endVerse + 1 },
        select: { audioStart: true },
      })
    : null;
  const audioUrl = playableAudioUrl(lesson.chapter.audioUrl);
  const audio = audioUrl ? { url: audioUrl, end: verseAfter?.audioStart ?? null } : null;

  const [nextLesson, firstChapterLesson] = await Promise.all([
    prisma.courseLesson.findFirst({
      where: { courseId: lesson.courseId, order: lesson.order + 1 },
      select: { id: true },
    }),
    prisma.courseLesson.findFirst({
      where: { courseId: lesson.courseId, chapterId: lesson.chapterId },
      orderBy: { order: "asc" },
      select: { order: true },
    }),
  ]);

  // De vragen van dit leesgedeelte uit het oefenplan van het hoofdstuk:
  // samen met de andere stappen precies de oefenset van het hoofdstuk.
  const issued = await issueExerciseSession(user.id, lesson.chapterId, {
    lessonId: lesson.id,
    startVerse: lesson.startVerse,
    endVerse: lesson.endVerse,
  });

  return (
    <>
    <CourseBackTarget href={`/courses/${lesson.courseId}`} parent={lesson.course.name} />
    <ReadingLessonFlow
      lessonId={lesson.id}
      chapterId={lesson.chapterId}
      bookName={lesson.chapter.book.name}
      chapterNumber={lesson.chapter.number}
      lessonNumber={lesson.order - (firstChapterLesson?.order ?? lesson.order) + 1}
      totalLessons={chapterLessonCount}
      startVerse={lesson.startVerse}
      endVerse={lesson.endVerse}
      nextLessonId={nextLesson?.id ?? null}
      verses={verses.map((verse) => ({
        id: verse.id,
        number: verse.number,
        text: verse.text,
        bookmarked: bookmarkedVerseIds.has(verse.id),
        highlighted: highlightedVerseIds.has(verse.id),
        note: notesByVerseId[verse.id] ?? "",
        audioStart: verse.audioStart,
      }))}
      audio={audio}
      term={localizeTerm(chapterTerm(lesson.chapter.book.slug), getT(user.uiLanguage))}
      exercises={issued.exercises}
      sessionId={issued.sessionId}
      courseId={lesson.courseId}
      language={lesson.chapter.book.contentCollection.language}
    />
    </>
  );
}
