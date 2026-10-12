import { GAME_CATALOG, type GameId } from "@/lib/gameCatalog";
import type { GameSettingsView } from "@/lib/gameSettings";

export const GAME_SCOPE_KEYS = [...GAME_CATALOG.map(game => game.id), "live-exercises"] as const;
export type ScopedGame = GameId | "live-exercises";
export type GameSource = { work: string | null; editionKey: string; language: string; kind: string | null };
/** Alleen bestaande adapters. Een scope voegt nooit technische ondersteuning toe. */
export function supportsGameSource(game: ScopedGame, collection: GameSource): boolean {
  if (collection.kind !== "SCRIPTURE") return false;
  if (game === "live-exercises" || game === "challenges") {
    return ["bofm", "dc-testament", "pgp"].includes(collection.work ?? "")
      && collection.editionKey === collection.work && ["nl", "en", "de", "fr", "es"].includes(collection.language);
  }
  return collection.work === "bofm" && collection.editionKey === "bofm"
    && ["nl", "en", "de", "fr", "es"].includes(collection.language);
}
export function gameSettingEnabled(game: ScopedGame, settings: GameSettingsView): boolean {
  return game === "live-exercises" ? settings.liveExercisesEnabled
    : Boolean(settings[GAME_CATALOG.find(entry => entry.id === game)!.enabledKey]);
}

/** Vast broncontract van bestaande live-modi; beheerscopes zijn geen sessiecontext. */
export function fixedLiveGameCollectionId(mode: string): string | null {
  return ["CHAPTER_GUESS", "FAMILY_GAME", "ALLESKENNER"].includes(mode) ? "content_bom" : null;
}
