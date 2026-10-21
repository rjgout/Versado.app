import { getStudyCatalogue } from "./catalogue";
import { resolveWeekSelection } from "./weekSelection";
import { modeOfStudyCourse, type StudyCourseType } from "@/lib/readingCourses";

type Actor = { id: string; isAdmin: boolean };

/**
 * De cursuskaart van een studiecursus (CFM) in Leren: "Ga verder" naar de hervatweek en het officiële lesbeeld van die
 * week. Bewust geen totaalvoortgang: CFM is deelname, geen cursus die je voltooit (docs/CFM-PERSOONLIJKE-STUDIE.md §18).
 * Leest alleen, uit de collectie van de cursus zelf en met dezelfde weekregel als Vandaag en het weekpad
 * (resolveWeekSelection). Zonder betrouwbare hervatweek is er geen ingang en valt de kaart terug op het weekpad.
 */
export async function getStudyCourseSummary(actor: Actor, course: { type: StudyCourseType; contentCollectionId: string }) {
  const data = await getStudyCatalogue(actor, new Date(), { collectionId: course.contentCollectionId });
  const weeks = data.lessons.filter((lesson) => lesson.personal);
  if (!weeks.length || !data.today) return null;
  const { resume, resumeReason } = resolveWeekSelection(weeks, { today: data.today, selectedLessonKey: data.context?.activeLessonKey });
  if (!resume) return null;
  const base = `/study-lesson/${resume.lessonId}/${resume.collectionId}`;
  return {
    resumeHref: modeOfStudyCourse(course.type) === "STEPS" ? `${base}/stappen` : base,
    resumeReason,
    imageMediaId: resume.imageMediaId ?? null,
  };
}
