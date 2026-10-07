import type { MessageKey } from "@/lib/i18n/core";

export type MysteryDifficultyId = "discoverer" | "investigator" | "scripture-scholar";
export type CharacterId = "lehi" | "sariah" | "laman" | "lemuel" | "sam" | "nephi" | "laban" | "zoram";
export type MysteryLogicId =
  | "mystery-001a"
  | "mystery-001b"
  | "mystery-001c"
  | "mystery-002a"
  | "mystery-002b"
  | "mystery-002c";

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
  mysteryNumber: number;
  mysteryId: string;
  routeId: string;
  logicId: MysteryLogicId;
  titleKey: MessageKey;
  difficulty: MysteryDifficultyId;
  difficultyLabelKey: MessageKey;
  difficultyDescriptionKey: MessageKey;
  completionLabelKey: MessageKey;
  playIntroKey: MessageKey;
  readerLabelKey: MessageKey;
  grid: {
    rows: number;
    columns: number;
    /** Optionele visuele kalibratie bovenop het technische asset-manifest. */
    calibratedBounds?: { left: number; top: number; right: number; bottom: number };
  };
  assets: { board: string; manifest: string };
  characters: readonly MysteryCharacter[];
  solution: Readonly<Partial<Record<CharacterId, GridCell>>>;
  landmarks: Readonly<Record<string, GridCell>>;
  clues: readonly PuzzleClue[];
  hints:
    | {
        mode: "discoverer";
        lehiMissing: MessageKey;
        sariahMissing: MessageKey;
        remainingPair: MessageKey;
        comparePair: MessageKey;
      }
    | {
        mode: "investigator";
        softDirection: MessageKey;
        ranking: MessageKey;
        columns: MessageKey;
        nextLehi: MessageKey;
        nextSam: MessageKey;
        nextRelation: MessageKey;
      }
    | {
        mode: "scripture-scholar";
        softDirection: MessageKey;
        ranking: MessageKey;
        columns: MessageKey;
        final: MessageKey;
      };
  tutorial?: { characterId: CharacterId; cell: GridCell };
  tutorialCopyKey?: MessageKey;
  tutorialTryAgainKey?: MessageKey;
  story: ScriptureStory;
}

export type Placements = Partial<Record<CharacterId, GridCell | null>>;
