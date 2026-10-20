import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { isEmailConfigured } from "@/lib/email";
import { isContentCollectionSelectable } from "@/lib/contentCollections";
import LiveRefresh from "@/components/LiveRefresh";
import ReadingCourseView from "@/components/ReadingCourseView";
import ChapterListCourseView from "@/components/ChapterListCourseView";
import StudyTogetherButton from "@/components/study/StudyTogetherButton";
import { canStartStudy } from "@/lib/study/startAvailability";
import { chapterTerm, localizeTerm } from "@/lib/chapterTerm";
import { localizedCourse } from "@/lib/courseText";
import { getT } from "@/lib/i18n";
import { loadReadingPath } from "@/lib/readingPathData";
import { loadChapterPath } from "@/lib/chapterPathData";
import { isReadingPathType, isStudyCourseType, modeOfStudyCourse } from "@/lib/readingCourses";
import { getStudyCatalogue } from "@/lib/studyContent/catalogue";
import { resolveWeekSelection } from "@/lib/studyContent/weekSelection";
import CfmCourseView from "@/components/study/CfmCourseView";
import { navigationSessionKey } from "@/lib/session";

// Het leespad van de drie schriftuurlijke leescursussen (Stap voor stap, Hoofdstuk voor hoofdstuk, Vrije keuze) in
// Focusmodus (zie focusMode.ts): een navigatie- en selectiescherm, geen activiteit. Andere cursustypes horen hier niet en
// gaan terug naar de gewone cursuspagina, die alleen deze drie hierheen stuurt: geen lus.
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
  // "Kom dan en volg Mij" (CFM): dezelfde cursuspagina met de weken als leerlijn; de leeswijze volgt uit de cursus.
  if (isStudyCourseType(course.type)) {
    // Altijd de collectie van deze cursus, nooit de toevallig actieve collectie van de gebruiker (collectie-isolatie).
    const data = await getStudyCatalogue(user, new Date(), { collectionId: course.contentCollectionId });
    const weeks = data.lessons.filter((lesson) => lesson.personal).map((l) => ({
      id: l.id, lessonId: l.lessonId, collectionId: l.collectionId, lessonKey: l.lessonKey, title: l.title, startsOn: l.startsOn,
      endsOnExclusive: l.endsOnExclusive, read: l.read, stepsDone: l.stepsDone, imageMediaId: l.imageMediaId,
    }));
    if (!weeks.length) redirect("/courses");
    // Dezelfde weekregel als de cursuskaart: kalenderweek, anders hervatweek (zie weekSelection.ts).
    const selection = resolveWeekSelection(weeks, { today: data.today ?? "", selectedLessonKey: data.context?.activeLessonKey });
    const activeWeek = selection.resume;
    const courseTitle = localizedCourse({ ...course, work: course.contentCollection.work }, user.uiLanguage).name;
    return (
      <>
        <LiveRefresh scopes={["courses", "progress", "studySteps", "studyContext", "studyContent"]} token={data.token} />
        <CfmCourseView
          courseName={courseTitle}
          mode={modeOfStudyCourse(course.type)}
          weeks={weeks}
          activeWeekId={activeWeek?.id ?? null}
          activeIsCalendar={selection.resumeReason === "calendar"}
          sessionKey={await navigationSessionKey()}
          context={data.context ? { workKey: data.context.workKey, version: data.context.version, activeLessonKey: data.context.activeLessonKey } : null}
        />
      </>
    );
  }
  if (!isReadingPathType(course.type)) redirect(`/courses/${course.id}`);

  const t = getT(user.uiLanguage);
  const courseName = localizedCourse({ ...course, work: course.contentCollection.work }, user.uiLanguage).name;
  const studyAction = (await canStartStudy(course.id)) ? <StudyTogetherButton courseId={course.id} /> : null;
  const unitPlural = localizeTerm(chapterTerm(null, course.contentCollectionId), t).plural;
  const refresh = <LiveRefresh scopes={["courses", "progress"]} token={String(Date.now())} />;

  if (course.type !== "READING_LESSONS") {
    const path = await loadChapterPath(prisma, user.id, course);
    return (
      <>
        {/* Na een afgerond hoofdstuk (xpChanged) of een wijziging van elders klopt het leespad weer. */}
        {refresh}
        <ChapterListCourseView
          studyAction={studyAction}
          courseId={course.id}
          courseName={courseName}
          sequential={course.type === "FRONT_TO_BACK"}
          chapters={path.chapters}
          todayId={path.todayId}
          todayMinutes={path.todayMinutes}
          todayXp={path.todayXp}
          defaultOpenBook={path.defaultOpenBook}
          unitPlural={unitPlural}
        />
      </>
    );
  }

  const { chapters, todayId } = await loadReadingPath(prisma, user.id, course.id);

  return (
    <>
      {/* Na een afgeronde stap (xpChanged) of een wijziging van elders klopt het leerpad weer. */}
      {refresh}
      <ReadingCourseView
        studyAction={studyAction}
        courseName={courseName}
        unitPlural={unitPlural}
        today={todayId ? { id: todayId } : null}
        chapters={chapters}
      />
    </>
  );
}
