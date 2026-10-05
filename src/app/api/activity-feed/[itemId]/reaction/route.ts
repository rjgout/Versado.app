import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { ACTIVITY_REACTION_BATCH_WINDOW_MS } from "@/lib/activityReactionNotifications";
import { visibleActivityItem } from "@/lib/activityFeedVisibility";

const REACTIONS = ["🫶🏻", "❤️", "🎉", "🔥", "🙌"] as const;
const schema = z.object({ emoji: z.enum(REACTIONS) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  const { itemId } = await params;
  const item = await visibleActivityItem(itemId, user.id);
  if (!item || item.userId === user.id) return await apiError("apiErrors.forbidden", 403);

  const result = await prisma.$transaction(async (tx) => {
    // De itemrij is de kleine kritieke sectie: hierdoor kunnen twee reacties
    // op hetzelfde item niet tegelijk twee open batches aanmaken.
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "ActivityFeedItem" WHERE "id" = ${itemId} FOR UPDATE`;
    if (locked.length === 0) return null;
    const lockedItem = await tx.activityFeedItem.findUnique({
      where: { id: itemId },
      select: { userId: true, user: { select: { notifyActivityReactions: true } } },
    });
    if (!lockedItem || lockedItem.userId !== item.userId) return null;

    const existing = await tx.activityFeedReaction.findUnique({
      where: { itemId_userId: { itemId, userId: user.id } },
      select: { emoji: true },
    });
    if (existing?.emoji === parsed.data.emoji) {
      await tx.activityFeedReaction.delete({ where: { itemId_userId: { itemId, userId: user.id } } });
      return { emoji: null };
    }
    if (existing) {
      const reaction = await tx.activityFeedReaction.update({
        where: { itemId_userId: { itemId, userId: user.id } },
        data: { emoji: parsed.data.emoji },
        select: { emoji: true },
      });
      return { emoji: reaction.emoji };
    }

    let notificationBatchId: string | null = null;
    if (lockedItem.user.notifyActivityReactions) {
      const now = new Date();
      // Een batch hoort bij de ontvanger, niet bij het feed-item. De
      // advisory lock sluit gelijktijdige reacties op verschillende items
      // voor dezelfde ontvanger uit; de unieke index is de databasegarantie.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockedItem.userId}, 0))`;
      const activeBatch = await tx.activityReactionNotificationBatch.findFirst({
        where: { recipientUserId: lockedItem.userId, sentAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      notificationBatchId = activeBatch?.id ?? (
        await tx.activityReactionNotificationBatch.create({
          data: {
            recipientUserId: lockedItem.userId,
            firstReactionAt: now,
            sendAfter: new Date(now.getTime() + ACTIVITY_REACTION_BATCH_WINDOW_MS),
          },
          select: { id: true },
        })
      ).id;
    }
    const reaction = await tx.activityFeedReaction.create({
      data: { itemId, userId: user.id, emoji: parsed.data.emoji, notificationBatchId },
      select: { emoji: true },
    });
    return { emoji: reaction.emoji };
  });
  if (!result) return await apiError("apiErrors.forbidden", 403);
  return NextResponse.json(result);
}
