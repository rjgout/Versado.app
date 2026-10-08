import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { checkAndAwardAchievements } from "@/lib/achievements";
import { apiError } from "@/lib/apiError";
import { emitToUser } from "@/lib/realtime";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ friendshipId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const { friendshipId } = await params;
  const friendship = await prisma.friendship.findUnique({ where: { id: friendshipId } });
  if (!friendship || friendship.receiverId !== user.id) {
    return await apiError("apiErrors.requestNotFound", 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.friendship.update({ where: { id: friendshipId }, data: { status: "ACCEPTED" } });
    await checkAndAwardAchievements(tx, friendship.senderId);
    await checkAndAwardAchievements(tx, friendship.receiverId);
  });
  emitToUser(friendship.senderId, "friends_changed");
  return NextResponse.json({ ok: true });
}
