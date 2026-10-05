import type { MessageKey } from "@/lib/i18n/core";

export type MysteryDifficultyId = "discoverer" | "investigator" | "scripture-scholar";
export type CharacterId = "lehi" | "sariah" | "laman" | "lemuel";

export interface GridCell {
  row: number;
  column: number;
}

export interface MysteryCharacter {
  id: CharacterId;
  name: string;
  asset: string;
}

/**
 * Een clue is bewust als PUZZLE_FICTION getagd. Deze kunstmatige relaties
 * mogen nooit als bronfeit of historische reconstructie worden hergebruikt.
 */
export interface PuzzleClue {
  id: string;
  kind: "PUZZLE_FICTION";
  textKey: MessageKey;
}

/** Broninhoud die werkelijk uit de genoemde Schriftpassage komt. */
export interface ScriptureStory {
  kind: "SCRIPTURE_STORY";
  summaryKey: MessageKey;
  source: {
    work: "bofm";
    bookKey: string;
    chapterStart: number;
    chapterEnd: number;
  };
}

export interface MysteryDefinition {
  id: string;
  routeId: string;
  titleKey: MessageKey;
  difficulty: MysteryDifficultyId;
  grid: { rows: number; columns: number };
  assets: { board: string; manifest: string };
  characters: readonly MysteryCharacter[];
  solution: Readonly<Record<CharacterId, GridCell>>;
  landmarks: Readonly<Record<"stone-altar" | "tent", GridCell>>;
  clues: readonly PuzzleClue[];
  hints: {
    lehiMissing: MessageKey;
    sariahMissing: MessageKey;
    remainingPair: MessageKey;
    comparePair: MessageKey;
  };
  story: ScriptureStory;
}

export type Placements = Record<CharacterId, GridCell | null>;
