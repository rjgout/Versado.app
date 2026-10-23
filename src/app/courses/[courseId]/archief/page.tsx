import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isEmailConfigured } from "@/lib/email";
import { isContentCollectionSelectable } from "@/lib/contentCollections";
import LiveRefresh from "@/components/LiveRefresh";
import CfmArchiveView from "@/components/study/CfmArchiveView";
import { localizedCourse } from "@/lib/courseText";
import { isStudyCourseType, modeOfStudyCourse } from "@/lib/readingCourses";
import { getStudyCatalogue } from "@/lib/studyContent/catalogue";
import { groupArchiveByYear } from "@/lib/studyContent/cfmProgramme";

// Het archief van "Kom dan en volg Mij" (Focusroute, zie focusMode.ts): een overzicht van eerdere lessen per jaargang, geen
// activiteit. Het leest dezelfde lessen als het leerpad; niets is gekopieerd, verwijderd of van identiteit veranderd.
export default async function CfmArchivePage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (!user.emailVerifiedAt && (await isEmailConfigured())) redirect("/verify-email");

  const { courseId } = await params;
  const course = await prisma.course.findUnique({ where: { id: courseId }, include: { contentCollection: { select: { work: true } } } });
  if (!course || !isStudyCourseType(course.type)) redirect("/courses");
  if (!(await isContentCollectionSelectable(course.contentCollectionId, user.isAdmin))) redirect("/courses");

  const data = await getStudyCatalogue(user, new Date(), { collectionId: course.contentCollectionId, scope: "archive" });
  const groups = groupArchiveByYear(data.lessons.filter((l) => l.personal)).map((group) => ({
    workKey: group.workKey,
    year: group.year,
    scripture: group.scripture,
    weeks: group.weeks.map((l) => ({ id: l.id, lessonId: l.lessonId, collectionId: l.collectionId, title: l.title, startsOn: l.startsOn, endsOnExclusive: l.endsOnExclusive, read: l.read, stepsDone: l.stepsDone })),
  }));
  return (
    <>
      <LiveRefresh scopes={["courses", "progress", "studySteps", "studyContext", "studyContent"]} token={data.token} />
      <CfmArchiveView courseName={localizedCourse({ ...course, work: course.contentCollection.work }, user.uiLanguage).name} mode={modeOfStudyCourse(course.type)} groups={groups} />
    </>
  );
}
