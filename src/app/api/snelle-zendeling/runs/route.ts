import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { canUseQuickMissionary } from "@/lib/snelleZendeling/access";
import { startQuickMissionaryRun } from "@/lib/snelleZendeling/runs";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!(await canUseQuickMissionary(user.id, user.isAdmin))) return await apiError("apiErrors.forbidden", 403);
  return NextResponse.json(await startQuickMissionaryRun(user.id));
}
