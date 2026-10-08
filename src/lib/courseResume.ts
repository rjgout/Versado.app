import type { CourseType } from "@/generated/prisma/client";

/**
 * De bestaande routes naar een concrete leesstap. Een null-resultaat betekent
 * bewust dat er geen geldig persoonlijk hervatpunt is; de aanroeper valt dan
 * niet terug op een algemene cursuspagina in een "Ga verder"-kaart.
 */
export function readingResumeHref({
  courseId,
  type,
  currentChapterId,
  currentLessonId,
}: {
  courseId: string;
  type: CourseType;
  currentChapterId: string | null;
  currentLessonId: string | null;
}): string | null {
  if (type === "READING_LESSONS") return currentLessonId ? `/reading-lesson/${currentLessonId}` : null;
  if (type === "FRONT_TO_BACK" || type === "FREE_CHOICE" || type === "BY_BOOK") {
    return currentChapterId ? `/lesson/${currentChapterId}?cursus=${courseId}` : null;
  }
  return null;
}

/** Deze inhoudstypen hebben elk al een eigen detailroute met een concrete stap. */
export function kidsResumeHref(storyId: string | null): string | null {
  return storyId ? `/kids/${storyId}` : null;
}

export function introResumeHref(lessonId: string | null): string | null {
  return lessonId ? `/intro/${lessonId}` : null;
}

export function podcastResumeHref(
  episodeId: string | null,
  mode: "CONTENT" | "BOM_CONNECTION" | null
): string | null {
  return episodeId && mode ? `/podcast/${episodeId}/${mode}` : null;
}
