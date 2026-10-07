import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { canUseMysteryNumber } from "@/lib/mysteries/progress";
import { mysteryDefinitionFor, type MysteryId } from "@/lib/mysteries/game";
import { consumeMysteryHint } from "@/lib/mysteries/hints";
import type { MysteryDifficultyId, Placements } from "@/lib/mysteries/types";

const cell = z.object({ row: z.number().int().min(1).max(6), column: z.number().int().min(1).max(6) });
const requestSchema = z.object({
  difficulty: z.enum(["discoverer", "investigator", "scripture-scholar"]),
  placements: z.object({
    lehi: cell.nullable().optional(),
    sariah: cell.nullable().optional(),
    laman: cell.nullable().optional(),
    lemuel: cell.nullable().optional(),
    sam: cell.nullable().optional(),
    nephi: cell.nullable().optional(),
    ismael: cell.nullable().optional(),
  }),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ mystery: string }> }) {
  const { mystery } = await params;
  const number = Number(mystery);
  if (!Number.isInteger(number) || number < 3 || number > 6) return await apiError("apiErrors.itemNotFound", 404);
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!(await canUseMysteryNumber(user.id, user.isAdmin, number))) return await apiError("apiErrors.forbidden", 403);
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const definition = mysteryDefinitionFor(`mystery-${mystery}` as MysteryId, parsed.data.difficulty as MysteryDifficultyId);
  const result = await consumeMysteryHint(user.id, definition, parsed.data.placements as Placements);
  if (!result) return await apiError("apiErrors.noHintCredit", 400);
  return NextResponse.json(result);
}
