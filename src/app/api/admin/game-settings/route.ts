import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { getGameSettings, updateGameSettings } from "@/lib/gameSettings";
import { apiError } from "@/lib/apiError";

const schema = z.object({
  wordGameEnabled: z.boolean().optional(),
  scrabbleEnabled: z.boolean().optional(),
  gezinsavondEnabled: z.boolean().optional(),
  chapterGuessEnabled: z.boolean().optional(),
  challengesEnabled: z.boolean().optional(),
  liveExercisesEnabled: z.boolean().optional(),
  alleskennerEnabled: z.boolean().optional(),
  jigsawEnabled: z.boolean().optional(),
  wordSearchEnabled: z.boolean().optional(),
  quickMissionaryEnabled: z.boolean().optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);

  return NextResponse.json(await getGameSettings());
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  if (Object.keys(parsed.data).length === 0) {
    return await apiError("apiErrors.nothingToSave", 400);
  }

  return NextResponse.json(await updateGameSettings(parsed.data));
}
