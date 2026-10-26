import { retryableScriptureReference } from "@/lib/references/bible";
import { isPersonalStudyWork } from './personalStudyOverrides';
import { loadStudyExerciseSource } from './exerciseSource';
import { prisma } from "@/lib/db";
import { getPublishedStudyLesson, type PublishedStudyDTO } from "./revisions";
import { getReadingPosition } from "./readingPosition";
import { issueReadingVisitProof } from "./readingVisitProof";
import type { ReadingPositionState } from "./readingPositionContract";
import { getStudyLessonReadState, type StudyReadState } from "./readStatus";
export interface StudyReaderDTO {
  lesson: PublishedStudyDTO;
  positionState: ReadingPositionState;
  readState: StudyReadState;
  media: Array<{ mediaKey: string; mediaId: string | null }>;
  visitProof: string | null;
  exerciseCounts?: number[];
  blockedReferences?: string[];
}
/** Geen profielkeuze, voortgangswrite of tweede rechtenlaag. */
export async function getStudyReader(
  actor: { id: string; isAdmin: boolean },
  lessonId: string,
  collectionId: string,
  sessionKey?: string,
): Promise<StudyReaderDTO | null> {
  const lesson = await getPublishedStudyLesson(actor, lessonId, collectionId);
  if (!lesson) return null;
  const [positionState, bindings, readState, blocked] = await Promise.all([
    getReadingPosition(actor, lesson.editionId),
    prisma.studyRevisionMedia.findMany({
      where: { revisionId: lesson.revisionId },
      select: { mediaKey: true, media: { select: { id: true, status: true } } },
    }),
    getStudyLessonReadState(prisma, actor.id, lesson),
    prisma.contentReference.findMany({where:{revisionId:lesson.revisionId,diagnosis:{notIn:["INTERNAL_VERIFIED","EXTERNAL_VERIFIED"]}},select:{occurrenceKey:true,originalTarget:true,label:true}}),
  ]);
  // Een gelijktijdige pointerwissel is zichtbaar als update, maar vervangt deze
  // gevalideerde body niet. Media-API hercontroleert actuele publicatierechten.
  const exerciseSource=isPersonalStudyWork(lesson.workKey)?await loadStudyExerciseSource(actor,lesson.editionId,prisma):null;
  return {
    lesson,
    exerciseCounts: exerciseSource?.lesson.revisionId===lesson.revisionId?exerciseSource.plan.parts.map(p=>p.questions.length):undefined,
    blockedReferences: blocked.filter(r => !retryableScriptureReference(r.originalTarget as Record<string, unknown>, r.label)).map(r => r.occurrenceKey),
    visitProof: sessionKey
      ? issueReadingVisitProof(actor.id, lesson.editionId, lesson.revisionId, sessionKey)
      : null,
    positionState,
    readState,
    media: bindings.map((b) => ({
      mediaKey: b.mediaKey,
      mediaId: b.media.status === "READY" ? b.media.id : null,
    })),
  };
}
