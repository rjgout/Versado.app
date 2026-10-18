import StudyReader from "@/components/study/StudyReader";
import { getStudyReader } from "@/lib/studyContent/reader";
import { navigationSessionKey } from "@/lib/session";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { FSY_SLUG, markCourseStarted } from "@/lib/courses";
import FsyLessonView from "@/components/FsyLessonView";
import type { FsyContentBlock } from "@/lib/fsyContent";
import { isContentCollectionSelectable } from "@/lib/contentCollections";
import { getT } from "@/lib/i18n";

async function activateSubscribedFsyCourse(userId: string) {
  const course = await prisma.course.findUnique({ where: { slug: FSY_SLUG }, select: { id: true } });
  if (course) await markCourseStarted(prisma, userId, course.id);
}

export default async function FsyLessonPage({ params }: { params: Promise<{ lessonId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { lessonId } = await params;
  const lesson = await prisma.fsyLesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true,
      studyLessonEdition: { select: { lessonId: true } },
      year: true,
      month: true,
      category: true,
      publishedTitle: true,
      publishedContent: true,
      sourceUrl: true,
      status: true,
      contentCollectionId: true,
    },
  });

  if (!lesson) notFound();
  if (lesson.studyLessonEdition) {
    const sessionKey = await navigationSessionKey();
    const data = await getStudyReader(user, lesson.studyLessonEdition.lessonId, lesson.contentCollectionId, sessionKey);
    if (!data) notFound();
    await activateSubscribedFsyCourse(user.id);
    return <StudyReader initial={data} sessionKey={sessionKey} />;
  }
  if (!lesson.publishedContent) notFound();
  if (!(await isContentCollectionSelectable(lesson.contentCollectionId, user.isAdmin))) notFound();
  await activateSubscribedFsyCourse(user.id);

  return (
    <FsyLessonView
      title={lesson.publishedTitle ?? getT(user.uiLanguage)("courseNames.fsy")}
      month={lesson.month}
      year={lesson.year}
      category={lesson.category}
      blocks={JSON.parse(lesson.publishedContent) as FsyContentBlock[]}
      sourceUrl={lesson.sourceUrl}
    />
  );
}
