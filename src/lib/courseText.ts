import type { CourseType } from "@/generated/prisma/client";
import { getT } from "@/lib/i18n";
import { toLanguageCode } from "@/lib/languages";

interface CourseLike {
  type: CourseType;
  name: string;
  description: string | null;
  /** ContentCollection.work van de cursus ("bofm", "dc-testament", ...). */
  work?: string | null;
}

/**
 * Naam en omschrijving van een cursus in de taal van de app. In de database
 * staan ze in het Nederlands (syncCourses); voor Nederlands tonen we die
 * waarden dus letterlijk, ook als een beheerder ze ooit aanpaste. Voor andere
 * talen leiden we ze af van het soort cursus en het werk. Podcasts blijven
 * zoals ze heten: dat zijn eigennamen van Nederlandstalige podcasts.
 */
export function localizedCourse(course: CourseLike, uiLanguage: string | null | undefined): { name: string; description: string | null } {
  if (toLanguageCode(uiLanguage) === "nl") return { name: course.name, description: course.description };
  const t = getT(uiLanguage);
  const sections = course.work === "dc-testament";
  const oneBook = course.work === "dc-testament";
  switch (course.type) {
    case "FREE_CHOICE":
      return {
        name: t("courseNames.freeChoice"),
        description: t(sections ? "courseNames.freeChoiceDescSection" : "courseNames.freeChoiceDescChapter"),
      };
    case "FRONT_TO_BACK":
      return {
        name: t(sections ? "courseNames.frontToBackSection" : "courseNames.frontToBackChapter"),
        description: t(oneBook ? "courseNames.frontToBackDescSection" : "courseNames.frontToBackDescChapter"),
      };
    case "READING_LESSONS":
      return {
        name: t("courseNames.readingLessons"),
        description: t(
          course.work === "dc-testament"
            ? "courseNames.readingLessonsDescDc"
            : course.work === "pgp"
              ? "courseNames.readingLessonsDescPgp"
              : "courseNames.readingLessonsDescBofm"
        ),
      };
    case "INTRO":
      return { name: t("courseNames.intro"), description: t("courseNames.introDesc") };
    case "KIDS":
      return { name: t("courseNames.kids"), description: t("courseNames.kidsDesc") };
    case "FSY":
      return { name: t("courseNames.fsy"), description: t("courseNames.fsyDesc") };
    case "STUDY_STEPS":
      return { name: t("courseNames.studySteps"), description: t("courseNames.studyStepsDesc") };
    case "STUDY_FREE":
      return { name: t("courseNames.studyFree"), description: t("courseNames.studyFreeDesc") };
    default:
      return { name: course.name, description: course.description };
  }
}
