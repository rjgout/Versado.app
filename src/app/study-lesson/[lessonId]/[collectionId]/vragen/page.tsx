import { notFound, redirect } from "next/navigation";
import { getCurrentUser, navigationSessionKey } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getPublishedStudyLesson } from "@/lib/studyContent/revisions";
import { loadStudyExerciseSource } from "@/lib/studyContent/exerciseSource";
import StudyExerciseClient from "@/components/study/StudyExerciseClient";
import ReaderBackTarget from "@/components/ReaderBackTarget";
import { pilotReadingSelections } from "@/lib/studyContent/pilotReadings";
import { getT } from "@/lib/i18n";
import { cfmCoursePathTarget } from "@/lib/studyContent/cfmCourses";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ lessonId: string; collectionId: string }>;
  searchParams: Promise<{ stap?: string; volledig?: string }>;
}) {
  const actor = await getCurrentUser();
  if (!actor) redirect("/login");
  const { lessonId, collectionId } = await params;
  if (lessonId.length > 128 || collectionId.length > 128) notFound();
  const lesson = await getPublishedStudyLesson(actor, lessonId, collectionId);
  if (!lesson) notFound();
  const query = await searchParams,
    stepIndex = query.stap ? Number(query.stap) : null;
  if (
    stepIndex !== null &&
    (!Number.isInteger(stepIndex) || stepIndex < 1 || stepIndex > 6)
  )
    notFound();
  const source = await loadStudyExerciseSource(actor, lesson.editionId, prisma);
  if (!source) notFound();
  const available =
    source.lesson.revisionId === lesson.revisionId &&
    source.plan.parts
      .filter((p) => stepIndex === null || p.index === stepIndex)
      .every((p) => p.questions.length === 3);
  const base = `/study-lesson/${encodeURIComponent(lessonId)}/${encodeURIComponent(collectionId)}`;
  const returnHref = stepIndex
    ? `${base}/stappen/${stepIndex}`
    : base + (query.volledig === "1" ? "?weergave=volledig" : "");
  const path = stepIndex === 6 ? await cfmCoursePathTarget(prisma, collectionId, "STEPS", actor.uiLanguage) : null;
  const nextHref = stepIndex ? stepIndex < 6 ? `${base}/stappen/${stepIndex + 1}` : path?.href ?? "/courses" : null;
  return (
    <>
      <ReaderBackTarget
        href={returnHref}
        parent={getT(actor.uiLanguage)("misc.backToLesson")}
      />
      <StudyExerciseClient
        key={`${lesson.editionId}:${lesson.revisionId}:${stepIndex}`}
        editionId={lesson.editionId}
        revisionId={lesson.revisionId}
        stepIndex={stepIndex}
        returnHref={returnHref}
        nextHref={nextHref}
        sessionKey={await navigationSessionKey()}
        available={available}
        requiresReadingVisit={pilotReadingSelections(source.lesson).length>0}
      />
    </>
  );
}
