import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { isExerciseCorrect } from "@/lib/exerciseGen";
import { completeQuickPractice } from "@/lib/streak";
import { notifyNewAchievements } from "@/lib/notify";
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

// Verwerkt een "Snelle ronde": een korte, hoofdstukloze oefensessie die wél
// de dagstreak redt maar geen enkele cursus vooruit helpt (zie
// src/lib/streak.ts#completeQuickPractice). De oefeningen komen uit reeds
// voltooide hoofdstukken (zie /practice), maar dat wordt hier niet meer
// afgedwongen — elke APPROVED oefening mag beantwoord worden.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success || parsed.data.answers.length === 0) {
    return await apiError("apiErrors.invalidInput", 400);
  }

  const exerciseIds = parsed.data.answers.map((a) => a.exerciseId);
  const exercises = await prisma.exercise.findMany({ where: { id: { in: exerciseIds }, status: "APPROVED" } });
  if (new Set(exerciseIds).size !== exerciseIds.length || exercises.length !== exerciseIds.length) {
    return await apiError("apiErrors.invalidInput", 400);
  }
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  let correctCount = 0;
  for (const submitted of parsed.data.answers) {
    const exercise = exerciseById.get(submitted.exerciseId);
    if (!exercise) continue;

    const accepted = JSON.parse(exercise.answers) as string[];
    const correct = isExerciseCorrect(exercise.type, submitted.given, accepted);
    if (correct) correctCount++;

    await prisma.exerciseAttempt.create({
      data: { userId: user.id, exerciseId: exercise.id, givenText: submitted.given.join(" "), correct },
    });
  }

  const total = parsed.data.answers.length;
  const result = await completeQuickPractice(user.id, correctCount, total, activitySubmissionKey(req.headers, "practice", parsed.data.answers));
  notifyNewAchievements(user.id, result.newAchievements).catch(() => {});

  return NextResponse.json({ correctCount, total, ...result });
}
