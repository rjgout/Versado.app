import { apiError } from "@/lib/apiError";
import { prisma } from "@/lib/db";
import { resetProfileReading } from "@/lib/profile/readingReset";
import { getCurrentUser } from "@/lib/session";
import { NextResponse } from "next/server";


export async function POST() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  await prisma.$transaction(tx => resetProfileReading(tx, user.id), { timeout: 30000 });

  return NextResponse.json({ ok: true });
}
