import { Prisma } from "@/generated/prisma/client";
import { commitAccountMutation,type AccountActor } from "@/lib/account/mutation";
import { ensureAchievementRecords } from "@/lib/achievements";
import { accessoryFor,accessoryIsValidForSlot } from "@/lib/avatarAccessories";
import { AVATAR_UNLOCK_ACHIEVEMENT_SLUGS,canUseAccessory,canUseAvatarCharacter } from "@/lib/avatarUnlocks";
import { normalizeCharacterId } from "@/lib/characterAssets";
import { mascotToCompanion } from "@/lib/companion";
import { dailyTextSourceOptions } from "@/lib/dailyText";
import { notifyVillagePrivacyChanged } from "@/lib/dorp/notifications";
import { generateDiscriminator } from "@/lib/handle";
import type { MessageKey } from "@/lib/i18n/core";
import { getLanguage } from "@/lib/languages";
import { setIncognito } from "@/lib/presence";
import type { ProfileSettingsPatch } from "./settingsContract";

export class ProfileSettingsError extends Error {
  constructor(readonly key: MessageKey, readonly status: number, readonly text?: string) { super(key); }
}
const MAX_DISCRIMINATOR_ATTEMPTS = 25;

/** De bestaande webregels, met dezelfde korte commitgrens als overige persoonlijke native mutaties. */
export async function patchProfileSettings(actor: AccountActor, input: ProfileSettingsPatch) {
  const result = await commitAccountMutation(actor, [], async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (Object.keys(input).length === 0) {
    throw new ProfileSettingsError("apiErrors.nothingToSave", 400);
  }
  if (input.dailyTextSource !== undefined) {
    const sources = await dailyTextSourceOptions(user, user.contentLanguage);
    if (!sources.some(source => source.value === input.dailyTextSource)) throw new ProfileSettingsError("apiErrors.invalidInput", 400);
  }
  const { handle, incognitoHours, companion: companionChoice, avatarCharacterId, avatarBackgroundId, avatarFrameId, avatarDecorationId, avatarLightAccentId, ...fields } = input;
  const avatarFields = { avatarCharacterId, avatarBackgroundId, avatarFrameId, avatarDecorationId, avatarLightAccentId };
  const hasAvatarChanges = Object.values(avatarFields).some((value) => value !== undefined);
  let canonicalAvatarFields: Partial<typeof avatarFields> = {};
  if (hasAvatarChanges) {
    await ensureAchievementRecords(tx, user.id, AVATAR_UNLOCK_ACHIEVEMENT_SLUGS);
    const earned = await tx.userAchievement.findMany({ where: { userId: user.id }, select: { achievement: { select: { slug: true } } } });
    const earnedSlugs = earned.map((row) => row.achievement.slug);
    const normalizedCharacterId = avatarCharacterId === undefined ? undefined : normalizeCharacterId(avatarCharacterId);
    if (avatarCharacterId !== undefined && avatarCharacterId !== null && (!normalizedCharacterId || !canUseAvatarCharacter(normalizedCharacterId, earnedSlugs))) {
      throw new ProfileSettingsError("apiErrors.invalidInput", 400, "Deze personage-avatar is nog niet vrijgespeeld.");
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
        throw new ProfileSettingsError("apiErrors.invalidInput", 400, `Dit ${label} is nog niet vrijgespeeld.`);
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
    throw new ProfileSettingsError("apiErrors.languageUnavailable", 400);
  }

  if (incognitoHours !== undefined) {
    await setIncognito(user.id, incognitoHours, tx);
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
      await tx.user.update({ where: { id: user.id }, data: rest });
    }
    return { ok: true as const };
  }

  // De gebruikersnaam (handle) kies je zelf, het nummer erachter
  // (discriminator) nooit — dat blijft altijd door het systeem bepaald,
  // net als bij registreren (zie /api/auth/register). Bij een naamswijziging
  // proberen we eerst je huidige nummer te behouden; alleen als die
  // combinatie toevallig al door iemand anders gebruikt wordt, loot het
  // systeem een nieuw nummer (net zo lang tot er een vrije combinatie is).
  const candidates = [user.discriminator, ...Array.from({ length: MAX_DISCRIMINATOR_ATTEMPTS }, generateDiscriminator)];
  for (const discriminator of candidates) {
    await tx.$executeRaw`SAVEPOINT profile_handle_candidate`;
    try {
      await tx.user.update({ where: { id: user.id }, data: { handle, discriminator, ...rest } });
      return { ok: true as const, handle, discriminator };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT profile_handle_candidate`;
        continue; // discriminator-botsing voor deze handle, probeer opnieuw
      }
      throw e;
    }
  }

  throw new ProfileSettingsError("apiErrors.uniqueHandleFailed", 409);
  });
  if (input.shareVillageWithFriends !== undefined) await notifyVillagePrivacyChanged(actor.userId);
  return result;
}
