import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import { SESSION_COOKIE, createSessionToken, hashPassword, sessionCookieOptions, verifyPassword } from "@/lib/auth";
import { generateDiscriminator, HANDLE_REGEX, HANDLE_MIN_LENGTH, HANDLE_MAX_LENGTH, containsForbiddenEmoji, isSingleEmoji } from "@/lib/handle";
import { setIncognito, INCOGNITO_DURATIONS_HOURS } from "@/lib/presence";
import { LANGUAGES, getLanguage } from "@/lib/languages";
import { apiError, apiErrorText } from "@/lib/apiError";
import { leaveAllGroups } from "@/lib/social/groups";
import { isValidTimeZone } from "@/lib/timeZone";
import { PERSONAL_MASCOTS } from "@/lib/mascots";
import { mascotToCompanion } from "@/lib/companion";
import { accessoryFor, accessoryIsValidForSlot } from "@/lib/avatarAccessories";
import { AVATAR_UNLOCK_ACHIEVEMENT_SLUGS, canUseAccessory, canUseAvatarCharacter } from "@/lib/avatarUnlocks";
import { normalizeCharacterId } from "@/lib/characterAssets";
import { ensureAchievementRecords } from "@/lib/achievements";

const patchSchema = z.object({
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

const MAX_DISCRIMINATOR_ATTEMPTS = 25;

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Vul je huidige (of tijdelijke) wachtwoord in."),
  newPassword: z.string().min(8, "Nieuw wachtwoord moet minstens 8 tekens zijn."),
});

// Zelf je wachtwoord wijzigen — ook het verplichte pad na een
// admin-wachtwoordreset (zie /api/admin/users/[userId]/reset-password).
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const body = await req.json().catch(() => null);
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) {
    return await apiErrorText(parsed.error.issues[0].message, 400);
  }

  const valid = await verifyPassword(parsed.data.currentPassword, user.passwordHash);
  if (!valid) {
    return await apiError("apiErrors.currentPasswordWrong", 401);
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  // sessionVersion ophogen logt alle andere apparaten uit (bv. als het oude
  // wachtwoord is uitgelekt). Dit apparaat krijgt direct een nieuw token.
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } },
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions);
  return res;
}

