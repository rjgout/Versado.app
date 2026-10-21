import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { deleteUserAccount } from "@/lib/accountDeletion";
import { disconnectUserSockets } from "@/lib/realtime";

const schema = z.object({ isAdmin: z.boolean() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);

  const { userId } = await params;
  // Voorkomt dat een admin zichzelf per ongeluk buitensluit — adminrechten
  // afpakken moet altijd door een ándere admin gebeuren.
  if (userId === user.id) {
    return await apiError("apiErrors.ownAdminRights", 400);
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return await apiError("apiErrors.invalidInput", 400);
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return await apiError("apiErrors.userNotFound", 404);

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { isAdmin: parsed.data.isAdmin, sessionVersion: { increment: 1 } },
    select: { id: true, isAdmin: true },
  });

  disconnectUserSockets(userId);

  return NextResponse.json(updated);
}

// Alle relaties naar User staan op onDelete: Cascade (of SetNull voor
// freeze-gift-verwijzingen) — zie ook DELETE /api/account, waar een
// gebruiker zichzelf op dezelfde manier verwijdert. Dit verwijdert dus ook
// voortgang, XP-historie, vriendschappen, spellen en meer van de gekozen
// gebruiker.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);

  const { userId } = await params;
  if (userId === user.id) {
    return await apiError("apiErrors.cantDeleteSelf", 400);
  }

  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) return await apiError("apiErrors.userNotFound", 404);

  await deleteUserAccount(userId);

  return NextResponse.json({ ok: true });
}
