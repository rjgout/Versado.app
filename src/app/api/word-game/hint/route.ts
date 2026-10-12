import { canResumeGameContent } from "@/lib/gameAvailability";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getT } from "@/lib/i18n";
import { buyWordGameHint, WordGameHintError, wordGameHintRequestSchema } from "@/lib/wordGameHints";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!(await canResumeGameContent("content_bom"))) return apiError("gameAvailability.unavailable", 403);
  const input = wordGameHintRequestSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return await apiError("apiErrors.invalidInput", 400);
  const t = getT(user.uiLanguage);
  try {
    return NextResponse.json(await buyWordGameHint(user.id, input.data));
  } catch (error) {
    if (!(error instanceof WordGameHintError)) {
      console.error("Woord-van-de-Dag-hint mislukt", error);
      return NextResponse.json({ error: t("wordOfTheDay.hintFailure") }, { status: 500 });
    }
    const keys = {
      NOT_FOUND: "wordOfTheDay.hintInvalidState", DAY_CHANGED: "wordOfTheDay.hintDayChanged",
      FINISHED: "wordOfTheDay.hintFinished", MAX_LEVEL: "wordOfTheDay.hintMax",
      EMPTY: "wordOfTheDay.hintEmpty", CONFLICT: "wordOfTheDay.hintConflict", INVALID_STATE: "wordOfTheDay.hintInvalidState",
    } as const;
    const remaining = error.nextHintAt ? Math.max(0, Math.ceil((Date.parse(error.nextHintAt) - error.serverNow) / 1000)) : 0;
    return NextResponse.json({
      error: error.code === "COOLDOWN" ? t("wordOfTheDay.hintCooldown", { minutes: Math.floor(remaining / 60), seconds: remaining % 60 }) : t(keys[error.code]),
      code: error.code, nextHintAt: error.nextHintAt, serverNow: error.serverNow,
    }, { status: error.code === "NOT_FOUND" ? 404 : 409 });
  }
}
