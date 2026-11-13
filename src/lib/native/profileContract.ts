import type { ProfileData } from "@/components/profile/profileData";
import { twoFactorResult } from "@/lib/account/twoFactorContract";
import { TIER_ORDER } from "@/lib/leagueTiers";
import { PERSONAL_MASCOTS } from "@/lib/mascots";
import { profilePatchSchema } from "@/lib/profile/settingsContract";
import { z } from "zod";
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const tier = z.enum(TIER_ORDER);
export const nativeProfileDataSchema: z.ZodType<ProfileData> = z.object({
  id: z.string().max(1024),
  displayName: z.string().max(1024),
  handle: z.string().max(1024),
  discriminator: z.string().max(1024),
  email: z.string().max(1024),
  dailyReminderTime: z.string().max(1024),
  dailyTextTime: z.string().max(1024),
  dailyTextSource: z.string().max(1024),
  uiLanguage: z.string().max(1024),
  avatarEmoji: z.string().max(256).nullable(),
  avatarCharacterId: z.string().max(256).nullable(),
  avatarBackgroundId: z.string().max(256).nullable(),
  avatarFrameId: z.string().max(256).nullable(),
  avatarDecorationId: z.string().max(256).nullable(),
  avatarLightAccentId: z.string().max(256).nullable(),
  timeZone: z.string().max(256).nullable(),
  isAdmin: z.boolean(),
  searchableByEmail: z.boolean(),
  shareAchievements: z.boolean(),
  sharePuzzleRecords: z.boolean(),
  shareVillageWithFriends: z.boolean(),
  shareOnlineStatus: z.boolean(),
  shareCurrentActivity: z.boolean(),
  incognitoActive: z.boolean(),
  emailNotificationsEnabled: z.boolean(),
  pushNotificationsEnabled: z.boolean(),
  notifyDailyText: z.boolean(),
  notifyDailyReminder: z.boolean(),
  notifyStreakReturn: z.boolean(),
  notifySocial: z.boolean(),
  notifyActivityReactions: z.boolean(),
  notifyAchievements: z.boolean(),
  notifyWordGame: z.boolean(),
  notifyFriendOnline: z.boolean(),
  changelogEnabled: z.boolean(),
  conferenceCountdownEnabled: z.boolean(),
  kompasOffersEnabled: z.boolean(),
  nudgesEnabled: z.boolean(),
  totpEnabled: z.boolean(),
  xpTotal: z.number().int(),
  currentStreak: z.number().int(),
  longestStreak: z.number().int(),
  freezeCount: z.number().int(),
  chaptersCompleted: z.number().int(),
  chaptersStarted: z.number().int(),
  duelsPlayed: z.number().int(),
  duelsWon: z.number().int(),
  lifetimePromotions: z.number().int(),
  lifetimeDemotions: z.number().int(),
  competitionsWon: z.number().int(),
  seasonCount: z.number().int(),
  companion: z.enum(PERSONAL_MASCOTS),
  tier: tier.nullable(), bestTierEver: tier.nullable(), groupPosition: z.number().int().nullable(), bestNationalRank: z.number().int().nullable(),
  medals: z.object({ gold:z.number().int(), silver:z.number().int(), bronze:z.number().int() }).strict(),
  dailyTextSources: z.array(z.object({ value:z.string().max(128), label:z.string().max(1024) }).strict()).max(1000),
  seasons: z.array(z.object({ seasonIndex:z.number().int(), highestTier:tier, finalTier:tier, finalGroupPosition:z.number().int().nullable() }).strict()).max(1000),
  achievements: z.array(z.object({ id, slug:id, name:z.string().max(1024), description:z.string().max(8000), icon:z.string().max(1024), earnedAt:z.iso.datetime().nullable() }).strict()).max(5000),
  featuredAchievementIds: z.array(id).max(5),
  podcastNotifications: z.array(z.object({ podcastId:id, podcastName:z.string().max(1024), enabled:z.boolean() }).strict()).max(1000),
}).strict();
export const nativeProfileSchema = z.object({ version:z.literal(1), userId:id, profile:nativeProfileDataSchema, contentLanguage:z.string().max(16), contentLanguages:z.array(z.string().max(16)).max(20), changelog:z.array(z.object({id:z.string().max(128),title:z.string().max(1024),body:z.string().max(32000),createdAt:z.iso.datetime()}).strict()).max(10000) }).strict().refine(value => value.userId === value.profile.id);
export const nativeProfileAction = z.discriminatedUnion("kind", [
  z.object({ kind:z.literal("settings"), patch:profilePatchSchema.strict().refine(value => Object.keys(value).length > 0) }).strict(),
  z.object({ kind:z.literal("featured-achievements"), achievementIds:z.array(id).max(5).refine(ids => new Set(ids).size === ids.length) }).strict(),
  z.object({ kind:z.literal("reading-reset") }).strict(),
  z.object({ kind:z.literal("logout-all") }).strict(),
  z.object({ kind:z.literal("changelog-seen") }).strict(),
  z.object({ kind:z.literal("podcast-notification"), podcastId:id, enabled:z.boolean() }).strict(),
]);
export const nativeProfileActionResult = z.object({ version:z.literal(1), userId:id, ok:z.literal(true) }).strict();
export type NativeProfile = z.infer<typeof nativeProfileSchema>;
export type NativeProfileAction = z.infer<typeof nativeProfileAction>;
export type NativeProfileMutation = Exclude<NativeProfileAction, { kind:"logout-all" }>;

export const nativeProfileTwoFactorResult = z.object({version:z.literal(1),userId:id,result:twoFactorResult}).strict();
