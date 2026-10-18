import { decodePublishedStudyEdition } from "@/lib/studyContent/revisions";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { parseStoredChapters } from "@/lib/podcastChapters";
import { isEmailConfigured } from "@/lib/email";
import { isContentCollectionSelectable } from "@/lib/contentCollections";
import PodcastCourseView from "@/components/PodcastCourseView";
import KidsCourseView from "@/components/KidsCourseView";
import IntroCourseView from "@/components/IntroCourseView";
import FsyCourseView from "@/components/FsyCourseView";
import StudyTogetherButton from "@/components/study/StudyTogetherButton";
import { canStartStudy } from "@/lib/study/startAvailability";
import { localizedCourse } from "@/lib/courseText";
import { isReadingPathType } from "@/lib/readingCourses";

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
    include: { contentCollection: { select: { work: true } } },
  });
  if (!course) redirect("/courses");
  if (!(await isContentCollectionSelectable(course.contentCollectionId, user.isAdmin))) redirect("/courses");
  // Naam in de taal van de app; voor Nederlands de databasewaarde.
  const courseName = localizedCourse({ ...course, work: course.contentCollection.work }, user.uiLanguage).name;
  // Samen studeren kan bij elke cursus met vragen (dus niet bij FSY).
  const studyAction = await canStartStudy(course.id) ? <StudyTogetherButton courseId={course.id} /> : null;

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
      where: { contentCollectionId: course.contentCollectionId, OR: [{ publishedContent: { not: null } }, { studyLessonEdition: { publishedRevisionId: { not: null } } }] },
      include: { studyLessonEdition: { include: { lesson: true, collection: true, publishedRevision: true } } },
      orderBy: [{ year: "desc" }, { month: "desc" }, { order: "desc" }],
    });

    return (
      <FsyCourseView
        courseName={courseName}
        lessons={lessons.filter(lesson => !lesson.studyLessonEdition || (!lesson.studyLessonEdition.lesson.retiredAt && decodePublishedStudyEdition(lesson.studyLessonEdition))).map((lesson) => {
          const images = JSON.parse(lesson.studyLessonEdition ? "[]" : lesson.publishedImages ?? "[]") as { url: string; alt: string }[];
          return {
            id: lesson.id,
            year: lesson.year,
            month: lesson.month,
            category: lesson.category,
            title: lesson.studyLessonEdition?.publishedRevision?.title ?? lesson.publishedTitle ?? lesson.title,
            image: images[0]?.url ?? null,
          };
        })}
      />
    );
  }

  // De drie schriftuurlijke leescursussen (Stap voor stap, Hoofdstuk voor hoofdstuk, Vrije keuze) delen één Focus-route
  // met hetzelfde visuele leespad (zie focusMode.ts); alle andere cursustypes blijven hier.
  if (isReadingPathType(course.type)) redirect(`/courses/${course.id}/pad`);
  // Een onbekend cursustype hoort hier niet: terug naar de lijst (nooit naar /pad, dat zou een lus geven).
  redirect("/courses");
}
