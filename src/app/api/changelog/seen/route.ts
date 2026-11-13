import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/db";
import { markProfileChangelogSeen } from "@/lib/profile/changelog";
import { getCurrentUser } from "@/lib/session";
import { NextResponse } from "next/server";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  await markProfileChangelogSeen(prisma, user.id);
  return NextResponse.json({ ok: true });
}
