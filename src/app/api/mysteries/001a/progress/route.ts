import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { canUseMystery001a, completeMystery001a, getMystery001aProgress, markMystery001aTutorialSeen } from "@/lib/mysteries/progress";
import type { Placements } from "@/lib/mysteries/types";

const cell = z.object({ row: z.number().int().min(1).max(4), column: z.number().int().min(1).max(4) });
const completion = z.object({
  action: z.literal("complete"),
  placements: z.object({ lehi: cell, sariah: cell, laman: cell, lemuel: cell }),
  hintCount: z.number().int().min(0).max(99),
});
const tutorial = z.object({ action: z.literal("tutorial-seen") });
const requestSchema = z.discriminatedUnion("action", [completion, tutorial]);

async function authorizedUser() {
  const user = await getCurrentUser();
  if (!user) return { user: null, status: 401 as const };
  if (!(await canUseMystery001a(user.id, user.isAdmin))) return { user: null, status: 403 as const };
  return { user, status: 200 as const };
}

export async function GET() {
  const auth = await authorizedUser();
  if (!auth.user) return await apiError(auth.status === 401 ? "apiErrors.notLoggedIn" : "apiErrors.forbidden", auth.status);
  return NextResponse.json(await getMystery001aProgress(auth.user.id));
}

export async function POST(req: NextRequest) {
  const auth = await authorizedUser();
  if (!auth.user) return await apiError(auth.status === 401 ? "apiErrors.notLoggedIn" : "apiErrors.forbidden", auth.status);
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  if (parsed.data.action === "tutorial-seen") {
    await markMystery001aTutorialSeen(auth.user.id);
    return NextResponse.json({ ok: true });
  }
  const result = await completeMystery001a(auth.user.id, parsed.data.placements as Placements, parsed.data.hintCount);
  // De response onthult bij een fout expres geen personage of cel.
  if (!result.correct) {
    return NextResponse.json({ correct: false, error: "Er klopt nog iets niet." }, { status: 422 });
  }
  return NextResponse.json(result);
}
