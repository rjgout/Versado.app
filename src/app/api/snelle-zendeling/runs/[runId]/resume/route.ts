import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { resumeAfterRevive } from "@/lib/snelleZendeling/runs";

export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  try {
    await resumeAfterRevive((await params).runId, user.id);
    return NextResponse.json({ ok: true });
  } catch {
    return await apiError("apiErrors.invalidInput", 409);
  }
}
