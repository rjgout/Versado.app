import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { visibleActivityItem } from "@/lib/activityFeedVisibility";

const PAGE_SIZE = 50;

function parseCursor(raw: string | null): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  const separator = raw.indexOf("|");
  if (separator <= 0) return null;
  const createdAt = new Date(raw.slice(0, separator));
  const id = raw.slice(separator + 1);
  return !Number.isNaN(createdAt.getTime()) && id.length > 0 ? { createdAt, id } : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const { itemId } = await params;
  if (!await visibleActivityItem(itemId, user.id)) return await apiError("apiErrors.forbidden", 403);

  const cursor = parseCursor(req.nextUrl.searchParams.get("cursor"));
  if (req.nextUrl.searchParams.has("cursor") && !cursor) return await apiError("apiErrors.invalidInput", 400);
  const reactions = await prisma.activityFeedReaction.findMany({
    where: {
      itemId,
      ...(cursor ? { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      emoji: true,
      createdAt: true,
      user: { select: { id: true, handle: true, discriminator: true, avatarEmoji: true } },
    },
  });
  const hasMore = reactions.length > PAGE_SIZE;
  const page = hasMore ? reactions.slice(0, PAGE_SIZE) : reactions;
  const last = page.at(-1);
  return NextResponse.json({
    reactions: page.map((reaction) => ({
      id: reaction.user.id,
      handle: reaction.user.handle,
      discriminator: reaction.user.discriminator,
      avatarEmoji: reaction.user.avatarEmoji,
      emoji: reaction.emoji,
      createdAt: reaction.createdAt,
    })),
    nextCursor: hasMore && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
