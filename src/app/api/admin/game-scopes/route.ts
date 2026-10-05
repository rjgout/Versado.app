import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

// Welke spellen bij welke content-uitgave horen (GameContentScope): een spel
// staat alleen in /live bij de uitgaven die hier aan staan. Los van het aan-
// of uitzetten van een spel voor de hele app (/api/admin/game-settings).
const SCRIPTURE_WORKS = ["bofm", "dc-testament", "pgp"];
const GAME_KEYS = ["word-game", "scrabble", "gezinsavond", "chapter-guess", "challenges", "live-exercises", "alleskenner", "jigsaw", "quick-missionary", "mystery"] as const;

const schema = z.object({
  gameKey: z.enum(GAME_KEYS),
  contentCollectionId: z.string().min(1),
  enabled: z.boolean(),
});

async function snapshot() {
  const [collections, scopes] = await Promise.all([
    // Alleen schriftuitgaven: podcasts en het leerplan hebben geen spellen.
    prisma.contentCollection.findMany({
      where: { enabled: true, work: { in: SCRIPTURE_WORKS } },
      orderBy: { order: "asc" },
      select: { id: true, name: true, icon: true, language: true },
    }),
    prisma.gameContentScope.findMany({ select: { gameKey: true, contentCollectionId: true } }),
  ]);
  return { collections, scopes };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);
  return NextResponse.json(await snapshot());
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  if (!user.isAdmin) return await apiError("apiErrors.forbidden", 403);

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const { gameKey, contentCollectionId, enabled } = parsed.data;
  const collection = await prisma.contentCollection.findUnique({ where: { id: contentCollectionId }, select: { id: true } });
  if (!collection) return await apiError("apiErrors.invalidInput", 400);

  if (enabled) {
    await prisma.gameContentScope.upsert({
      where: { gameKey_contentCollectionId: { gameKey, contentCollectionId } },
      create: { gameKey, contentCollectionId },
      update: {},
    });
  } else {
    await prisma.gameContentScope.deleteMany({ where: { gameKey, contentCollectionId } });
  }
  return NextResponse.json(await snapshot());
}
