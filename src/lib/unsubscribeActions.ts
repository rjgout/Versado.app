import { prisma } from "@/lib/db";
import { CATEGORY_FIELD, type NotifyCategory } from "@/lib/notifyCategories";

// De database-kant van uitschrijven. Alleen voor pagina's en routes (nooit uit server.ts' keten).
// Wijzigt precies één bestaand veld:
// - "category": alleen het bijbehorende User.notify*-veld (die schakelaar is kanaalonafhankelijk,
//   dus die categorie stopt daarna ook als push en in het meldingencentrum, zie notifyUser);
// - "all": alleen User.emailNotificationsEnabled; de categorievoorkeuren en push blijven staan.
// updateMany omdat dat idempotent is en niet faalt als het account inmiddels weg is.

export type UnsubscribeAction = "category" | "all";

export interface UnsubscribeState {
  email: string;
  uiLanguage: string;
  categoryEnabled: boolean;
  emailEnabled: boolean;
}

export interface PodcastUnsubscribeState {
  email: string;
  uiLanguage: string;
  podcastName: string;
  enabled: boolean;
  emailEnabled: boolean;
}

export async function getUnsubscribeState(userId: string, category: NotifyCategory): Promise<UnsubscribeState | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, uiLanguage: true, emailNotificationsEnabled: true, notifyDailyReminder: true, notifyDailyText: true, notifySocial: true, notifyActivityReactions: true, notifyAchievements: true, notifyWordGame: true, notifyStreakReturn: true },
  });
  if (!user) return null;
  return { email: user.email, uiLanguage: user.uiLanguage, categoryEnabled: user[CATEGORY_FIELD[category]], emailEnabled: user.emailNotificationsEnabled };
}

export async function applyUnsubscribe(userId: string, category: NotifyCategory, action: UnsubscribeAction): Promise<boolean> {
  const data = action === "all" ? { emailNotificationsEnabled: false } : { [CATEGORY_FIELD[category]]: false };
  const result = await prisma.user.updateMany({ where: { id: userId }, data });
  return result.count > 0;
}

export async function getPodcastUnsubscribeState(userId: string, podcastId: string): Promise<PodcastUnsubscribeState | null> {
  const preference = await prisma.podcastNotificationPreference.findUnique({
    where: { userId_podcastId: { userId, podcastId } },
    select: { enabled: true, podcast: { select: { name: true } }, user: { select: { email: true, uiLanguage: true, emailNotificationsEnabled: true } } },
  });
  if (!preference) return null;
  return {
    email: preference.user.email,
    uiLanguage: preference.user.uiLanguage,
    podcastName: preference.podcast.name,
    enabled: preference.enabled,
    emailEnabled: preference.user.emailNotificationsEnabled,
  };
}

export async function applyPodcastUnsubscribe(userId: string, podcastId: string, action: "podcast" | "all"): Promise<boolean> {
  if (action === "all") return (await prisma.user.updateMany({ where: { id: userId }, data: { emailNotificationsEnabled: false } })).count > 0;
  const result = await prisma.podcastNotificationPreference.updateMany({ where: { userId, podcastId }, data: { enabled: false, promptedAt: new Date() } });
  return result.count > 0;
}
