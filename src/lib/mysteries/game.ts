import type { MessageKey } from "@/lib/i18n/core";
import { MYSTERY_001A } from "./mystery001a";
import { MYSTERY_001B } from "./mystery001b";
import { MYSTERY_001C } from "./mystery001c";

/**
 * De spelidentiteit staat los van de eerste puzzel. Zo blijft "mystery" de
 * catalogus- en navigatiesleutel wanneer later meer mysteries worden
 * toegevoegd, terwijl elke puzzel zijn eigen stabiele content-ID houdt.
 */
export const MYSTERY_GAME = {
  id: "mystery",
  titleKey: "pages.mystery" as MessageKey,
  subtitleKey: "mysteryGame.subtitle" as MessageKey,
  introKey: "mysteryGame.intro" as MessageKey,
  coverArtworkKey: "game:mystery",
  puzzles: [MYSTERY_001A, MYSTERY_001B, MYSTERY_001C],
} as const;

export const MYSTERY_DEFINITIONS = {
  discoverer: MYSTERY_001A,
  investigator: MYSTERY_001B,
  "scripture-scholar": MYSTERY_001C,
} as const;

export function mysteryDefinitionForDifficulty(difficulty: "discoverer" | "investigator" | "scripture-scholar") {
  return MYSTERY_DEFINITIONS[difficulty];
}
