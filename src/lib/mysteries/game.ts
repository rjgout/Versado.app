import type { MessageKey } from "@/lib/i18n/core";
import { MYSTERY_001A } from "./mystery001a";
import { MYSTERY_001B } from "./mystery001b";
import { MYSTERY_001C } from "./mystery001c";
import { MYSTERY_002A } from "./mystery002a";
import { MYSTERY_002B } from "./mystery002b";
import { MYSTERY_002C } from "./mystery002c";
import type { MysteryDifficultyId } from "./types";

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
  mysteries: [
    { id: "mystery-001", number: 1, titleKey: "pages.mystery001a" as MessageKey, href: "/mysteries/001a", definition: MYSTERY_001A },
    { id: "mystery-002", number: 2, titleKey: "pages.mystery002" as MessageKey, href: "/mysteries/002", definition: MYSTERY_002A },
  ],
  puzzles: [MYSTERY_001A, MYSTERY_001B, MYSTERY_001C, MYSTERY_002A, MYSTERY_002B, MYSTERY_002C],
} as const;

export const MYSTERY_DEFINITIONS = {
  discoverer: MYSTERY_001A,
  investigator: MYSTERY_001B,
  "scripture-scholar": MYSTERY_001C,
} as const;

export const MYSTERY_002_DEFINITIONS = {
  discoverer: MYSTERY_002A,
  investigator: MYSTERY_002B,
  "scripture-scholar": MYSTERY_002C,
} as const;

export function mysteryDefinitionForDifficulty(difficulty: MysteryDifficultyId) {
  return MYSTERY_DEFINITIONS[difficulty];
}

export function mysteryDefinitionFor(mysteryId: "mystery-001" | "mystery-002", difficulty: MysteryDifficultyId) {
  return (mysteryId === "mystery-001" ? MYSTERY_DEFINITIONS : MYSTERY_002_DEFINITIONS)[difficulty];
}
