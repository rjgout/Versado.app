import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { notifyFriendRequest } from "@/lib/notify";
import { apiError } from "@/lib/apiError";
import { emitToUser } from "@/lib/realtime";
import { socialBudget } from "@/lib/social/abuseBudgets";
import { createFriendRequestOnce } from "@/lib/social/friendshipPair";

const schema = z.object({ targetUserId: z.string().trim().min(1) });

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const limited = await socialBudget("friendRequest", user.id);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);

  const target = await prisma.user.findUnique({ where: { id: parsed.data.targetUserId } });
  if (!target) return await apiError("apiErrors.userNotFoundDot", 404);
  if (target.id === user.id) {
    return await apiError("apiErrors.cantAddSelf", 400);
  }

  const outcome = await prisma.$transaction((tx) => createFriendRequestOnce(tx, user.id, target.id));
  if (!outcome.created) return await apiError("apiErrors.friendshipExists", 409);
  const friendship = { id: outcome.id };

  notifyFriendRequest(target.id, user.handle).catch(() => {});
  emitToUser(target.id, "friends_changed");

  return NextResponse.json({ id: friendship.id });
}
