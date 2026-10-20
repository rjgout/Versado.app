import { getStudyCatalogue } from "./catalogue";
import { isWeekDone, resolveWeekSelection } from "./weekSelection";
import { modeOfStudyCourse, type StudyCourseType } from "@/lib/readingCourses";

type Actor = { id: string; isAdmin: boolean };

/**
 * De cursuskaart van een studiecursus (CFM) in Leren: voortgang in weken, "Ga verder" naar de hervatweek en het
 * officiële lesbeeld van die week. Leest alleen, uit de collectie van de cursus zelf en met dezelfde weekregel als het
 * weekpad (resolveWeekSelection), dus kaart, knop en leerlijn wijzen nooit verschillende weken aan.
 */
export async function getStudyCourseSummary(actor: Actor, course: { type: StudyCourseType; contentCollectionId: string }) {
  const data = await getStudyCatalogue(actor, new Date(), { collectionId: course.contentCollectionId });
  const weeks = data.lessons.filter((lesson) => lesson.personal);
  if (!weeks.length || !data.today) return null;
  const { resume, resumeReason } = resolveWeekSelection(weeks, { today: data.today, selectedLessonKey: data.context?.activeLessonKey });
  if (!resume) return null;
  const base = `/study-lesson/${resume.lessonId}/${resume.collectionId}`;
  return {
    totalWeeks: weeks.length,
    completedWeeks: weeks.filter(isWeekDone).length,
    resumeHref: modeOfStudyCourse(course.type) === "STEPS" ? `${base}/stappen` : base,
    resumeReason,
    imageMediaId: resume.imageMediaId ?? null,
  };
}
