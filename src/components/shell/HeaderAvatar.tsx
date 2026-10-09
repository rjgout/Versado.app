"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import UserAvatar from "@/components/UserAvatar";
import { useT } from "@/components/I18nProvider";

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
  const t = useT();
  const active = usePathname()?.startsWith("/profile");
  return (
    <Link
      href="/profile"
      data-kompas-target="profile"
      aria-label={t("nav.profile")}
      aria-current={active ? "page" : undefined}
      className={`vs-motion flex h-10 w-10 items-center justify-center rounded-full transition ring-offset-2 ring-offset-vs-elevated hover:ring-2 hover:ring-vs-line-strong ${
        active ? "ring-2 ring-vs-accent" : ""
      }`}
    >
      <UserAvatar id={id} handle={handle} avatarEmoji={avatarEmoji} avatarCharacterId={avatarCharacterId} avatarBackgroundId={avatarBackgroundId} avatarFrameId={avatarFrameId} avatarDecorationId={avatarDecorationId} avatarLightAccentId={avatarLightAccentId} size="sm" />
    </Link>
  );
}
