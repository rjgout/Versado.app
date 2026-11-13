import { apiError } from "@/lib/apiError";
import { loadProfile } from "@/lib/profile/load";
import { getCurrentUser } from "@/lib/session";
import { NextResponse } from "next/server";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  return NextResponse.json(await loadProfile(user));
}
