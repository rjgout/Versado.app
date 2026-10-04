import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getStreakContinuation } from "@/lib/streakContinuation";

async function status(returned: boolean) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  return NextResponse.json(await getStreakContinuation(user.id, new Date(), returned), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() { return status(false); }
// Openen stopt de afwezigheidsmeldingen, maar verdient nooit een reeksdag.
export async function POST() { return status(true); }
