import type { Prisma } from "@/generated/prisma/client";
export async function setPodcastNotification(tx: Prisma.TransactionClient, userId: string, podcastId: string, enabled: boolean) {
  if (!await tx.podcast.findUnique({ where:{id:podcastId}, select:{id:true} })) return null;
  return tx.podcastNotificationPreference.upsert({ where:{userId_podcastId:{userId,podcastId}}, create:{userId,podcastId,enabled,promptedAt:new Date()}, update:{enabled,promptedAt:new Date()}, select:{enabled:true} });
}
