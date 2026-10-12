import { GAME_SCOPE_KEYS, supportsGameSource } from "@/lib/gameAvailabilityPolicy";
import { inventoryOriginAllowed } from "@/lib/content-inventory/origin";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

// Welke spellen bij welke content-uitgave horen (GameContentScope): een spel
// staat alleen in /live bij de uitgaven die hier aan staan. Los van het aan-
// of uitzetten van een spel voor de hele app (/api/admin/game-settings).
const schema = z.object({
  gameKey: z.enum(GAME_SCOPE_KEYS),
  contentCollectionId: z.string().min(1),
  enabled: z.boolean(),
}).strict();

async function snapshot() {
  const [collections, scopes] = await Promise.all([
    // Alleen schriftuitgaven: podcasts en het leerplan hebben geen spellen.
    prisma.contentCollection.findMany({
      where: { enabled: true, contentWork: { kind: "SCRIPTURE" } },
      orderBy: { order: "asc" },
      select: { id: true, name: true, icon: true, language: true, work: true, editionKey: true, contentWork: { select: { kind: true } } },
    }),
    prisma.gameContentScope.findMany({ select: { gameKey: true, contentCollectionId: true } }),
  ]);
  return { collections: collections.map(({ contentWork, ...c }) => ({ ...c, supportedGames: GAME_SCOPE_KEYS.filter(game => supportsGameSource(game, { ...c, kind: contentWork?.kind ?? null })) })).filter(c => c.supportedGames.length > 0), scopes };
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
  if (!inventoryOriginAllowed(req.headers, req.url, process.env.APP_URL)) return apiError("apiErrors.forbidden", 403);

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const { gameKey, contentCollectionId, enabled } = parsed.data;
  const collection = await prisma.contentCollection.findUnique({ where: { id: contentCollectionId }, include: { contentWork: true } });
  if (!collection) return await apiError("apiErrors.invalidInput", 400);

  if (enabled && (!collection.enabled || !supportsGameSource(gameKey, { ...collection, kind: collection.contentWork?.kind ?? null }))) return apiError("apiErrors.invalidInput", 400);

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
