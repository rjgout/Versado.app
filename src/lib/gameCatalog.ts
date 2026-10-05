import type { MessageKey } from "@/lib/i18n/core";

// Vaste spelcatalogus: sleutel (ook voor de sleepvolgorde, UserListOrder),
// instelling in GameSettings, route en teksten. Gedeeld door het
// spellenoverzicht (LiveLobbyForm) en Vandaag, zodat een nieuw spel op één
// plek bijkomt. Bewust zonder iconen of beeld: die horen bij de weergave en
// worden per scherm gekozen (zie docs/VERSADO-DESIGN.md). Geen server-
// imports: ook bruikbaar in client components.

export type GameTextKey = "wordGame" | "scrabble" | "alleskenner" | "gezinsavond" | "chapterGuess" | "challenges" | "jigsaw" | "wordSearch" | "quickMissionary" | "mystery";

export type GameEnabledKey =
  | "wordGameEnabled"
  | "scrabbleEnabled"
  | "alleskennerEnabled"
  | "gezinsavondEnabled"
  | "chapterGuessEnabled"
  | "challengesEnabled"
  | "jigsawEnabled"
  | "wordSearchEnabled"
  | "quickMissionaryEnabled"
  | "mysteryEnabled";

export type GameId = "jigsaw" | "word-search" | "word-game" | "scrabble" | "alleskenner" | "gezinsavond" | "chapter-guess" | "challenges" | "quick-missionary" | "mystery";

export interface GameCatalogEntry {
  id: GameId;
  enabledKey: GameEnabledKey;
  /** Titel, omschrijving, knop en speluitleg staan onder gamesHub.<textKey> in de vertalingen. */
  textKey: GameTextKey;
  titleKey: MessageKey;
  href: string;
}

export const GAME_CATALOG: GameCatalogEntry[] = [
  { id: "jigsaw", enabledKey: "jigsawEnabled", textKey: "jigsaw", titleKey: "jigsaw.title", href: "/jigsaw" },
  { id: "word-search", enabledKey: "wordSearchEnabled", textKey: "wordSearch", titleKey: "pages.wordSearch", href: "/word-search" },
  { id: "word-game", enabledKey: "wordGameEnabled", textKey: "wordGame", titleKey: "pages.wordOfTheDay", href: "/word-game" },
  { id: "scrabble", enabledKey: "scrabbleEnabled", textKey: "scrabble", titleKey: "pages.wordGame", href: "/scrabble" },
  { id: "alleskenner", enabledKey: "alleskennerEnabled", textKey: "alleskenner", titleKey: "pages.alleskenner", href: "/alleskenner" },
  { id: "gezinsavond", enabledKey: "gezinsavondEnabled", textKey: "gezinsavond", titleKey: "pages.familyNight", href: "/gezinsavond" },
  { id: "chapter-guess", enabledKey: "chapterGuessEnabled", textKey: "chapterGuess", titleKey: "pages.chapterGuess", href: "/chapter-guess" },
  { id: "challenges", enabledKey: "challengesEnabled", textKey: "challenges", titleKey: "pages.challenges", href: "/challenges" },
  { id: "quick-missionary", enabledKey: "quickMissionaryEnabled", textKey: "quickMissionary", titleKey: "pages.quickMissionary", href: "/snelle-zendeling" },
  { id: "mystery", enabledKey: "mysteryEnabled", textKey: "mystery", titleKey: "pages.mystery", href: "/mysteries" },
];

/** Zelfde regel als het spellenoverzicht: toegestaan bij de actieve content én aangezet (of beheerder). */
export function isGameVisible(
  game: GameCatalogEntry,
  settings: Record<GameEnabledKey, boolean>,
  allowedGameKeys: string[],
  isAdmin: boolean
): boolean {
  return allowedGameKeys.includes(game.id) && (settings[game.enabledKey] || isAdmin);
}
