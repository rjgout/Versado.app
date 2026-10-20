import { getStudyCatalogue } from "./catalogue";
import { PERSONAL_STUDY_STEPS } from "./personalStudy";
import { modeOfStudyCourse, type StudyCourseType } from "@/lib/readingCourses";

type Actor = { id: string; isAdmin: boolean };

/**
 * De cursuskaart van een studiecursus (CFM) in Leren: voortgang in weken, "Ga verder" naar de huidige week en het
 * officiële lesbeeld van die week. Leest alleen; dezelfde bronnen als het weekpad zelf (getStudyCatalogue), dus kaart en
 * pad kunnen elkaar nooit tegenspreken. Een week is af als de les gelezen is of alle zes stappen afgerond zijn.
 */
export async function getStudyCourseSummary(actor: Actor, type: StudyCourseType) {
  const data = await getStudyCatalogue(actor);
  const weeks = data.lessons.filter((lesson) => lesson.personal);
  if (!weeks.length) return null;
  const done = (lesson: (typeof weeks)[number]) => lesson.read || lesson.stepsDone >= PERSONAL_STUDY_STEPS;
  const current = weeks.find((lesson) => lesson.lessonKey === data.currentLessonKey) ?? weeks.find((lesson) => !done(lesson)) ?? weeks[weeks.length - 1];
  const base = `/study-lesson/${current.lessonId}/${current.collectionId}`;
  return {
    totalWeeks: weeks.length,
    completedWeeks: weeks.filter(done).length,
    resumeHref: modeOfStudyCourse(type) === "STEPS" ? `${base}/stappen` : base,
    imageMediaId: current.imageMediaId ?? null,
  };
}
