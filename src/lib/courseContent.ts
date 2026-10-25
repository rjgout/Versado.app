import { isStudyCourseType } from "@/lib/readingCourses";
import { isPersonalStudyWork } from "@/lib/studyContent/personalStudyOverrides";

/** CFM-leeswijzen horen alleen bij een CFM-werk, ook bij verkeerd gekoppelde historische cursussen. */
export function courseTypeMatchesContent(type: string, work: string | null): boolean {
  return !isStudyCourseType(type) || isPersonalStudyWork(work ?? "");
}
