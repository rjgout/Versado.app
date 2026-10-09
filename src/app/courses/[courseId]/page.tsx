import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { parseStoredChapters } from "@/lib/podcastChapters";
import { isEmailConfigured } from "@/lib/email";
import { advanceCourseProgress, syncCourses } from "@/lib/courses";
import { isContentCollectionSelectable } from "@/lib/contentCollections";
import ChapterListCourseView from "@/components/ChapterListCourseView";
import PodcastCourseView from "@/components/PodcastCourseView";
import KidsCourseView from "@/components/KidsCourseView";
import IntroCourseView from "@/components/IntroCourseView";
import FsyCourseView from "@/components/FsyCourseView";
import ReadingCourseView from "@/components/ReadingCourseView";
import StudyTogetherButton from "@/components/study/StudyTogetherButton";
import { supportsStudy } from "@/lib/study/units";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { localizedCourse } from "@/lib/courseText";
import { getT } from "@/lib/i18n";
import { getChapterStates } from "@/lib/learning/contentProgress";
import { countWords, estimateReadingMinutes } from "@/lib/learning/readingTime";
import { getStepOverview } from "@/lib/readingLessons";

export default async function CourseDetailPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (!user.emailVerifiedAt && (await isEmailConfigured())) {
    redirect("/verify-email");
  }

  const { courseId } = await params;
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: {
      contentCollection: { select: { work: true } },
      chapters: {
        orderBy: { order: "asc" },
        include: {
          chapter: {
            include: {
              book: true,
              verses: { select: { text: true } },
              _count: { select: { verses: true } },
            },
          },
        },
      },
    },
  });
  if (!course) redirect("/courses");
  if (!(await isContentCollectionSelectable(course.contentCollectionId, user.isAdmin))) redirect("/courses");
  // Naam in de taal van de app; voor Nederlands de databasewaarde.
  const courseName = localizedCourse({ ...course, work: course.contentCollection.work }, user.uiLanguage).name;
  const t = getT(user.uiLanguage);
  // Samen studeren kan bij elke cursus met vragen (dus niet bij FSY).
  const studyAction = supportsStudy(course.type) ? <StudyTogetherButton courseId={course.id} /> : null;

  if (course.type === "PODCAST") {
    const [podcast, episodes, notificationPreference] = await Promise.all([
      course.podcastId ? prisma.podcast.findUnique({ where: { id: course.podcastId }, select: { id: true, name: true } }) : null,
      prisma.podcastEpisode.findMany({
        // Een cursus zonder podcastId bestaat na de migratie niet meer; dan
        // liever geen afleveringen dan die van alle podcasts door elkaar.
        where: { podcastId: course.podcastId ?? "" },
        orderBy: { order: "asc" },
        include: {
          progress: { where: { userId: user.id } },
          exercises: { select: { mode: true } },
          playbackProgress: { where: { userId: user.id }, select: { positionSeconds: true } },
        },
      }),
      course.podcastId
        ? prisma.podcastNotificationPreference.findUnique({ where: { userId_podcastId: { userId: user.id, podcastId: course.podcastId } }, select: { enabled: true, promptedAt: true } })
        : null,
    ]);

    return (
      <PodcastCourseView
        studyAction={studyAction}
        courseName={courseName}
        podcastName={podcast?.name ?? courseName}
        podcastId={podcast?.id ?? null}
        askForNotifications={!!podcast && !notificationPreference?.enabled && !notificationPreference?.promptedAt}
        episodes={episodes.map((episode) => {
          const contentProgress = episode.progress.find((p) => p.mode === "CONTENT");
          const bomProgress = episode.progress.find((p) => p.mode === "BOM_CONNECTION");
          return {
            id: episode.id,
            number: episode.number,
            title: episode.title,
            summary: episode.summary,
            listenUrl: episode.listenUrl,
            audioUrl: episode.audioUrl,
            contentCompleted: contentProgress?.completed ?? false,
            contentBestScore: contentProgress ? contentProgress.bestScore : null,
            hasContentExercises: episode.exercises.some((e) => e.mode === "CONTENT"),
            bomCompleted: bomProgress?.completed ?? false,
            bomBestScore: bomProgress ? bomProgress.bestScore : null,
            hasBomExercises: episode.exercises.some((e) => e.mode === "BOM_CONNECTION"),
            resumeSeconds: episode.playbackProgress[0]?.positionSeconds ?? 0,
            chapters: parseStoredChapters(episode.chapters),
          };
        })}
      />
    );
  }

  if (course.type === "KIDS") {
    const stories = await prisma.kidsStory.findMany({
      where: { courseId: course.id },
      orderBy: { order: "asc" },
      include: { progress: { where: { userId: user.id } } },
    });

    return (
      <KidsCourseView
        studyAction={studyAction}
        courseName={courseName}
        stories={stories.map((story) => {
          const images = JSON.parse(story.images) as string[];
          return {
            id: story.id,
            number: story.number,
            title: story.title,
            image: images[0] ?? null,
            completed: story.progress[0]?.completed ?? false,
            bestScore: story.progress[0] ? story.progress[0].bestScore : null,
          };
        })}
      />
    );
  }

  if (course.type === "INTRO") {
    const lessons = await prisma.introLesson.findMany({
      orderBy: { number: "asc" },
      include: { progress: { where: { userId: user.id } } },
    });

    return (
      <IntroCourseView
        studyAction={studyAction}
        courseName={courseName}
        lessons={lessons.map((lesson) => ({
          id: lesson.id,
          number: lesson.number,
          title: lesson.title,
          summary: lesson.summary,
          completed: lesson.progress[0]?.completed ?? false,
          bestScore: lesson.progress[0] ? lesson.progress[0].bestScore : null,
        }))}
      />
    );
  }

  if (course.type === "FSY") {
    const lessons = await prisma.fsyLesson.findMany({
      where: { contentCollectionId: course.contentCollectionId, publishedContent: { not: null } },
      orderBy: [{ year: "desc" }, { month: "desc" }, { order: "desc" }],
    });

    return (
      <FsyCourseView
        courseName={courseName}
        lessons={lessons.map((lesson) => {
          const images = JSON.parse(lesson.publishedImages ?? "[]") as { url: string; alt: string }[];
          return {
            id: lesson.id,
            year: lesson.year,
            month: lesson.month,
            category: lesson.category,
            title: lesson.publishedTitle ?? lesson.title,
            image: images[0]?.url ?? null,
          };
        })}
      />
    );
  }

  if (course.type === "READING_LESSONS") {
    // Bestaande installaties krijgen de nieuwe cursus al via de migratie.
    // De vaste lesindeling wordt één keer opgebouwd zodra de cursus voor het
    // eerst wordt geopend; daarna blijven de grenzen en voortgang bewaard.
    if ((await prisma.courseLesson.count({ where: { courseId: course.id } })) === 0 && (await prisma.chapter.count()) > 0) {
      await syncCourses(prisma);
    }
    const [lessons, overview] = await Promise.all([
      prisma.courseLesson.findMany({
        where: { courseId: course.id },
        orderBy: { order: "asc" },
        select: { id: true, chapterId: true, order: true, startVerse: true, endVerse: true, chapter: { select: { id: true, number: true, book: { select: { name: true, key: true } } } } },
      }),
      getStepOverview(prisma, user.id, course.id),
    ]);
    const stepById = new Map(overview.steps.map((step) => [step.id, step]));
    const states = await getChapterStates(prisma, user.id, [...new Map(lessons.map((l) => [l.chapterId, l.chapter])).values()]);

    // De cursor (voor Vandaag en "ga verder") volgt de gedeelde voortgang:
    // wat via een andere route al gedaan is, slaat Stap voor stap over.
    await prisma.userCourseProgress.upsert({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
      create: { userId: user.id, courseId: course.id, currentLessonId: overview.next?.id ?? null, currentChapterId: overview.next?.chapterId ?? null },
      update: { currentLessonId: overview.next?.id ?? null, currentChapterId: overview.next?.chapterId ?? null },
    });

    const currentLesson = overview.next ? lessons.find((lesson) => lesson.id === overview.next!.id) ?? null : null;
    const currentChapterFirstLessonOrder = currentLesson
      ? lessons.find((lesson) => lesson.chapterId === currentLesson.chapterId)?.order ?? currentLesson.order
      : 0;

    const chapterMap = new Map<string, {
      id: string;
      number: number;
      bookName: string;
      lessonCount: number;
      completedLessons: number;
      locked: boolean;
    }>();
    for (const lesson of lessons) {
      const step = stepById.get(lesson.id)!;
      const existing = chapterMap.get(lesson.chapterId);
      if (existing) {
        existing.lessonCount++;
        if (step.done) existing.completedLessons++;
      } else {
        chapterMap.set(lesson.chapterId, {
          id: lesson.chapterId,
          number: lesson.chapter.number,
          bookName: lesson.chapter.book.name,
          lessonCount: 1,
          completedLessons: step.done ? 1 : 0,
          locked: !step.available,
        });
      }
    }

    return (
      <ReadingCourseView
        studyAction={studyAction}
        courseId={course.id}
        courseName={courseName}
        unitPlural={localizeTerm(chapterTerm(null, course.contentCollectionId), t).plural}
        today={
          currentLesson
            ? {
                id: currentLesson.id,
                bookName: currentLesson.chapter.book.name,
                chapterNumber: currentLesson.chapter.number,
                lessonNumber: currentLesson.order - currentChapterFirstLessonOrder + 1,
                startVerse: currentLesson.startVerse,
                endVerse: currentLesson.endVerse,
              }
            : null
        }
        chapters={Array.from(chapterMap.values()).map((chapter) => {
          const state = states.get(chapter.id)!;
          return {
            ...chapter,
            read: state.read,
            exercisesAnswered: state.exercisesAnswered,
            exercisesTotal: state.exercisesTotal,
          };
        })}
      />
    );
  }

  // De resterende cursustypes (van voor naar achter, vrije keuze) zijn
  // allebei simpelweg "een lijst hoofdstukken" (zie
  // ChapterListCourseView) — elk met hun eigen pagina, hun eigen "Vandaag"-
  // hoofdstuk en (bij meerdere boeken) hun eigen inklapbare secties, ook al
  // deelt een los hoofdstuk zijn afrondingsstatus (ChapterProgress) altijd
  // met elke andere cursus die het ook bevat — dat is bewust zo.
  let courseProgress = await prisma.userCourseProgress.findUnique({
    where: { userId_courseId: { userId: user.id, courseId: course.id } },
  });
  if (!courseProgress) {
    await advanceCourseProgress(prisma, user.id, course.id);
    courseProgress = await prisma.userCourseProgress.findUnique({
      where: { userId_courseId: { userId: user.id, courseId: course.id } },
    });
  }

  const chapters = course.chapters.map((cc) => cc.chapter);
  const states = await getChapterStates(prisma, user.id, chapters);

  return (
    <ChapterListCourseView
      studyAction={studyAction}
      courseId={course.id}
      courseName={courseName}
      currentChapterId={courseProgress?.currentChapterId ?? null}
      sequential={course.type !== "FREE_CHOICE"}
      unitPlural={localizeTerm(chapterTerm(chapters[0]?.book.slug), t).plural}
      chapters={chapters.map((chapter) => {
        const state = states.get(chapter.id)!;
        return {
          id: chapter.id,
          number: chapter.number,
          bookName: chapter.book.name,
          verseCount: chapter._count.verses,
          minutes: estimateReadingMinutes(chapter.verses.reduce((sum, v) => sum + countWords(v.text), 0)),
          read: state.read,
          exercisesAnswered: state.exercisesAnswered,
          exercisesTotal: state.exercisesTotal,
          exerciseScore: state.exerciseScore,
          xpAvailable: state.xpAvailable,
          completed: state.done,
        };
      })}
    />
  );
}
