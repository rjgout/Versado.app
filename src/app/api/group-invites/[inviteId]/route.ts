import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { respondGroupInvite } from "@/lib/social/groups";
import { socialError } from "@/lib/social/http";
import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";

const schema = z.object({ accept: z.boolean() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ inviteId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const { inviteId } = await params;
  try {
    const invite = await prisma.groupInvite.findUnique({ where: { id: inviteId }, select: { inviterId: true } });
    const result = await respondGroupInvite(user.id, inviteId, parsed.data.accept);
    if (invite) emitToUser(invite.inviterId, "data_event", { event: "groupsChanged" });
    return NextResponse.json(result);
  } catch (error) {
    return socialError(error);
  }
}
