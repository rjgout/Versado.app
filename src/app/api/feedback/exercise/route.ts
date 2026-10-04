import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getBaseUrl } from "@/lib/baseUrl";
import { apiError, apiErrorText } from "@/lib/apiError";
import { createExerciseFeedback } from "@/lib/feedback";
import { isExerciseFeedbackCategory } from "@/lib/exerciseFeedback";

const categoryValues = [
  "ANSWER_SHOULD_BE_ACCEPTED",
  "ANSWER_SHOULD_BE_REJECTED",
  "QUESTION_UNCLEAR",
  "ANSWERS_INCORRECT",
  "VISUAL_BROKEN",
  "OTHER",
] as const;

const schema = z.object({
  questionId: z.string().trim().min(1).max(100),
  source: z.enum(["SCRIPTURE", "INTRO", "KIDS", "PODCAST"]),
  category: z.enum(categoryValues),
  requestId: z.string().trim().min(8).max(100),
  courseId: z.string().trim().min(1).max(100).optional(),
  lessonId: z.string().trim().min(1).max(100).optional(),
  contentKey: z.string().trim().min(1).max(200).optional(),
  chapterId: z.string().trim().min(1).max(100).optional(),
  verseRef: z.string().trim().max(200).optional(),
  givenAnswer: z.array(z.string().max(500)).max(20).optional(),
});

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success || !isExerciseFeedbackCategory(parsed.data?.category ?? "")) {
    return await apiErrorText("Ongeldige vraagfeedback.", 400);
  }

  try {
    const result = await createExerciseFeedback({ ...parsed.data, userId: user.id, category: parsed.data.category, baseUrl: getBaseUrl(req) });
    if (!result.ok) return await apiErrorText(result.error, 404);
    return NextResponse.json({ ok: true, id: result.feedback.id });
  } catch {
    return await apiErrorText("De vraagfeedback kon niet worden verstuurd.", 500);
  }
}
