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
