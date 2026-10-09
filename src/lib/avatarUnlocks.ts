import { avatarCharacterAssets, getCharacterAsset, type CanonicalCharacterId } from "@/lib/characterAssets";
import { accessoryUnlocksFor, allAvatarAccessories, type AvatarAccessory } from "@/lib/avatarAccessories";

/** Bestaande prestaties zijn de duurzame unlockregistratie: UserAchievement
 * blijft staan bij een verbroken reeks, degradatie of een latere herberekening. */
export const CHARACTER_UNLOCK_ACHIEVEMENTS: Readonly<Record<string, string | null>> = Object.fromEntries(
  avatarCharacterAssets().map((character) => [
    character.id,
    character.availability === "A" ? null : character.availability === "B" ? "first-chapter" : "chapters-5",
  ])
);

export interface AvatarOption {
  id: CanonicalCharacterId;
  name: string;
  gender: "male" | "female" | "unknown";
  avatar: string;
  available: boolean;
  unlockAchievementSlug: string | null;
}

export function hasAchievement(earnedAchievementSlugs: Iterable<string>, slug: string | null): boolean {
  return slug === null || new Set(earnedAchievementSlugs).has(slug);
}

export function characterUnlockAchievement(id: string): string | null {
  return CHARACTER_UNLOCK_ACHIEVEMENTS[id] ?? null;
}

export function canUseAvatarCharacter(id: string | null | undefined, earnedAchievementSlugs: Iterable<string>): boolean {
  const character = getCharacterAsset(id);
  if (!character?.avatarAllowed) return false;
  return hasAchievement(earnedAchievementSlugs, CHARACTER_UNLOCK_ACHIEVEMENTS[character.id] ?? null);
}

export function avatarOptions(earnedAchievementSlugs: Iterable<string>): AvatarOption[] {
  const earned = new Set(earnedAchievementSlugs);
  return avatarCharacterAssets().map((character) => {
    const unlockAchievementSlug = CHARACTER_UNLOCK_ACHIEVEMENTS[character.id] ?? null;
    return {
      id: character.id as CanonicalCharacterId,
      name: character.name,
      gender: character.gender,
      avatar: character.avatar,
      available: unlockAchievementSlug === null || earned.has(unlockAchievementSlug),
      unlockAchievementSlug,
    };
  });
}

export function canUseAccessory(id: string | null | undefined, earnedAchievementSlugs: Iterable<string>): boolean {
  const accessory = allAvatarAccessories().find((item) => item.id === id);
  return !!accessory?.achievementSlug && hasAchievement(earnedAchievementSlugs, accessory.achievementSlug);
}

export function unlockedAccessories(earnedAchievementSlugs: Iterable<string>): Set<string> {
  return accessoryUnlocksFor(earnedAchievementSlugs);
}

export function accessoryOptions(earnedAchievementSlugs: Iterable<string>): Array<AvatarAccessory & { available: boolean }> {
  const earned = new Set(earnedAchievementSlugs);
  return allAvatarAccessories().map((accessory) => ({
    ...accessory,
    available: !!accessory.achievementSlug && earned.has(accessory.achievementSlug),
  }));
}
