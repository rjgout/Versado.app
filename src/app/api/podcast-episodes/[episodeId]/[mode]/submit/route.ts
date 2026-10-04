import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { isExerciseCorrect } from "@/lib/exerciseGen";
import { completePodcastLesson } from "@/lib/streak";
import { notifyNewAchievements } from "@/lib/notify";
import { standardContentXp } from "@/lib/xpRules";
import { apiError } from "@/lib/apiError";
import { activitySubmissionKey } from "@/lib/activitySubmission";

const schema = z.object({
  answers: z.array(
    z.object({
      exerciseId: z.string(),
      given: z.array(z.string()).min(1),
    })
  ),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ episodeId: string; mode: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { episodeId, mode: modeParam } = await params;
  if (modeParam !== "CONTENT" && modeParam !== "BOM_CONNECTION") {
    return await apiError("apiErrors.invalidMode", 400);
  }
  const mode = modeParam;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return await apiError("apiErrors.invalidInput", 400);
  }

  const exercises = await prisma.podcastExercise.findMany({ where: { episodeId, mode } });
  if (exercises.length === 0) {
    return await apiError("apiErrors.episodeNotFound", 404);
  }
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  let correctCount = 0;
  const results: { exerciseId: string; correct: boolean; correctAnswer: string[] }[] = [];

  // Elke vraag telt één keer, ook als hij vaker wordt ingestuurd; alleen
  // een les waarin alle vragen beantwoord zijn telt mee voor de reeks.
  const seen = new Set<string>();
  for (const submitted of parsed.data.answers) {
    if (seen.has(submitted.exerciseId)) continue;
    seen.add(submitted.exerciseId);
    const exercise = exerciseById.get(submitted.exerciseId);
    if (!exercise || exercise.episodeId !== episodeId) continue;

    const accepted = JSON.parse(exercise.answers) as string[];
    const correct = isExerciseCorrect(exercise.type, submitted.given, accepted);

    if (correct) correctCount++;
    results.push({ exerciseId: exercise.id, correct, correctAnswer: accepted });

    await prisma.podcastExerciseAttempt.create({
      data: {
        userId: user.id,
        exerciseId: exercise.id,
        givenText: submitted.given.join(" "),
        correct,
      },
    });
  }

  const total = exercises.length;
  const scorePercent = total === 0 ? 0 : Math.round((correctCount / total) * 100);
  const xp = standardContentXp(correctCount, total);

  const lessonResult = await completePodcastLesson(user.id, episodeId, mode, scorePercent, xp, results.length, total, activitySubmissionKey(req.headers, `podcast:${episodeId}:${mode}`, parsed.data.answers));
  notifyNewAchievements(user.id, lessonResult.newAchievements).catch(() => {});

  return NextResponse.json({ results, correctCount, total, ...lessonResult });
}
