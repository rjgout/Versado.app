import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { canUseMysteryNumber, completeMystery, getMysteryProgress, markMysteryTutorialSeen } from "@/lib/mysteries/progress";
import { mysteryDefinitionForVariant, type MysteryId } from "@/lib/mysteries/game";
import type { Placements } from "@/lib/mysteries/types";

const cell = z.object({ row: z.number().int().min(1).max(6), column: z.number().int().min(1).max(6) });
const placements = z.object({
  lehi: cell.nullable().optional(),
  sariah: cell.nullable().optional(),
  laman: cell.nullable().optional(),
  lemuel: cell.nullable().optional(),
  sam: cell.nullable().optional(),
  nephi: cell.nullable().optional(),
  ismael: cell.nullable().optional(),
});
const requestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("complete"), placements, hintCount: z.number().int().min(0).max(99) }),
  z.object({ action: z.literal("tutorial-seen") }),
]);

const mysteryNumber = (value: string): number | null => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 3 && parsed <= 6 ? parsed : null;
};

async function authorizedDefinition(mystery: string, variant: string) {
  const number = mysteryNumber(mystery);
  if (number === null) return { status: 404 as const, user: null, definition: null };
  const user = await getCurrentUser();
  if (!user) return { status: 401 as const, user: null, definition: null };
  if (!(await canUseMysteryNumber(user.id, user.isAdmin, number))) return { status: 403 as const, user: null, definition: null };
  const definition = mysteryDefinitionForVariant(`mystery-${mystery}` as MysteryId, variant);
  if (!definition) return { status: 404 as const, user: null, definition: null };
  return { status: 200 as const, user, definition };
}

function errorFor(status: 401 | 403 | 404) {
  return apiError(status === 401 ? "apiErrors.notLoggedIn" : status === 403 ? "apiErrors.forbidden" : "apiErrors.itemNotFound", status);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ mystery: string; variant: string }> }) {
  const { mystery, variant } = await params;
  const auth = await authorizedDefinition(mystery, variant);
  if (!auth.user || !auth.definition) return await errorFor(auth.status);
  return NextResponse.json(await getMysteryProgress(auth.user.id, auth.definition));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ mystery: string; variant: string }> }) {
  const { mystery, variant } = await params;
  const auth = await authorizedDefinition(mystery, variant);
  if (!auth.user || !auth.definition) return await errorFor(auth.status);
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  if (parsed.data.action === "tutorial-seen") {
    await markMysteryTutorialSeen(auth.user.id, auth.definition);
    return NextResponse.json({ ok: true });
  }
  const result = await completeMystery(auth.user.id, auth.definition, parsed.data.placements as Placements, parsed.data.hintCount);
  if (!result.correct) return NextResponse.json({ correct: false, error: "Er klopt nog iets niet." }, { status: 422 });
  return NextResponse.json(result);
}
