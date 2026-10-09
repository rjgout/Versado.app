import type { MessageKey } from "@/lib/i18n";

// Eén plek voor de notificatiecategorieën: de dispatcher (notify.ts) en de
// uitschrijfflow uit e-mails (unsubscribeActions.ts) gebruiken dezelfde mapping naar de
// bestaande User.notify*-velden, zodat er geen tweede voorkeurensysteem ontstaat.
// Geen imports van next/headers of de database: deze module zit in de eager-keten van server.ts.
export const NOTIFY_CATEGORIES = ["dailyReminder", "dailyText", "social", "activityReactions", "achievements", "wordGame", "streakReturn"] as const;

export type NotifyCategory = (typeof NOTIFY_CATEGORIES)[number];

export type NotifyCategoryField = "notifyDailyReminder" | "notifyDailyText" | "notifySocial" | "notifyActivityReactions" | "notifyAchievements" | "notifyWordGame" | "notifyStreakReturn";

export const CATEGORY_FIELD: Record<NotifyCategory, NotifyCategoryField> = {
  streakReturn: "notifyStreakReturn",
  dailyReminder: "notifyDailyReminder",
  dailyText: "notifyDailyText",
  social: "notifySocial",
  activityReactions: "notifyActivityReactions",
  achievements: "notifyAchievements",
  wordGame: "notifyWordGame",
};

/** De naam van de categorie zoals die in Profiel → Notificaties heet (bestaande vertalingen). */
export const CATEGORY_LABEL_KEY: Record<NotifyCategory, MessageKey> = {
  dailyReminder: "profile.reminderLabel",
  dailyText: "profile.dailyText",
  social: "profile.socialLabel",
  activityReactions: "profile.activityReactionsLabel",
  achievements: "profile.achievementsLabel",
  wordGame: "profile.wordGameLabel",
  streakReturn: "streakReturn.setting",
};

export function isNotifyCategory(value: unknown): value is NotifyCategory {
  return typeof value === "string" && (NOTIFY_CATEGORIES as readonly string[]).includes(value);
}
