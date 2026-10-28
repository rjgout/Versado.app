import { loadStudyExerciseSource } from '@/lib/studyContent/exerciseSource';
import { NextRequest, NextResponse } from "next/server";
import { exerciseAccessWhere } from "@/lib/learning/exerciseAccess";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getCurrentUser } from "@/lib/session";
import { generateExerciseHint } from "@/lib/exerciseHints";
import { toLanguageCode } from "@/lib/languages";
import { apiError } from "@/lib/apiError";

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { hintBalance: true } });
  return NextResponse.json({ hintBalance: current?.hintBalance ?? 0 });
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ exerciseId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { exerciseId } = await params;
  const requested=await prisma.exercise.findUnique({where:{id:exerciseId},select:{studyLessonEditionId:true}});
  const study=requested?.studyLessonEditionId?await loadStudyExerciseSource(user,requested.studyLessonEditionId,prisma):null;
  const studyQuestion=study?.plan.parts.flatMap(p=>p.questions).find(q=>q.id===exerciseId);
  const exercise = await prisma.exercise.findFirst({
    where: studyQuestion?{id:exerciseId,status:"APPROVED"}:await exerciseAccessWhere(user.id, exerciseId, { chapter: { book: { contentCollection: readingAccessWhere(user) } } }),
    include: {
      sourceVerse: { where: { chapter: { book: { contentCollection: readingAccessWhere(user) } } }, select: { text: true } },
      chapter: { select: { book: { select: { contentCollection: { select: { language: true } } } } } },
    },
  });
  if (!exercise) return await apiError("apiErrors.exerciseNotFound", 404);

  let hint = exercise.hint;
  if (!hint) {
    const answers = JSON.parse(exercise.answers) as string[];
    // In de taal van de uitgave, net als de oefening zelf.
    const language = toLanguageCode(study?.lesson.language??exercise.chapter?.book.contentCollection.language);
    hint = generateExerciseHint(exercise.type, exercise.prompt, answers, exercise.verseRef, studyQuestion?.studySource.quote??exercise.sourceVerse?.text, language);
    await prisma.exercise.update({ where: { id: exercise.id }, data: { hint } });
  }

  const result = await prisma.user.updateMany({
    where: { id: user.id, hintBalance: { gt: 0 } },
    data: { hintBalance: { decrement: 1 } },
  });
  if (result.count === 0) {
    return await apiError("apiErrors.noHintCredit", 400);
  }

  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { hintBalance: true } });
  return NextResponse.json({ hint, hintBalance: current?.hintBalance ?? 0 });
}
