import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { answerReviveQuestion } from "@/lib/snelleZendeling/runs";

const schema = z.object({ exerciseId: z.string().min(1), optionId: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  try {
    return NextResponse.json(await answerReviveQuestion((await params).runId, user.id, parsed.data.exerciseId, parsed.data.optionId));
  } catch {
    return await apiError("apiErrors.invalidInput", 409);
  }
}
