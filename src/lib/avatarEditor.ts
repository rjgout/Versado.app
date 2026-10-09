import type { AvatarOption } from "@/lib/avatarUnlocks";
import type { AvatarAppearance } from "@/lib/avatarTypes";

export type AvatarCharacterFilter = "all" | "available" | "locked" | "male" | "female";

const AVATAR_APPEARANCE_FIELDS = [
  "avatarEmoji",
  "avatarCharacterId",
  "avatarBackgroundId",
  "avatarFrameId",
  "avatarDecorationId",
  "avatarLightAccentId",
] as const satisfies ReadonlyArray<keyof AvatarAppearance>;

/**
 * De editor sorteert alleen op beschikbaarheid; de catalogusvolgorde blijft
 * de stabiele volgorde binnen beide groepen, zodat filteren niet telkens een
 * visueel bewegend raster oplevert.
 */
export function filterAvatarOptions(
  options: readonly AvatarOption[],
  query: string,
  filter: AvatarCharacterFilter,
): AvatarOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("nl-NL");
  return options
    .filter((option) => {
      if (normalizedQuery && !option.name.toLocaleLowerCase("nl-NL").includes(normalizedQuery)) return false;
      if (filter === "available") return option.available;
      if (filter === "locked") return !option.available;
      if (filter === "male" || filter === "female") return option.gender === filter;
      return true;
    })
    .sort((left, right) => Number(right.available) - Number(left.available));
}

export function avatarAppearancesEqual(left: AvatarAppearance, right: AvatarAppearance): boolean {
  return AVATAR_APPEARANCE_FIELDS.every((field) => left[field] === right[field]);
}

/** Alleen gewijzigde velden gaan naar de bestaande account-API. */
export function avatarAppearancePatch(
  saved: AvatarAppearance,
  draft: AvatarAppearance,
): Partial<AvatarAppearance> {
  const patch: Partial<AvatarAppearance> = {};
  for (const field of AVATAR_APPEARANCE_FIELDS) {
    if (saved[field] !== draft[field]) patch[field] = draft[field];
  }
  return patch;
}
