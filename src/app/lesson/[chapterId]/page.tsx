import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { markCourseStarted } from "@/lib/courses";
import { playableAudioUrl } from "@/lib/audioMirror";
import LessonFlow from "@/components/LessonFlow";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { getT } from "@/lib/i18n";
import CourseBackTarget from "@/components/CourseBackTarget";
import { getChapterState, issueExerciseSession } from "@/lib/learning/contentProgress";
import { countWords, estimateReadingMinutes, isLongChapter } from "@/lib/learning/readingTime";
import { isReadingRoute, ROUTE_PRESENTATION } from "@/lib/learning/routes";

// De oefeningen komen uit de server-uitgedeelde oefenset van het hoofdstuk
// (issueExerciseSession): even veel vragen als in elke andere route, de
// selectie zelf willekeurig. Zie docs/LEERVOORTGANG.md.

export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ chapterId: string }>;
  searchParams: Promise<{ challengeId?: string; cursus?: string; vers?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { chapterId } = await params;
  const { challengeId, cursus, vers } = await searchParams;
  const chapter = await prisma.chapter.findUnique({
    where: { id: chapterId },
    include: {
      book: { include: { contentCollection: { select: { language: true } } } },
      verses: { orderBy: { number: "asc" } },
    },
  });
  if (!chapter) redirect("/dashboard");

  const verseIds = chapter.verses.map((v) => v.id);
  const [bookmarks, highlights, notes, allChapters] = await Promise.all([
    prisma.bookmark.findMany({ where: { userId: user.id, verseId: { in: verseIds } } }),
    prisma.highlight.findMany({ where: { userId: user.id, verseId: { in: verseIds } } }),
    prisma.note.findMany({ where: { userId: user.id, verseId: { in: verseIds } } }),
    // Volgend hoofdstuk binnen dezelfde collectie: de boekvolgorde telt per collectie.
    prisma.chapter.findMany({
      where: { book: { contentCollectionId: chapter.book.contentCollectionId } },
      orderBy: [{ book: { order: "asc" } }, { order: "asc" }],
      select: { id: true },
    }),
  ]);

  const bookmarkedVerseIds = new Set(bookmarks.map((b) => b.verseId));
  const highlightedVerseIds = new Set(highlights.map((h) => h.verseId));
  const notesByVerseId = Object.fromEntries(notes.map((n) => [n.verseId, n.text]));

  const currentIndex = allChapters.findIndex((c) => c.id === chapter.id);
  const nextChapterId = currentIndex >= 0 ? allChapters[currentIndex + 1]?.id ?? null : null;

  const [issued, content] = await Promise.all([
    issueExerciseSession(user.id, chapter.id),
    getChapterState(prisma, user.id, chapter.id),
  ]);

  // De cursus waar de les bij hoort, voor "terug" en het volgende hoofdstuk:
  // de cursus waaruit de les geopend werd (?cursus=), anders de actieve
  // cursus — maar alleen als dit hoofdstuk daar echt in zit.
  const courseCandidateId = cursus ?? user.activeCourseId;
  const course = courseCandidateId
    ? await prisma.course.findFirst({
        where: { id: courseCandidateId, chapters: { some: { chapterId: chapter.id } } },
        select: { id: true, name: true, type: true },
      })
    : null;
  const route = course && isReadingRoute(course.type) ? course.type : null;
  // Een les openen vanuit een cursus is ermee beginnen: die wordt dan je
  // huidige leerreis (niet bij een losse link zonder ?cursus=).
  if (cursus && course) await markCourseStarted(prisma, user.id, course.id);

  // Een lang hoofdstuk: Stap voor stap aanraden (geen blokkade), alleen bij
  // het eerste openen en alleen als die route er voor deze inhoud is.
  const minutes = estimateReadingMinutes(chapter.verses.reduce((sum, v) => sum + countWords(v.text), 0));
  const stepCourse =
    isLongChapter(minutes) && content.read === "UNREAD" && ROUTE_PRESENTATION[route ?? "FREE_CHOICE"].suggestStepsForLongChapters
      ? await prisma.course.findFirst({
          where: { type: "READING_LESSONS", enabled: true, contentCollectionId: chapter.book.contentCollectionId, lessons: { some: { chapterId: chapter.id } } },
          select: { id: true },
        })
      : null;

  return (
    <>
    {course && <CourseBackTarget href={`/courses/${course.id}`} parent={course.name} />}
    <LessonFlow
      chapterId={chapter.id}
      bookName={chapter.book.name}
      chapterNumber={chapter.number}
      nextChapterId={nextChapterId}
      verses={chapter.verses.map((v) => ({
        id: v.id,
        number: v.number,
        text: v.text,
        bookmarked: bookmarkedVerseIds.has(v.id),
        highlighted: highlightedVerseIds.has(v.id),
        note: notesByVerseId[v.id] ?? "",
        audioStart: v.audioStart,
      }))}
      audio={chapter.audioUrl ? { url: playableAudioUrl(chapter.audioUrl), end: null } : null}
      term={localizeTerm(chapterTerm(chapter.book.slug), getT(user.uiLanguage))}
      exercises={issued.exercises}
      sessionId={issued.sessionId}
      content={{ read: content.read, exercisesAnswered: content.exercisesAnswered, exercisesTotal: content.exercisesTotal, exercisesComplete: content.exercisesComplete }}
      route={route}
      readingMinutes={minutes}
      stepsHref={stepCourse ? `/courses/${stepCourse.id}/chapter/${chapter.id}` : null}
      challengeId={challengeId}
      courseId={course?.id}
      contentKey={content.contentKey}
      focusVerse={vers ? Number(vers) || undefined : undefined}
      language={chapter.book.contentCollection.language}
    />
    </>
  );
}
