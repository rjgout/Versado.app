"use client";

import HeaderAvatarView from "./HeaderAvatarView";
import UserAvatar from "@/components/UserAvatar";

// Profiel en instellingen zitten achter de eigen avatar rechtsboven, niet
// meer in de primaire navigatie (zie docs/VERSADO-DESIGN.md).
export default function HeaderAvatar({ id, handle, avatarEmoji, avatarCharacterId, avatarBackgroundId, avatarFrameId, avatarDecorationId, avatarLightAccentId }: {
  id: string;
  handle: string;
  avatarEmoji: string | null;
  avatarCharacterId: string | null;
  avatarBackgroundId: string | null;
  avatarFrameId: string | null;
  avatarDecorationId: string | null;
  avatarLightAccentId: string | null;
}) {
  return <HeaderAvatarView avatar={<UserAvatar id={id} handle={handle} avatarEmoji={avatarEmoji} avatarCharacterId={avatarCharacterId} avatarBackgroundId={avatarBackgroundId} avatarFrameId={avatarFrameId} avatarDecorationId={avatarDecorationId} avatarLightAccentId={avatarLightAccentId} size="sm" />} />;
}
