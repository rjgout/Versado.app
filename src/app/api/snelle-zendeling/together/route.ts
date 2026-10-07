import { NextResponse } from "next/server";
import { customAlphabet } from "nanoid";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { canUseQuickMissionary } from "@/lib/snelleZendeling/access";

const generateCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 5);

// Maakt een lobby voor Samen spelen met Vliegende {gids}: een LiveGame (mode
// QUICK_MISSIONARY) met de maker als host. Uitnodigen en starten gaan daarna via
// de socketserver (src/server/quickMissionary.ts); de run zelf pas bij de start.
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!(await canUseQuickMissionary(user.id, user.isAdmin))) return await apiError("apiErrors.forbidden", 403);

  let code = generateCode();
  for (let attempt = 0; attempt < 5 && (await prisma.liveGame.findUnique({ where: { code }, select: { id: true } })); attempt++) {
    code = generateCode();
  }
  await prisma.liveGame.create({
    data: { code, hostId: user.id, mode: "QUICK_MISSIONARY", status: "LOBBY", players: { create: { userId: user.id } } },
  });
  return NextResponse.json({ code });
}
