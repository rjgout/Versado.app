import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { acknowledgeWeeklyResult, getWeeklyResult } from "@/lib/weeklyResult";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("apiErrors.notLoggedIn", 401);
  return NextResponse.json({ result: await getWeeklyResult(user.id) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("apiErrors.notLoggedIn", 401);
  const body = await request.json().catch(() => null);
  if (typeof body?.weekStart !== "string") return NextResponse.json({}, { status: 400 });
  await acknowledgeWeeklyResult(user.id, body.weekStart);
  return NextResponse.json({ ok: true });
}