// Privacy-instelling: standaard uit. Alleen als een gebruiker dit zelf
// aanzet, kan zijn/haar exacte e-mailadres gebruikt worden om diegene te
// vinden bij het toevoegen van vrienden (zie /api/users/search).
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return await apiError("apiErrors.invalidInput", 400);
  if (Object.keys(parsed.data).length === 0) {
    return await apiError("apiErrors.nothingToSave", 400);
  }
  const { handle, incognitoHours, companion: companionChoice, avatarCharacterId, avatarBackgroundId, avatarFrameId, avatarDecorationId, avatarLightAccentId, ...fields } = parsed.data;
  const avatarFields = { avatarCharacterId, avatarBackgroundId, avatarFrameId, avatarDecorationId, avatarLightAccentId };
  const hasAvatarChanges = Object.values(avatarFields).some((value) => value !== undefined);
  let canonicalAvatarFields: Partial<typeof avatarFields> = {};
  if (hasAvatarChanges) {
    await prisma.$transaction((tx) => ensureAchievementRecords(tx, user.id, AVATAR_UNLOCK_ACHIEVEMENT_SLUGS));
    const earned = await prisma.userAchievement.findMany({ where: { userId: user.id }, select: { achievement: { select: { slug: true } } } });
    const earnedSlugs = earned.map((row) => row.achievement.slug);
    const normalizedCharacterId = avatarCharacterId === undefined ? undefined : normalizeCharacterId(avatarCharacterId);
    if (avatarCharacterId !== undefined && avatarCharacterId !== null && (!normalizedCharacterId || !canUseAvatarCharacter(normalizedCharacterId, earnedSlugs))) {
      return await apiErrorText("Deze personage-avatar is nog niet vrijgespeeld.", 400);
    }
    const slots = [
      [avatarBackgroundId, "background", "achtergrond"],
      [avatarFrameId, "frame", "kader"],
      [avatarDecorationId, "decoration", "decoratie"],
      [avatarLightAccentId, "lightAccent", "lichtaccent"],
    ] as const;
    for (const [id, kind, label] of slots) {
      if (id === undefined || id === null) continue;
      if (!accessoryFor(id) || !accessoryIsValidForSlot(id, kind) || !canUseAccessory(id, earnedSlugs)) {
        return await apiErrorText(`Dit ${label} is nog niet vrijgespeeld.`, 400);
      }
    }
    canonicalAvatarFields = {
      ...(avatarCharacterId !== undefined ? { avatarCharacterId: avatarCharacterId === null ? null : normalizedCharacterId } : {}),
      ...(avatarBackgroundId !== undefined ? { avatarBackgroundId } : {}),
      ...(avatarFrameId !== undefined ? { avatarFrameId } : {}),
      ...(avatarDecorationId !== undefined ? { avatarDecorationId } : {}),
      ...(avatarLightAccentId !== undefined ? { avatarLightAccentId } : {}),
    };
  }
  const rest = { ...fields, ...canonicalAvatarFields, ...(companionChoice ? { companion: mascotToCompanion(companionChoice) } : {}) };
  // Een taal waarvan de app-teksten nog niet af zijn, alleen voor beheerders
  // (om de vertaling te bekijken).
  if (rest.uiLanguage && !getLanguage(rest.uiLanguage).uiReady && !user.isAdmin) {
    return await apiError("apiErrors.languageUnavailable", 400);
  }

  if (incognitoHours !== undefined) {
    await setIncognito(user.id, incognitoHours);
  }
  // Vrienden live laten meekrijgen van een aanpassing hier gebeurt bewust
  // niet vanuit deze routehandler: dit bestand wordt door Next's eigen
  // bundelaar geladen, wat een ANDERE modulinstantie van gameServer.ts
  // oplevert dan die server.ts via tsx laadt en waar de echte, actieve
  // Socket.io-server op leeft (getIO() zou hier altijd null teruggeven). De
  // client stuurt daarom na een geslaagde patch zelf een klein
  // "presence_settings_changed"-signaal over de al bestaande socketverbinding
  // (zie ProfileClient.tsx), die wél op de juiste instantie draait.

  if (handle === undefined) {
    if (Object.keys(rest).length > 0) {
      await prisma.user.update({ where: { id: user.id }, data: rest });
    }
    return NextResponse.json({ ok: true });
  }

  // De gebruikersnaam (handle) kies je zelf, het nummer erachter
  // (discriminator) nooit — dat blijft altijd door het systeem bepaald,
  // net als bij registreren (zie /api/auth/register). Bij een naamswijziging
  // proberen we eerst je huidige nummer te behouden; alleen als die
  // combinatie toevallig al door iemand anders gebruikt wordt, loot het
  // systeem een nieuw nummer (net zo lang tot er een vrije combinatie is).
  const candidates = [user.discriminator, ...Array.from({ length: MAX_DISCRIMINATOR_ATTEMPTS }, generateDiscriminator)];
  for (const discriminator of candidates) {
    try {
      await prisma.user.update({ where: { id: user.id }, data: { handle, discriminator, ...rest } });
      return NextResponse.json({ ok: true, handle, discriminator });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        continue; // discriminator-botsing voor deze handle, probeer opnieuw
      }
      throw e;
    }
  }

  return await apiError("apiErrors.uniqueHandleFailed", 409);
}

// AVG: een gebruiker moet zijn account (en alle bijbehorende gegevens)
// kunnen verwijderen. Alle relaties naar User staan op onDelete: Cascade
// (of SetNull voor freeze-gift-verwijzingen), dus dit verwijdert ook
// voortgang, XP-historie, vriendschappen, quizresultaten en meer.
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return await apiError("apiErrors.notLoggedIn", 401);

  // Eerst netjes uit elke groep, zodat ledentallen kloppen en een groep
  // zonder beheerder een opvolger krijgt; daarna ruimt de cascade de rest op.
  await leaveAllGroups(user.id);
  await prisma.user.delete({ where: { id: user.id } });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
