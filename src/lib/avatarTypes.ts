export interface AvatarAppearance {
  /** Legacy opslagveld; gebruikersavatars worden niet meer als emoji gerenderd. */
  avatarEmoji: string | null;
  avatarCharacterId: string | null;
  avatarBackgroundId: string | null;
  avatarFrameId: string | null;
  avatarDecorationId: string | null;
  avatarLightAccentId: string | null;
}

export const EMPTY_AVATAR_APPEARANCE: AvatarAppearance = {
  avatarEmoji: null,
  avatarCharacterId: null,
  avatarBackgroundId: null,
  avatarFrameId: null,
  avatarDecorationId: null,
  avatarLightAccentId: null,
};

/**
 * Tijdelijke renderfallback voor accounts die nog geen personage hebben. We
 * gebruiken alleen letters/cijfers uit de naam, zodat een oude emoji-keuze
 * nooit opnieuw als gebruikersavatar zichtbaar wordt.
 */
export function avatarFallbackText(handle: string): string {
  const characters = Array.from(handle.trim()).filter((character) => /[\p{L}\p{N}]/u.test(character));
  return characters.slice(0, 2).join("").toUpperCase() || "?";
}
