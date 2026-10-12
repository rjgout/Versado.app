import { prisma } from "@/lib/db";
import { collectionAccessWhere } from "@/lib/contentAccess";
import { getGameSettings } from "@/lib/gameSettings";
import { supportsGameSource } from "@/lib/gameAvailabilityPolicy";
import { getT } from "@/lib/i18n";
import { supportsStudy, studyUnitsForCourse } from "./units";

/** De bestaande cursusadapter staat los van de scope voor losse EXERCISES-spellen. */
export async function canStartStudy(courseId: string): Promise<boolean> {
  const [settings, course] = await Promise.all([
    getGameSettings(),
    prisma.course.findFirst({ where: { id: courseId, enabled: true, contentCollection: collectionAccessWhere({ isAdmin: false }) }, select: {
      id: true, type: true, podcastId: true,
      contentCollection: { select: { work: true, editionKey: true, language: true, contentWork: { select: { kind: true } } } },
    } }),
  ]);
  if (!settings.liveExercisesEnabled || !course || !supportsStudy(course.type) || !course.contentCollection) return false;
  const source = { ...course.contentCollection, kind: course.contentCollection.contentWork?.kind ?? null };
  if (course.type === "PODCAST") {
    if (source.kind !== "OTHER" || source.work !== "podcasts" || !course.podcastId) return false;
  } else {
    if (!supportsGameSource("live-exercises", source)) return false;
    // De introductie- en kinderboekvragen zijn expliciet BOM-content.
    if (["INTRO", "KIDS"].includes(course.type) && source.work !== "bofm") return false;
  }
  const groups = await studyUnitsForCourse(course, getT("nl"));
  return groups.some(group => group.units.length > 0);
}
