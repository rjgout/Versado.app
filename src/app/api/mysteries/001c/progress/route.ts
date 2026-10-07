import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { canUseMystery, completeMystery, getMysteryProgress, markMysteryTutorialSeen } from "@/lib/mysteries/progress";
import { MYSTERY_001C } from "@/lib/mysteries/mystery001c";
import type { Placements } from "@/lib/mysteries/types";

const cell = z.object({ row: z.number().int().min(1).max(6), column: z.number().int().min(1).max(6) });
const completion = z.object({
  action: z.literal("complete"),
  placements: z.object({ lehi: cell, sariah: cell, laman: cell, lemuel: cell, sam: cell, nephi: cell }),
  hintCount: z.number().int().min(0).max(99),
});
const requestSchema = z.discriminatedUnion("action", [completion, z.object({ action: z.literal("tutorial-seen") })]);

async function authorizedUser() {
  const user = await getCurrentUser();
  if (!user) return { user: null, status: 401 as const };
  if (!(await canUseMystery(user.id, user.isAdmin))) return { user: null, status: 403 as const };
  return { user, status: 200 as const };
}

export async function GET() {
  const auth = await authorizedUser();
  if (!auth.user) return await apiError(auth.status === 401 ? "apiErrors.notLoggedIn" : "apiErrors.forbidden", auth.status);
  return NextResponse.json(await getMysteryProgress(auth.user.id, MYSTERY_001C));
}

export async function POST(req: NextRequest) {
  const auth = await authorizedUser();
  if (!auth.user) return await apiError(auth.status === 401 ? "apiErrors.notLoggedIn" : "apiErrors.forbidden", auth.status);
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  if (parsed.data.action === "tutorial-seen") {
    await markMysteryTutorialSeen(auth.user.id, MYSTERY_001C);
    return NextResponse.json({ ok: true });
  }
  const result = await completeMystery(auth.user.id, MYSTERY_001C, parsed.data.placements as Placements, parsed.data.hintCount);
  if (!result.correct) return NextResponse.json({ correct: false, error: "Er klopt nog iets niet." }, { status: 422 });
  return NextResponse.json(result);
}
