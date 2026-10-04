import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getQuickMissionaryRunView } from "@/lib/snelleZendeling/runs";

export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const { runId } = await params;
  try {
    return NextResponse.json(await getQuickMissionaryRunView(runId, user.id));
  } catch {
    return await apiError("apiErrors.invalidInput", 404);
  }
}
