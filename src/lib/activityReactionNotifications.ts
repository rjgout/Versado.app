import { prisma } from "@/lib/db";
import { notifyActivityReactionBatch } from "@/lib/notify";

export const ACTIVITY_REACTION_BATCH_WINDOW_MS = 15 * 60 * 1000;

type ReactionName = { userId: string; name: string; createdAt: Date };

/** Eén persoon hoort maar één keer in de samengevatte melding te staan. */
export function uniqueReactionNames(reactions: ReactionName[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const reaction of [...reactions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    if (seen.has(reaction.userId)) continue;
    seen.add(reaction.userId);
    names.push(reaction.name);
  }
  return names;
}

async function processBatch(batchId: string, now: Date): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "ActivityReactionNotificationBatch"
      WHERE "id" = ${batchId} AND "sentAt" IS NULL
      FOR UPDATE SKIP LOCKED`;
    if (locked.length === 0) return;

    const batch = await tx.activityReactionNotificationBatch.findUnique({
      where: { id: batchId },
      include: {
        item: { select: { id: true } },
        reactions: {
          orderBy: { createdAt: "asc" },
          select: {
            userId: true,
            createdAt: true,
            user: { select: { handle: true, discriminator: true } },
          },
        },
      },
    });
    if (!batch || batch.sentAt) return;

    const names = uniqueReactionNames(
      batch.reactions.map((reaction) => ({
        userId: reaction.userId,
        name: `${reaction.user.handle}#${reaction.user.discriminator}`,
        createdAt: reaction.createdAt,
      }))
    );

    // De gemarkeerde batch wordt pas na notifyUser afgerond. De rijlock
    // voorkomt dat twee scheduler-instanties dezelfde batch tegelijk claimen.
    if (names.length > 0) {
      await notifyActivityReactionBatch(batch.recipientUserId, names, `/activity#activity-${batch.item.id}`);
    }
    await tx.activityReactionNotificationBatch.update({ where: { id: batch.id }, data: { sentAt: now } });
  }, { timeout: 30_000 });
}

/** Verstuurt vervallen reactie-batches vanuit de bestaande minuut-scheduler. */
export async function runActivityReactionNotificationTick(now = new Date()): Promise<void> {
  const batches = await prisma.activityReactionNotificationBatch.findMany({
    where: { sentAt: null, sendAfter: { lte: now } },
    orderBy: { sendAfter: "asc" },
    take: 100,
    select: { id: true },
  });
  for (const batch of batches) await processBatch(batch.id, now);
}
