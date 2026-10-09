import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

const MAX_IDS = 100;

// Avatarweergaven voor ids die de aanroeper al kent (uit een klassement, spel
// of vriendenlijst). Geen naam, profieldata of unlockinformatie lekt mee.
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const ids = [...new Set((req.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean))].slice(0, MAX_IDS);
  if (ids.length === 0) return NextResponse.json({ avatars: {} });
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      avatarEmoji: true,
      avatarCharacterId: true,
      avatarBackgroundId: true,
      avatarFrameId: true,
      avatarDecorationId: true,
      avatarLightAccentId: true,
    },
  });
  return NextResponse.json(
    {
      avatars: Object.fromEntries(users.map((u) => [u.id, {
        avatarEmoji: u.avatarEmoji,
        avatarCharacterId: u.avatarCharacterId,
        avatarBackgroundId: u.avatarBackgroundId,
        avatarFrameId: u.avatarFrameId,
        avatarDecorationId: u.avatarDecorationId,
        avatarLightAccentId: u.avatarLightAccentId,
      }])),
    },
    { headers: { "Cache-Control": "private, max-age=60" } }
  );
}
