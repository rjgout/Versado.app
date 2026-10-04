import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { requestReviveQuestion } from "@/lib/snelleZendeling/runs";

export async function POST(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  try {
    return NextResponse.json(await requestReviveQuestion((await params).runId, user.id));
  } catch (error) {
    return await apiError(error instanceof Error && error.message === "NO_QUESTION" ? "quickMissionary.noQuestion" : "apiErrors.invalidInput", 409);
  }
}
