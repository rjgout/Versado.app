import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { requestToJoin } from "@/lib/social/joinLinks";
import { socialError } from "@/lib/social/http";
import { prisma } from "@/lib/db";
import { emitToUser } from "@/lib/realtime";

// Toegang vragen via een groepslink. Alleen ingelogd; de link maakt nooit
// zelf lid. Grenzen (dubbel verzoek, wachttijd na weigering, spam per uur)
// in joinLinks.ts.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const { token } = await params;
  try {
    const result = await requestToJoin(user.id, token);
    if (result.groupId) {
      const members = await prisma.groupMembership.findMany({ where: { groupId: result.groupId, leftAt: null }, select: { userId: true } });
      for (const member of members) emitToUser(member.userId, "data_event", { event: "groupsChanged" });
    }
    return NextResponse.json(result);
  } catch (error) {
    return socialError(error);
  }
}
