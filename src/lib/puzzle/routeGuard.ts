import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { canResumeGameContent } from "@/lib/gameAvailability";
import { PUZZLE_CONTENT_COLLECTION_ID } from "@/lib/puzzle/access";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { apiError } from "@/lib/apiError";
import { getT } from "@/lib/i18n";
import { PuzzleServiceError, puzzleErrorStatus } from "@/lib/puzzle/errors";

/** Bestaande partijen: normale oorspronkelijke bronrechten; startcontrole zit in de createservice. */
export async function puzzleRouteUser(req?: Request) {
  const user = await getCurrentUser();
  if (!user) return { response: await apiError("apiErrors.notLoggedIn", 401) } as const;
  const t = getT(user.uiLanguage);
  if (req && !inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return { response: await apiError("apiErrors.forbidden", 403) } as const;
  if (!await canResumeGameContent(PUZZLE_CONTENT_COLLECTION_ID)) return { response: NextResponse.json({ error: t("gameAvailability.unavailable") }, { status: 403 }) } as const;
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
