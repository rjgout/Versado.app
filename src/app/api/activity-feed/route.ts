import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getT } from "@/lib/i18n";
import { translateOr } from "@/lib/i18n/core";
import { selectReactionPreview } from "@/lib/activityReactionPreview";

const PAGE_SIZE = 30;

type PreviewReactionRow = {
  id: string;
  itemId: string;
  userId: string;
  emoji: string;
  createdAt: Date;
  handle: string;
  discriminator: string;
  avatarEmoji: string | null;
};

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const friendships = await prisma.friendship.findMany({
    where: { status: "ACCEPTED", OR: [{ senderId: user.id }, { receiverId: user.id }] },
    select: { senderId: true, receiverId: true },
  });
  const friendIds = friendships.map((friendship) =>
    friendship.senderId === user.id ? friendship.receiverId : friendship.senderId
  );
  const visibleUserIds = [user.id, ...friendIds];
  const t = getT(user.uiLanguage);
  const items = await prisma.activityFeedItem.findMany({
    where: { userId: { in: visibleUserIds } },
    orderBy: { updatedAt: "desc" },
    take: PAGE_SIZE,
    include: {
      user: { select: { id: true, handle: true, discriminator: true, avatarEmoji: true } },
    },
  });

  const itemIds = items.map((item) => item.id);
  const counts = itemIds.length > 0
    ? await prisma.activityFeedReaction.groupBy({ by: ["itemId"], where: { itemId: { in: itemIds } }, _count: { _all: true } })
    : [];
  const myReactions = itemIds.length > 0
    ? await prisma.activityFeedReaction.findMany({ where: { itemId: { in: itemIds }, userId: user.id }, select: { itemId: true, emoji: true } })
    : [];
  const previewRows = itemIds.length > 0
    ? await prisma.$queryRaw<PreviewReactionRow[]>(Prisma.sql`
        WITH ranked AS (
          SELECT
            r."id",
            r."itemId",
            r."userId",
            r."emoji",
            r."createdAt",
            u."handle",
            u."discriminator",
            u."avatarEmoji",
            ROW_NUMBER() OVER (
              PARTITION BY r."itemId"
              ORDER BY
                CASE WHEN ${friendIds.length > 0 ? Prisma.sql`r."userId" IN (${Prisma.join(friendIds)})` : Prisma.sql`FALSE`} THEN 0 ELSE 1 END,
                r."createdAt" ASC,
                r."id" ASC
            ) AS reaction_rank
          FROM "ActivityFeedReaction" r
          JOIN "User" u ON u."id" = r."userId"
          WHERE r."itemId" IN (${Prisma.join(itemIds)})
        )
        SELECT "id", "itemId", "userId", "emoji", "createdAt", "handle", "discriminator", "avatarEmoji"
        FROM ranked
        WHERE reaction_rank <= 5
        ORDER BY "itemId", "createdAt" ASC, "id" ASC
      `)
    : [];
  const previewByItem = new Map<string, PreviewReactionRow[]>();
  const friendIdSet = new Set(friendIds);
  for (const itemId of itemIds) {
    const rows = previewRows.filter((row) => row.itemId === itemId);
    previewByItem.set(itemId, selectReactionPreview(rows, friendIdSet));
  }
  const countByItem = new Map(counts.map((count) => [count.itemId, count._count._all]));
  const myReactionByItem = new Map(myReactions.map((reaction) => [reaction.itemId, reaction.emoji]));

  return NextResponse.json({
    items: items.map((item) => {
      const reactions = previewByItem.get(item.id) ?? [];
      // De teller blijft over alle reacties gaan; de preview zelf bevat bewust
      // hooguit vijf rijen en mag dus geen vertekend aantal tonen.
      const reactionCount = countByItem.get(item.id) ?? 0;
      const myReaction = myReactionByItem.get(item.id) ?? null;
      const reason = item.xpReason
        ? translateOr(t, `xpHistory.reasons.${item.xpReason}`, t("activityFeed.xpFallback"))
        : null;
      const achievementName = item.achievementSlug
        ? translateOr(t, `achievements.${item.achievementSlug}.name`, item.achievementName ?? item.achievementSlug)
        : null;
      return {
        id: item.id,
        kind: item.kind,
        xpAmount: item.xpAmount,
        reason,
        achievementName,
        achievementIcon: item.achievementIcon,
        createdAt: item.updatedAt,
        actor: item.user,
        reactionCount,
        reactions: reactions.map((reaction) => ({
          id: reaction.userId,
          handle: reaction.handle,
          discriminator: reaction.discriminator,
          avatarEmoji: reaction.avatarEmoji,
          emoji: reaction.emoji,
          createdAt: reaction.createdAt,
        })),
        myReaction,
        canReact: item.userId !== user.id,
        text:
          item.kind === "XP"
            ? t("activityFeed.xpText", { amount: item.xpAmount, reason: reason ?? t("activityFeed.xpFallback") })
            : t("activityFeed.achievementText", { achievement: achievementName ?? t("activityFeed.achievementFallback") }),
      };
    }),
  });
}
