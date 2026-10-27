import { retryableScriptureReference } from "@/lib/references/bible";
import { isPersonalStudyWork } from "./personalStudyOverrides";
import { loadPilotReadings } from "./pilotReadingSource";
import {
  pilotReadingSelections,
  type StudyScriptureReading,
} from "./pilotReadings";
import { loadStudyExerciseSource } from "./exerciseSource";
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
  scriptureReadings?: StudyScriptureReading[];
  scriptureReadingSteps?: number[];
  exerciseVisitProofs?: { week: string; steps: string[] };
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
    prisma.contentReference.findMany({
      where: {
        revisionId: lesson.revisionId,
        diagnosis: { notIn: ["INTERNAL_VERIFIED", "EXTERNAL_VERIFIED"] },
      },
      select: { occurrenceKey: true, originalTarget: true, label: true },
    }),
  ]);
  // Een gelijktijdige pointerwissel is zichtbaar als update, maar vervangt deze
  // gevalideerde body niet. Media-API hercontroleert actuele publicatierechten.
  const exerciseSource = isPersonalStudyWork(lesson.workKey)
    ? await loadStudyExerciseSource(actor, lesson.editionId, prisma)
    : null;
  const scriptureReadings =
    exerciseSource?.lesson.revisionId === lesson.revisionId
      ? exerciseSource.scriptureReadings
      : await loadPilotReadings(actor, lesson, prisma);
  return {
    lesson,
    scriptureReadings,
    exerciseVisitProofs:
      sessionKey &&
      exerciseSource?.lesson.revisionId === lesson.revisionId &&
      pilotReadingSelections(lesson).length
        ? {
            week: issueReadingVisitProof(
              actor.id,
              lesson.editionId,
              `${lesson.revisionId}:${exerciseSource.plan.fingerprint}:week`,
              sessionKey,
            ),
            steps: [1, 2, 3, 4, 5, 6].map((index) =>
              issueReadingVisitProof(
                actor.id,
                lesson.editionId,
                `${lesson.revisionId}:${exerciseSource.plan.fingerprint}:${index}`,
                sessionKey,
              ),
            ),
          }
        : undefined,
    scriptureReadingSteps: [
      ...new Set(pilotReadingSelections(lesson).map((q) => q.stepIndex)),
    ],
    exerciseCounts:
      exerciseSource?.lesson.revisionId === lesson.revisionId
        ? exerciseSource.plan.parts.map((p) => p.questions.length)
        : undefined,
    blockedReferences: blocked
      .filter(
        (r) =>
          !retryableScriptureReference(
            r.originalTarget as Record<string, unknown>,
            r.label,
          ),
      )
      .map((r) => r.occurrenceKey),
    visitProof: sessionKey
      ? issueReadingVisitProof(
          actor.id,
          lesson.editionId,
          lesson.revisionId,
          sessionKey,
        )
      : null,
    positionState,
    readState,
    media: bindings.map((b) => ({
      mediaKey: b.mediaKey,
      mediaId: b.media.status === "READY" ? b.media.id : null,
    })),
  };
}
