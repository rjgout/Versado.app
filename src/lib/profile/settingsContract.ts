import { HANDLE_MAX_LENGTH,HANDLE_MIN_LENGTH,HANDLE_REGEX,containsForbiddenEmoji,isSingleEmoji } from "@/lib/handle";
import { LANGUAGES } from "@/lib/languages";
import { PERSONAL_MASCOTS } from "@/lib/mascots";
import { INCOGNITO_DURATIONS_HOURS } from "@/lib/presenceRules";
import { isValidTimeZone } from "@/lib/timeZone";
import { z } from "zod";

export const profilePatchSchema = z.object({
  handle: z
    .string()
    .trim()
    .min(HANDLE_MIN_LENGTH, `Gebruikersnaam moet minstens ${HANDLE_MIN_LENGTH} tekens zijn.`)
    .max(HANDLE_MAX_LENGTH, `Gebruikersnaam mag maximaal ${HANDLE_MAX_LENGTH} tekens zijn.`)
    .regex(HANDLE_REGEX, "Alleen letters, cijfers, spaties, -, _ en emoji toegestaan.")
    .refine((v) => !containsForbiddenEmoji(v), "Deze emoji is niet toegestaan in een gebruikersnaam.")
    .optional(),
  // Eigen emoji voor het avatar-rondje (zie ProfileClient.tsx), los van de
  // gebruikersnaam — null = weer de letter-avatar tonen.
  avatarEmoji: z
    .string()
    .refine((v) => isSingleEmoji(v), "Kies precies één emoji.")
    .refine((v) => !containsForbiddenEmoji(v), "Deze emoji is niet toegestaan.")
    .nullable()
    .optional(),
  avatarCharacterId: z.string().nullable().optional(),
  avatarBackgroundId: z.string().nullable().optional(),
  avatarFrameId: z.string().nullable().optional(),
  avatarDecorationId: z.string().nullable().optional(),
  avatarLightAccentId: z.string().nullable().optional(),
  searchableByEmail: z.boolean().optional(),
  shareAchievements: z.boolean().optional(),
  // Los van shareAchievements: puzzelrecords zichtbaar voor geaccepteerde vrienden (standaard uit).
  sharePuzzleRecords: z.boolean().optional(),
  shareVillageWithFriends: z.boolean().optional(),
  emailNotificationsEnabled: z.boolean().optional(),
  pushNotificationsEnabled: z.boolean().optional(),
  dailyReminderTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ongeldig tijdstip")
    .optional(),
  dailyTextTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ongeldig tijdstip")
    .optional(),
  dailyTextSource: z.string().min(1).max(128).optional(),
  notifyDailyText: z.boolean().optional(),
  notifyDailyReminder: z.boolean().optional(),
  notifyStreakReturn: z.boolean().optional(),
  notifySocial: z.boolean().optional(),
  notifyActivityReactions: z.boolean().optional(),
  notifyAchievements: z.boolean().optional(),
  notifyWordGame: z.boolean().optional(),
  notifyFriendOnline: z.boolean().optional(),
  changelogEnabled: z.boolean().optional(),
  conferenceCountdownEnabled: z.boolean().optional(),
  // Mag Versado Kompas uitleg aanbieden bij een onderdeel dat je voor het eerst opent?
  kompasOffersEnabled: z.boolean().optional(),
  // Seintjes van vrienden (src/lib/social/nudges.ts).
  nudgesEnabled: z.boolean().optional(),
  // Door de browser gedetecteerde IANA-tijdzone (TimeZoneSync.tsx). Alleen
  // namen die Intl kent; een offset als "+01:00" wordt geweigerd.
  timeZone: z.string().refine(isValidTimeZone, "Onbekende tijdzone.").optional(),
  // Taal van de app (menu's, meldingen, e-mails); de taal van de content
  // loopt via /api/content-context, omdat die ook de actieve uitgave wisselt.
  uiLanguage: z.enum(LANGUAGES.map((language) => language.code) as [string, ...string[]]).optional(),
  // Persoonlijke gids (src/lib/companion.ts): alleen novi, varo of vera.
  companion: z.enum(PERSONAL_MASCOTS).optional(),
  // Vrienden-aanwezigheid (zie src/lib/presence.ts).
  shareOnlineStatus: z.boolean().optional(),
  shareCurrentActivity: z.boolean().optional(),
  // Geen kolomnaam maar een actie: getal = incognito voor zoveel uur
  // aanzetten (te beginnen vanaf nu), null = direct weer uitzetten.
  // Serverbepaald vanuit een vaste lijst i.p.v. een los aantal uren of een
  // kant-en-klare vervaltijd van de client aan te nemen.
  incognitoHours: z
    .union([z.literal(INCOGNITO_DURATIONS_HOURS[0]), z.literal(INCOGNITO_DURATIONS_HOURS[1]), z.literal(INCOGNITO_DURATIONS_HOURS[2]), z.literal(INCOGNITO_DURATIONS_HOURS[3])])
    .nullable()
    .optional(),
});

export type ProfileSettingsPatch = z.infer<typeof profilePatchSchema>;
