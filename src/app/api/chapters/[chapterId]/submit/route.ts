import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getCurrentUser } from "@/lib/session";
import { advanceCourseProgress } from "@/lib/courses";
import { notifyNewAchievements } from "@/lib/notify";
import { recordChallengeAttempt } from "@/lib/challenges";
import { apiError } from "@/lib/apiError";
import { ExerciseSessionError, submitExerciseSession } from "@/lib/learning/contentProgress";
import { exerciseSessionErrorResponse } from "@/lib/learning/apiResponses";

const schema = z.object({
  // De oefenset die de lespagina heeft uitgedeeld (issueExerciseSession):
  // alleen die vragen tellen.
  sessionId: z.string().min(1),
  answers: z.array(
    z.object({
      exerciseId: z.string(),
      given: z.array(z.string()).min(1),
    })
  ),
  // Gezet als dit hoofdstuk gespeeld wordt als iemands beurt in een
  // uitdaging (zie /challenges) — de score telt dan ook mee daarvoor.
  challengeId: z.string().optional(),
  // De cursus waaruit de les geopend werd, om die door te schuiven.
  courseId: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ chapterId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { chapterId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const accessible = await prisma.chapter.findFirst({
    where: { id: chapterId, book: { contentCollection: readingAccessWhere(user) } }, select: { id: true },
  });
  if (!accessible) return await apiError("apiErrors.chapterNotFound", 404);

  let result;
  try {
    result = await submitExerciseSession(user.id, parsed.data.sessionId, parsed.data.answers, {
      validate: async (_tx, session) => {
        if (session.chapterId !== chapterId || session.courseLessonId !== null) throw new ExerciseSessionError("NOT_FOUND");
      },
    });
  } catch (error) {
    const response = await exerciseSessionErrorResponse(error);
    if (response) return response;
    throw error;
  }
  notifyNewAchievements(user.id, result.newAchievements).catch(() => {});

  if (parsed.data.challengeId) {
    await recordChallengeAttempt(user.id, parsed.data.challengeId, chapterId, result.scorePercent).catch(() => {});
  }

  // Pas als het hoofdstuk gelezen én geoefend is, schuift een cursus met een
  // vaste volgorde door (no-op voor Vrije keuze en als het hoofdstuk niet bij
  // die cursus hoort).
  if (result.content.done) {
    for (const courseId of new Set([parsed.data.courseId, user.activeCourseId].filter((id): id is string => !!id))) {
      await advanceCourseProgress(prisma, user.id, courseId, chapterId);
    }
  }

  return NextResponse.json(result);
}
