import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { finishQuickMissionaryRun } from "@/lib/snelleZendeling/runs";

const schema = z.object({ score: z.number().int().min(0) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  try {
    await finishQuickMissionaryRun((await params).runId, user.id, parsed.data.score);
    return NextResponse.json({ ok: true });
  } catch {
    return await apiError("apiErrors.invalidInput", 409);
  }
}
