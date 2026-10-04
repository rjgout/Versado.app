import type { LeagueTier } from "@/generated/prisma/client";
import type { PersonalMascotCharacter } from "@/lib/mascots";

// Wat /api/profile teruggeeft (src/app/api/profile/route.ts), gedeeld door
// het profieloverzicht en de onderdelen.

export interface AchievementView {
  slug: string;
  name: string;
  description: string;
  icon: string;
  earnedAt: string | null;
}

export interface ProfileData {
  displayName: string;
  isAdmin: boolean;
  handle: string;
  discriminator: string;
  avatarEmoji: string | null;
  email: string;
  searchableByEmail: boolean;
  shareOnlineStatus: boolean;
  shareCurrentActivity: boolean;
  incognitoActive: boolean;
  emailNotificationsEnabled: boolean;
  pushNotificationsEnabled: boolean;
  dailyReminderTime: string;
  dailyTextTime: string;
  notifyDailyText: boolean;
  notifyDailyReminder: boolean;
  notifyStreakReturn: boolean;
  notifySocial: boolean;
  notifyActivityReactions: boolean;
  notifyAchievements: boolean;
  notifyWordGame: boolean;
  notifyFriendOnline: boolean;
  changelogEnabled: boolean;
  conferenceCountdownEnabled: boolean;
  nudgesEnabled: boolean;
  timeZone: string | null;
  uiLanguage: string;
  companion: PersonalMascotCharacter;
  totpEnabled: boolean;
  xpTotal: number;
  currentStreak: number;
  longestStreak: number;
  freezeCount: number;
  chaptersCompleted: number;
  chaptersStarted: number;
  duelsPlayed: number;
  duelsWon: number;
  tier: LeagueTier | null;
  groupPosition: number | null;
  medals: { gold: number; silver: number; bronze: number };
  bestTierEver: LeagueTier | null;
  lifetimePromotions: number;
  lifetimeDemotions: number;
  competitionsWon: number;
  seasonCount: number;
  bestNationalRank: number | null;
  seasons: { seasonIndex: number; highestTier: LeagueTier; finalTier: LeagueTier; finalGroupPosition: number | null }[];
  achievements: AchievementView[];
}

/** Instellingen die als losse aan/uit-waarde via PATCH /api/account gaan. */
export type ProfileToggleField =
  | "notifyDailyReminder"
  | "notifyStreakReturn"
  | "notifyActivityReactions"
  | "notifyDailyText"
  | "notifySocial"
  | "notifyAchievements"
  | "notifyWordGame"
  | "notifyFriendOnline"
  | "changelogEnabled"
  | "conferenceCountdownEnabled"
  | "nudgesEnabled";
