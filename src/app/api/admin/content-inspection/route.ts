import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getAdminContentInspection } from "@/lib/adminContentInspection";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return apiError("apiErrors.forbidden", 403);
  return NextResponse.json(await getAdminContentInspection(), { headers: { "Cache-Control": "no-store" } });
}
