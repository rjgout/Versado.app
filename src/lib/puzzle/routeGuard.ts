import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { getContentContext } from "@/lib/contentCollections";
import { getGameSettings } from "@/lib/gameSettings";
import { apiError } from "@/lib/apiError";
import { getT } from "@/lib/i18n";
import { PuzzleServiceError, puzzleErrorStatus } from "@/lib/puzzle/errors";

/** Dezelfde toegang als Solo: ingelogd, spel aan en in de actieve contentkeuze. */
export async function puzzleRouteUser() {
  const user = await getCurrentUser();
  if (!user) return { response: await apiError("apiErrors.notLoggedIn", 401) } as const;
  const t = getT(user.uiLanguage);
  const [settings, context] = await Promise.all([getGameSettings(), getContentContext(user.id)]);
  if ((!settings.jigsawEnabled && !user.isAdmin) || !context.gameKeys.includes("jigsaw")) return { response: NextResponse.json({ error: t("jigsaw.unavailable") }, { status: 403 }) } as const;
  return { user, t } as const;
}

const messages: Record<string, Parameters<ReturnType<typeof getT>>[0]> = {
  NOT_FOUND: "puzzleTogether.errors.notFound",
  FORBIDDEN: "puzzleTogether.errors.forbidden",
  INVALID: "apiErrors.invalidInput",
  CAPACITY: "puzzleTogether.errors.capacity",
  NOT_FRIENDS: "puzzleTogether.errors.notFriends",
  EXPIRED: "puzzleTogether.errors.expired",
  CLOSED: "puzzleTogether.errors.closed",
  LOCKED: "puzzleTogether.errors.locked",
  NO_LOCK: "puzzleTogether.errors.noLock",
  CONFLICT: "puzzleTogether.errors.conflict",
  HINT_EMPTY: "jigsaw.hintEmpty",
  HINT_CONFIRM: "jigsaw.hintPersonalCost",
  ALREADY: "puzzleTogether.errors.already",
  NOT_STARTED: "puzzleTogether.errors.notStarted",
};

export function puzzleErrorResponse(error: unknown, t: ReturnType<typeof getT>) {
  if (error instanceof PuzzleServiceError) {
    return NextResponse.json({ error: t(messages[error.code] as never), code: error.code, ...error.detail }, { status: puzzleErrorStatus(error.code) });
  }
  console.error("Legpuzzel multiplayer:", error);
  return NextResponse.json({ error: t("jigsaw.failed") }, { status: 500 });
}
