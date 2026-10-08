import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { decideJoinRequest } from "@/lib/social/joinLinks";
import { socialError } from "@/lib/social/http";
import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";

// Een toegangsverzoek toelaten of weigeren. Wie dat mag en of het nog kan,
// wordt server-side opnieuw gecontroleerd (joinLinks.ts); een verborgen knop
// in de app is geen beveiliging.
const schema = z.object({ action: z.enum(["approve", "decline"]) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ groupId: string; requestId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const { groupId, requestId } = await params;
  try {
    const request = await prisma.groupJoinRequest.findUnique({ where: { id: requestId }, select: { groupId: true, userId: true } });
    if (!request || request.groupId !== groupId) return await apiError("together.errors.joinRequestNotFound", 404);
    const result = await decideJoinRequest(user.id, requestId, parsed.data.action === "approve");
    const members = await prisma.groupMembership.findMany({ where: { groupId, leftAt: null }, select: { userId: true } });
    for (const member of members) emitToUser(member.userId, "data_event", { event: "groupsChanged" });
    emitToUser(request.userId, "data_event", { event: "groupsChanged" });
    return NextResponse.json(result);
  } catch (error) {
    return socialError(error);
  }
}
