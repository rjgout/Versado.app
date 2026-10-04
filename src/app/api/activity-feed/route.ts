import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { apiError } from "@/lib/apiError";
import { getT } from "@/lib/i18n";
import { translateOr } from "@/lib/i18n/core";

const PAGE_SIZE = 30;

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
      reactions: {
        orderBy: { createdAt: "asc" },
        select: {
          userId: true,
          emoji: true,
          createdAt: true,
          user: { select: { id: true, handle: true, discriminator: true, avatarEmoji: true } },
        },
      },
    },
  });

  return NextResponse.json({
    items: items.map((item) => {
      const reactionCounts: Record<string, number> = {};
      for (const reaction of item.reactions) reactionCounts[reaction.emoji] = (reactionCounts[reaction.emoji] ?? 0) + 1;
      const myReaction = item.reactions.find((reaction) => reaction.userId === user.id)?.emoji ?? null;
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
        reactionCounts,
        reactions: item.reactions.map((reaction) => ({
          id: reaction.user.id,
          handle: reaction.user.handle,
          discriminator: reaction.user.discriminator,
          avatarEmoji: reaction.user.avatarEmoji,
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
