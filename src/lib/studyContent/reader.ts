import { prisma } from "@/lib/db";
import { getPublishedStudyLesson, type PublishedStudyDTO } from "./revisions";
import { getReadingPosition } from "./readingPosition";
import type { ReadingPositionState } from "./readingPositionContract";
export interface StudyReaderDTO {
  lesson: PublishedStudyDTO;
  positionState: ReadingPositionState;
  media: Array<{ mediaKey: string; mediaId: string | null }>;
}
/** Geen profielkeuze, voortgangswrite of tweede rechtenlaag. */
export async function getStudyReader(
  actor: { id: string; isAdmin: boolean },
  lessonId: string,
  collectionId: string,
): Promise<StudyReaderDTO | null> {
  const lesson = await getPublishedStudyLesson(actor, lessonId, collectionId);
  if (!lesson) return null;
  const [positionState, bindings] = await Promise.all([
    getReadingPosition(actor, lesson.editionId),
    prisma.studyRevisionMedia.findMany({
      where: { revisionId: lesson.revisionId },
      select: { mediaKey: true, media: { select: { id: true, status: true } } },
    }),
  ]);
  // Een gelijktijdige pointerwissel is zichtbaar als update, maar vervangt deze
  // gevalideerde body niet. Media-API hercontroleert actuele publicatierechten.
  return {
    lesson,
    positionState,
    media: bindings.map((b) => ({
      mediaKey: b.mediaKey,
      mediaId: b.media.status === "READY" ? b.media.id : null,
    })),
  };
}
