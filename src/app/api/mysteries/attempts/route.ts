import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getT } from "@/lib/i18n";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { mysteryActionSchema } from "@/lib/mysteries/attemptContract";
import { actOnMystery, getMysteryAttempt, MysteryAttemptError } from "@/lib/mysteries/attempts";
import { MYSTERY_GAME } from "@/lib/mysteries/game";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) { const response = await apiError("apiErrors.notLoggedIn", 401); response.headers.set("Cache-Control", "no-store"); return response; }
  const definition = MYSTERY_GAME.puzzles.find(d => d.routeId === req.nextUrl.searchParams.get("variant"));
  if (!definition) return json({ error: getT(user.uiLanguage)("apiErrors.invalidInput") }, 400);
  return json({ attempt: await getMysteryAttempt(user.id, definition) });
}
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) { const response = await apiError("apiErrors.notLoggedIn", 401); response.headers.set("Cache-Control", "no-store"); return response; }
  const t = getT(user.uiLanguage);
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return json({ error: t("apiErrors.forbidden") }, 403);
  const parsed = mysteryActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: t("apiErrors.invalidInput") }, 400);
  try {
    const result = await actOnMystery(user.id, parsed.data);
    return json(result, "correct" in result && result.correct === false ? 422 : 200);
  } catch (error) {
    if (error instanceof MysteryAttemptError) {
      const status = { NOT_FOUND: 404, INVALID: 400, CONFLICT: 409, SOURCE_UNAVAILABLE: 403, NO_HINTS: 400 }[error.code];
      const message = error.code === "CONFLICT" ? t("mysteryPersistence.conflict") : error.code === "SOURCE_UNAVAILABLE" ? t("mysteryPersistence.unavailable") : error.code === "NO_HINTS" ? t("apiErrors.noHintCredit") : t("apiErrors.invalidInput");
      return json({ error: message, code: error.code, attempt: error.current }, status);
    }
    // Geen payload, privégegevens of interne databasefouten teruggeven.
    return json({ error: t("mystery001a.saveFailed") }, 503);
  }
}
