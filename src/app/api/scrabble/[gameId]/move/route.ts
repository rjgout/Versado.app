import { canResumeGameContent } from "@/lib/gameAvailability";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { placeMove } from "@/lib/scrabbleGame";
import { BOARD_SIZE } from "@/lib/scrabble/board";
import { RACK_SIZE } from "@/lib/scrabble/tiles";
import { apiError, apiErrorText } from "@/lib/apiError";

const schema = z.object({
  placements: z
    .array(
      z.object({
        row: z.number().int().min(0).max(BOARD_SIZE - 1),
        col: z.number().int().min(0).max(BOARD_SIZE - 1),
        letter: z.string().length(1),
        isBlank: z.boolean(),
      })
    )
    .min(1)
    .max(RACK_SIZE),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ gameId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!(await canResumeGameContent("content_bom"))) return apiError("gameAvailability.unavailable", 403);

  const { gameId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const result = await placeMove(gameId, user.id, parsed.data.placements);
  if (!result.ok) return await apiErrorText(result.error, 400);
  return NextResponse.json(result);
}
