import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { gameStartGuard } from "@/lib/gameStartGuard";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getActiveWordSearch, startWordSearch } from "@/lib/wordSearch/game";

const schema = z.object({
  difficulty: z.enum(["EASY", "MEDIUM", "HARD"]),
  theme: z.literal("RANDOM").default("RANDOM"),
}).strict();

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  return NextResponse.json({ game: await getActiveWordSearch(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return apiError("apiErrors.forbidden", 403);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const active = await getActiveWordSearch(user.id);
  if (active) return NextResponse.json(active);
  const denied = await gameStartGuard(req, user.id, "word-search");
  if (denied) return denied;
  try {
    return NextResponse.json(await startWordSearch(user.id, parsed.data.difficulty, parsed.data.theme));
  } catch {
    return await apiError("apiErrors.invalidInput", 500);
  }
}
