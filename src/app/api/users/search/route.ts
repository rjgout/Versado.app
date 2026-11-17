import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { parseTag } from "@/lib/handle";
import { apiError } from "@/lib/apiError";
import { socialBudget } from "@/lib/social/abuseBudgets";

const SELECT = { id: true, handle: true, discriminator: true } as const;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const limited = await socialBudget("userSearch", user.id);
  if (limited) return limited;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  let matches;
  const tag = parseTag(q);
  if (tag) {
    // Exacte tag "Handle#42" — altijd vindbaar, dit is de bedoelde,
    // privacyvriendelijke manier om iemand te zoeken zonder e-mailadres.
    matches = await prisma.user.findMany({
      where: { handle: { equals: tag.handle, mode: "insensitive" }, discriminator: tag.discriminator },
      select: SELECT,
      take: 5,
    });
  } else if (q.includes("@")) {
    // E-mailadres: alleen tonen als de eigenaar dat expliciet heeft aangezet.
    matches = await prisma.user.findMany({
      where: { email: { equals: q.toLowerCase() }, searchableByEmail: true },
      select: SELECT,
      take: 5,
    });
  } else {
    // Losse handle (zonder tag): kan meerdere mensen opleveren, de zoeker
    // kiest de juiste op basis van naam/tag.
    matches = await prisma.user.findMany({
      where: { handle: { contains: q, mode: "insensitive" } },
      select: SELECT,
      take: 10,
    });
  }

  const results = matches.filter((m) => m.id !== user.id);

  const resultsWithStatus = await Promise.all(
    results.map(async (match) => {
      const friendship = await prisma.friendship.findFirst({
        where: {
          OR: [
            { senderId: user.id, receiverId: match.id },
            { senderId: match.id, receiverId: user.id },
          ],
        },
        select: { status: true },
      });

      return {
        ...match,
        friendshipStatus: friendship?.status ?? null,
      };
    }),
  );

  return NextResponse.json({ results: resultsWithStatus });
}
