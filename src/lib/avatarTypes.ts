export interface AvatarAppearance {
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
