import { gameStartGuard } from "@/lib/gameStartGuard";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";

// Seizoenen van De Slimste Heilige waar je host, vervangende host of lid van bent.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const seasons = await prisma.alleskennerSeason.findMany({
    where: { OR: [{ hostId: user.id }, { deputyHostId: user.id }, { members: { some: { userId: user.id } } }] },
    orderBy: { createdAt: "desc" },
    include: {
      host: { select: { handle: true } },
      champion: { select: { handle: true } },
      _count: { select: { members: true, evenings: { where: { status: "DONE" } } } },
    },
  });
  return NextResponse.json({
    seasons: seasons.map((s) => ({
      id: s.id,
      name: s.name,
      status: s.status,
      host: s.host.handle,
      champion: s.champion?.handle ?? null,
      members: s._count.members,
      evenings: s._count.evenings,
    })),
  });
}

const createSchema = z.object({ name: z.string().trim().min(1).max(60), joinAsPlayer: z.boolean() }).strict();

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const denied = await gameStartGuard(req, user.id, "alleskenner");
  if (denied) return denied;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.seasonNameRequired", 400);

  const season = await prisma.alleskennerSeason.create({
    data: {
      name: parsed.data.name,
      hostId: user.id,
      members: parsed.data.joinAsPlayer ? { create: { userId: user.id, queuePosition: 0 } } : undefined,
    },
  });
  return NextResponse.json({ id: season.id });
}
