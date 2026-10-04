import { prisma } from "@/lib/db";

/** Dezelfde feed-zichtbaarheid voor lezen en reageren; reacties verruimen die niet. */
export async function visibleActivityItem(itemId: string, userId: string): Promise<{ userId: string } | null> {
  const item = await prisma.activityFeedItem.findUnique({ where: { id: itemId }, select: { userId: true } });
  if (!item) return null;
  if (item.userId === userId) return item;
  const friendship = await prisma.friendship.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [
        { senderId: userId, receiverId: item.userId },
        { senderId: item.userId, receiverId: userId },
      ],
    },
    select: { id: true },
  });
  return friendship ? item : null;
}
