import type { MessageKey } from "@/lib/i18n/core";
import { MYSTERY_001A } from "./mystery001a";
import { MYSTERY_001B } from "./mystery001b";
import { MYSTERY_001C } from "./mystery001c";
import { MYSTERY_002A } from "./mystery002a";
import { MYSTERY_002B } from "./mystery002b";
import { MYSTERY_002C } from "./mystery002c";
import { MYSTERY_003A } from "./mystery003a";
import { MYSTERY_003B } from "./mystery003b";
import { MYSTERY_003C } from "./mystery003c";
import { MYSTERY_004A } from "./mystery004a";
import { MYSTERY_004B } from "./mystery004b";
import { MYSTERY_004C } from "./mystery004c";
import { MYSTERY_005A } from "./mystery005a";
import { MYSTERY_005B } from "./mystery005b";
import { MYSTERY_005C } from "./mystery005c";
import { MYSTERY_006A } from "./mystery006a";
import { MYSTERY_006B } from "./mystery006b";
import { MYSTERY_006C } from "./mystery006c";
import type { MysteryDefinition, MysteryDifficultyId } from "./types";

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
    { id: "mystery-001", number: 1, titleKey: "pages.mystery001a" as MessageKey, introKey: "mystery001a.intro" as MessageKey, href: "/mysteries/001a", definition: MYSTERY_001A },
    { id: "mystery-002", number: 2, titleKey: "pages.mystery002" as MessageKey, introKey: "mystery002a.intro" as MessageKey, href: "/mysteries/002", definition: MYSTERY_002A },
    { id: "mystery-003", number: 3, titleKey: "mystery003.title" as MessageKey, introKey: "mystery003.intro" as MessageKey, href: "/mysteries/003", definition: MYSTERY_003A },
    { id: "mystery-004", number: 4, titleKey: "mystery004.title" as MessageKey, introKey: "mystery004.intro" as MessageKey, href: "/mysteries/004", definition: MYSTERY_004A },
    { id: "mystery-005", number: 5, titleKey: "mystery005.title" as MessageKey, introKey: "mystery005.intro" as MessageKey, href: "/mysteries/005", definition: MYSTERY_005A },
    { id: "mystery-006", number: 6, titleKey: "mystery006.title" as MessageKey, introKey: "mystery006.intro" as MessageKey, href: "/mysteries/006", definition: MYSTERY_006A },
  ],
  puzzles: [
    MYSTERY_001A, MYSTERY_001B, MYSTERY_001C,
    MYSTERY_002A, MYSTERY_002B, MYSTERY_002C,
    MYSTERY_003A, MYSTERY_003B, MYSTERY_003C,
    MYSTERY_004A, MYSTERY_004B, MYSTERY_004C,
    MYSTERY_005A, MYSTERY_005B, MYSTERY_005C,
    MYSTERY_006A, MYSTERY_006B, MYSTERY_006C,
  ],
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

export const MYSTERY_003_DEFINITIONS = {
  discoverer: MYSTERY_003A,
  investigator: MYSTERY_003B,
  "scripture-scholar": MYSTERY_003C,
} as const;

export const MYSTERY_004_DEFINITIONS = {
  discoverer: MYSTERY_004A,
  investigator: MYSTERY_004B,
  "scripture-scholar": MYSTERY_004C,
} as const;

export const MYSTERY_005_DEFINITIONS = {
  discoverer: MYSTERY_005A,
  investigator: MYSTERY_005B,
  "scripture-scholar": MYSTERY_005C,
} as const;

export const MYSTERY_006_DEFINITIONS = {
  discoverer: MYSTERY_006A,
  investigator: MYSTERY_006B,
  "scripture-scholar": MYSTERY_006C,
} as const;

export function mysteryDefinitionForDifficulty(difficulty: MysteryDifficultyId) {
  return MYSTERY_DEFINITIONS[difficulty];
}

export type MysteryId = "mystery-001" | "mystery-002" | "mystery-003" | "mystery-004" | "mystery-005" | "mystery-006";

const DEFINITIONS_BY_MYSTERY: Record<MysteryId, Record<MysteryDifficultyId, MysteryDefinition>> = {
  "mystery-001": MYSTERY_DEFINITIONS,
  "mystery-002": MYSTERY_002_DEFINITIONS,
  "mystery-003": MYSTERY_003_DEFINITIONS,
  "mystery-004": MYSTERY_004_DEFINITIONS,
  "mystery-005": MYSTERY_005_DEFINITIONS,
  "mystery-006": MYSTERY_006_DEFINITIONS,
};

export function mysteryDefinitionFor(mysteryId: MysteryId, difficulty: MysteryDifficultyId) {
  return DEFINITIONS_BY_MYSTERY[mysteryId][difficulty];
}

export function mysteryDefinitionForVariant(mysteryId: MysteryId, variant: string) {
  const definitions = DEFINITIONS_BY_MYSTERY[mysteryId];
  return Object.values(definitions).find((definition) => definition.routeId === variant) ?? null;
}
