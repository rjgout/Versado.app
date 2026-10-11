import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { readingAccessWhere } from "@/lib/contentAccess";
import { getCurrentUser } from "@/lib/session";
import { isExerciseCorrect } from "@/lib/exerciseGen";
import { apiError } from "@/lib/apiError";

const schema = z.object({ given: z.array(z.string()).min(1) });

// Losse, directe correctheidscheck per oefening — zodat de gebruiker meteen
// na het antwoorden (vóór "Doorgaan") ziet of het goed was, in plaats van
// pas aan het einde van de hele les. Schrijft bewust niets weg: het
// definitieve ExerciseAttempt-record en de score/XP-berekening gebeuren nog
// steeds in /api/chapters/[chapterId]/submit, ook na een leermoment-retry.
export async function POST(req: NextRequest, { params }: { params: Promise<{ exerciseId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { exerciseId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return await apiError("apiErrors.invalidInput", 400);
  }

  const exercise = await prisma.exercise.findFirst({
    where: {
      id: exerciseId,
      chapter: { book: { contentCollection: readingAccessWhere(user) } },
      ...(user.isAdmin ? {} : { status: "APPROVED" }),
    },
  });
  if (!exercise) {
    return await apiError("apiErrors.exerciseNotFound", 404);
  }

  const accepted = JSON.parse(exercise.answers) as string[];
  const correct = isExerciseCorrect(exercise.type, parsed.data.given, accepted);

  return NextResponse.json({ correct, correctAnswer: accepted });
}
