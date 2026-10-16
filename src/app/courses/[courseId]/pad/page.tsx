import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isEmailConfigured } from "@/lib/email";
import { isContentCollectionSelectable } from "@/lib/contentCollections";
import LiveRefresh from "@/components/LiveRefresh";
import ReadingCourseView from "@/components/ReadingCourseView";
import StudyTogetherButton from "@/components/study/StudyTogetherButton";
import { canStartStudy } from "@/lib/study/startAvailability";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { localizedCourse } from "@/lib/courseText";
import { getT } from "@/lib/i18n";
import { loadReadingPath } from "@/lib/readingPathData";

// Het leerpad van Stap voor stap (READING_LESSONS) in Focusmodus (zie focusMode.ts): een navigatie- en
// selectiescherm, geen activiteit. Andere cursustypes horen hier niet en gaan terug naar de gewone cursuspagina.
export default async function ReadingPathPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (!user.emailVerifiedAt && (await isEmailConfigured())) redirect("/verify-email");

  const { courseId } = await params;
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { contentCollection: { select: { work: true } } },
  });
  if (!course) redirect("/courses");
  if (!(await isContentCollectionSelectable(course.contentCollectionId, user.isAdmin))) redirect("/courses");
  // De gewone cursuspagina stuurt alleen READING_LESSONS hierheen: geen lus.
  if (course.type !== "READING_LESSONS") redirect(`/courses/${course.id}`);

  const t = getT(user.uiLanguage);
  const courseName = localizedCourse({ ...course, work: course.contentCollection.work }, user.uiLanguage).name;
  const studyAction = (await canStartStudy(course.id)) ? <StudyTogetherButton courseId={course.id} /> : null;
  const { chapters, todayId } = await loadReadingPath(prisma, user.id, course.id);

  return (
    <>
      {/* Na een afgeronde stap (xpChanged) of een wijziging van elders klopt het leerpad weer. */}
      <LiveRefresh scopes={["courses", "progress"]} token={String(Date.now())} />
      <ReadingCourseView
        studyAction={studyAction}
        courseName={courseName}
        unitPlural={localizeTerm(chapterTerm(null, course.contentCollectionId), t).plural}
        today={todayId ? { id: todayId } : null}
        chapters={chapters}
      />
    </>
  );
}
