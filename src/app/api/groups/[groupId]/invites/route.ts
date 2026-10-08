import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { activeMembership, inviteToGroup } from "@/lib/social/groups";
import { invitableFriends } from "@/lib/social/groupViews";
import { socialError } from "@/lib/social/http";
import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";

/** Eigen vrienden die je voor deze groep kunt uitnodigen. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const { groupId } = await params;
  if (!(await activeMembership(prisma, groupId, user.id))) return await apiError("together.errors.groupNotFound", 404);
  return NextResponse.json({ friends: await invitableFriends(groupId, user.id) });
}

const schema = z.object({ userId: z.string().trim().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const { groupId } = await params;
  try {
    await inviteToGroup(user.id, groupId, parsed.data.userId);
    emitToUser(parsed.data.userId, "data_event", { event: "groupsChanged" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return socialError(error);
  }
}
