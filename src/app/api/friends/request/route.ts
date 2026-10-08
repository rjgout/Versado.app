import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { notifyFriendRequest } from "@/lib/notify";
import { apiError } from "@/lib/apiError";
import { emitToUser } from "@/lib/realtime";

const schema = z.object({ targetUserId: z.string().trim().min(1) });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const target = await prisma.user.findUnique({ where: { id: parsed.data.targetUserId } });
  if (!target) return await apiError("apiErrors.userNotFoundDot", 404);
  if (target.id === user.id) {
    return await apiError("apiErrors.cantAddSelf", 400);
  }

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { senderId: user.id, receiverId: target.id },
        { senderId: target.id, receiverId: user.id },
      ],
    },
  });
  if (existing) {
    return await apiError("apiErrors.friendshipExists", 409);
  }

  const friendship = await prisma.friendship.create({
    data: { senderId: user.id, receiverId: target.id, status: "PENDING" },
  });

  notifyFriendRequest(target.id, user.handle).catch(() => {});
  emitToUser(target.id, "friends_changed");

  return NextResponse.json({ id: friendship.id });
}
