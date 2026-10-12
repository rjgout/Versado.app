// Alleen routehandlers: geen import vanuit de eager server.ts-keten.
import { apiError } from "@/lib/apiError";
import { canStartGame } from "@/lib/gameAvailability";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import type { ScopedGame } from "@/lib/gameAvailabilityPolicy";

export async function gameStartGuard(req: Request, userId: string, game: ScopedGame, requiredChapters = 5) {
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return apiError("apiErrors.forbidden", 403);
  if (!(await canStartGame(userId, game, requiredChapters))) return apiError("gameAvailability.unavailable", 403);
  return null;
}
