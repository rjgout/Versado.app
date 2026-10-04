import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { markCourseStarted } from "@/lib/courses";
import { isEmailConfigured } from "@/lib/email";
import KidsLessonFlow from "@/components/KidsLessonFlow";
import type { Exercise } from "@/components/LessonFlow";
import { shuffleForDisplay } from "@/lib/exerciseGen";
import CourseBackTarget from "@/components/CourseBackTarget";
import { getT } from "@/lib/i18n";

export default async function KidsStoryPage({ params }: { params: Promise<{ storyId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (!user.emailVerifiedAt && (await isEmailConfigured())) {
    redirect("/verify-email");
  }

  const { storyId } = await params;

  const story = await prisma.kidsStory.findUnique({
    where: { id: storyId },
    include: {
      exercises: {
        orderBy: { order: "asc" },
        include: { options: { orderBy: { order: "asc" } } },
      },
    },
  });
  if (!story) redirect("/courses");

  const images = JSON.parse(story.images) as string[];

  const exercises: Exercise[] = story.exercises.map((e) => ({
    id: e.id,
    type: e.type as Exercise["type"],
    verseRef: getT(user.uiLanguage)("misc.storyN", { n: story.number }),
    prompt: e.prompt,
    blanks: (JSON.parse(e.answers) as string[]).length,
    wordBank: e.wordBank ? shuffleForDisplay(JSON.parse(e.wordBank) as string[]) : undefined,
    options: e.options.length > 0 ? shuffleForDisplay(e.options.map((o) => o.imageUrl ?? o.label)) : undefined,
  }));

  // Voor de knoppen op het afrondscherm: terug naar de kindercursus zelf (niet
  // de algemene cursuslijst) en door naar het volgende verhaal.
  // Elke kindercursus heeft eigen verhalen (zie KidsStory.courseId).
  const [course, nextStory] = await Promise.all([
    story.courseId
      ? prisma.course.findUnique({ where: { id: story.courseId }, select: { id: true, name: true } })
      : null,
    prisma.kidsStory.findFirst({
      where: { courseId: story.courseId, order: { gt: story.order } },
      orderBy: { order: "asc" },
      select: { id: true },
    }),
  ]);
  if (course) await markCourseStarted(prisma, user.id, course.id);

  return (
    <>
    {course && <CourseBackTarget href={`/courses/${course.id}`} parent={course.name} />}
    <KidsLessonFlow
      storyId={story.id}
      title={story.title}
      text={story.text}
      images={images}
      exercises={exercises}
      courseHref={course ? `/courses/${course.id}` : "/courses"}
      nextStoryHref={nextStory ? `/kids/${nextStory.id}` : null}
      courseId={course?.id}
    />
    </>
  );
}
