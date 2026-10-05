import type { PersonalMascotCharacter } from "@/lib/mascots";

export type QuickMissionaryMascotPose = "glide" | "boost";

/**
 * De persoonlijke gids komt uit companion.ts; alleen de spelpose bepaalt
 * hier welk Snelle Zendeling-bestand bij dat personage hoort.
 */
export function quickMissionaryMascotSprite(
  character: PersonalMascotCharacter,
  pose: QuickMissionaryMascotPose
): string {
  return `${character}-snelle-zendeling-${pose}.png`;
}
