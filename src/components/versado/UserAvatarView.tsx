"use client";

import ScriptureAvatar from "@/components/ScriptureAvatar";
import type { AvatarAppearance } from "@/lib/avatarTypes";

const AVATAR_COLORS = ["bg-brand-500", "bg-brand-600", "bg-ice-500", "bg-gold-500"];
function avatarColorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

const SIZES = {
  xs: "w-7 h-7",
  sm: "w-9 h-9",
  md: "w-11 h-11",
} as const;
const TEXT_SIZES = {
  xs: "text-[11px]",
  sm: "text-xs",
  md: "text-sm",
} as const;

/** Uitsluitend de bestaande avatarpresentatie, zonder webfetch of cache. */
export default function UserAvatarView({ id, handle, appearance, size = "sm", className = "" }: { id: string; handle: string; appearance: AvatarAppearance; size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${SIZES[size]} ${appearance.avatarCharacterId ? "" : `${TEXT_SIZES[size]} ${avatarColorFor(id)} text-white`} font-extrabold leading-none ${className}`}
      aria-hidden
    >
      <ScriptureAvatar appearance={appearance} handle={handle} className={`block h-full w-full shrink-0 ${appearance.avatarCharacterId ? "" : TEXT_SIZES[size]}`} />
    </span>
  );
}
