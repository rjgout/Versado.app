// Groepen in het meldingencentrum (zie NotificationCenter.tsx). Puur data,
// veilig voor zowel server (notify.ts) als client. Volgorde = volgorde van de
// groepen als ze even nieuw zijn. De naam staat in de vertalingen
// (notifications.groups.*).
import type { MessageKey } from "@/lib/i18n/core";

export const NOTIFICATION_GROUPS = {
  games: { labelKey: "notifications.groups.games", icon: "🎮" },
  wordgame: { labelKey: "notifications.groups.wordgame", icon: "🔤" },
  challenges: { labelKey: "notifications.groups.challenges", icon: "⚔️" },
  friends: { labelKey: "notifications.groups.friends", icon: "👥" },
  groups: { labelKey: "together.notificationGroup", icon: "🤝" },
  achievements: { labelKey: "notifications.groups.achievements", icon: "🏅" },
  competition: { labelKey: "notifications.groups.competition", icon: "🏆" },
  podcasts: { labelKey: "notifications.groups.podcasts", icon: "🎙️" },
} as const satisfies Record<string, { labelKey: MessageKey; icon: string }>;

export type NotificationKind = keyof typeof NOTIFICATION_GROUPS;

export function notificationGroup(kind: string): { labelKey: MessageKey; icon: string } {
  return NOTIFICATION_GROUPS[kind as NotificationKind] ?? { labelKey: "notifications.groups.other", icon: "🔔" };
}
