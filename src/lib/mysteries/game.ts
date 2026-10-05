import type { MessageKey } from "@/lib/i18n/core";
import { MYSTERY_001A } from "./mystery001a";

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
  puzzles: [MYSTERY_001A],
} as const;
