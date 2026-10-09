export type AvatarAccessoryKind = "background" | "frame" | "decoration" | "lightAccent";
export type AvatarAccessoryId = keyof typeof AVATAR_ACCESSORIES;

export interface AvatarAccessory {
  readonly id: string;
  readonly kind: AvatarAccessoryKind;
  readonly name: string;
  readonly compact: string;
  readonly detail: string;
  readonly achievementSlug: string | null;
}

export const AVATAR_ACCESSORIES = {
  "frame-bronze": { id: "frame-bronze", kind: "frame", name: "Koperen kader", compact: "/scripture/accessories/frames/frame-bronze-256-v1.webp", detail: "/scripture/accessories/frames/frame-bronze-1024-v1.webp", achievementSlug: "first-chapter" },
  "frame-silver": { id: "frame-silver", kind: "frame", name: "Zilveren kader", compact: "/scripture/accessories/frames/frame-silver-256-v1.webp", detail: "/scripture/accessories/frames/frame-silver-1024-v1.webp", achievementSlug: "chapters-10" },
  "frame-gold": { id: "frame-gold", kind: "frame", name: "Gouden kader", compact: "/scripture/accessories/frames/frame-gold-256-v1.webp", detail: "/scripture/accessories/frames/frame-gold-1024-v1.webp", achievementSlug: "perfect-10" },
  "background-stars": { id: "background-stars", kind: "background", name: "Sterrenachtergrond", compact: "/scripture/accessories/backgrounds/background-stars-256-v1.webp", detail: "/scripture/accessories/backgrounds/background-stars-1024-v1.webp", achievementSlug: "streak-7" },
  "overlay-compass": { id: "overlay-compass", kind: "decoration", name: "Kompasdecoratie", compact: "/scripture/accessories/overlays/overlay-compass-256-v1.webp", detail: "/scripture/accessories/overlays/overlay-compass-1024-v1.webp", achievementSlug: "intro-all-lessons" },
  "overlay-light": { id: "overlay-light", kind: "lightAccent", name: "Lichtaccent", compact: "/scripture/accessories/overlays/overlay-light-256-v1.webp", detail: "/scripture/accessories/overlays/overlay-light-1024-v1.webp", achievementSlug: "chapters-25" },
  "overlay-scroll": { id: "overlay-scroll", kind: "decoration", name: "Schriftrol", compact: "/scripture/accessories/overlays/overlay-scroll-256-v1.webp", detail: "/scripture/accessories/overlays/overlay-scroll-1024-v1.webp", achievementSlug: "chapters-5" },
  "overlay-mystery": { id: "overlay-mystery", kind: "decoration", name: "Mysterie-embleem", compact: "/scripture/accessories/overlays/overlay-mystery-256-v1.webp", detail: "/scripture/accessories/overlays/overlay-mystery-1024-v1.webp", achievementSlug: null },
} as const satisfies Record<string, AvatarAccessory>;

const ACCESSORY_BY_SLOT = {
  background: "background-stars",
  frame: "frame",
  decoration: "overlay-compass",
  lightAccent: "overlay-light",
} as const;

export function accessoryFor(id: string | null | undefined): AvatarAccessory | null {
  if (!id || !(id in AVATAR_ACCESSORIES)) return null;
  return AVATAR_ACCESSORIES[id as AvatarAccessoryId];
}

export function accessoryIsValidForSlot(id: string, kind: AvatarAccessoryKind): boolean {
  return accessoryFor(id)?.kind === kind;
}

export function allAvatarAccessories(): readonly AvatarAccessory[] {
  return Object.values(AVATAR_ACCESSORIES);
}

export function defaultAccessoryForSlot(kind: AvatarAccessoryKind): AvatarAccessory | null {
  return accessoryFor(ACCESSORY_BY_SLOT[kind]);
}

export function accessoryUnlocksFor(earnedAchievementSlugs: Iterable<string>): Set<string> {
  const earned = new Set(earnedAchievementSlugs);
  return new Set(allAvatarAccessories().filter((item) => item.achievementSlug && earned.has(item.achievementSlug)).map((item) => item.id));
}

