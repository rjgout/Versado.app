import { MYSTERY_001A } from "./mystery001a";
import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-001b-onderzoeker";
const SHARED_ASSET_ROOT = "/mysterie-001a-ontdekker";

export const MYSTERY_001B = {
  id: "mystery-001b",
  mysteryNumber: 1,
  mysteryId: "mystery-001",
  routeId: "001b",
  logicId: "mystery-001b",
  titleKey: "pages.mystery001a",
  difficulty: "investigator",
  difficultyLabelKey: "mystery001b.difficulty",
  difficultyDescriptionKey: "mystery001b.difficultyDescription",
  completionLabelKey: "mystery001b.investigatorComplete",
  playIntroKey: "mystery001b.playIntro",
  readerLabelKey: "mystery001a.read",
  // De actuele Work-manifest is de enige bron voor board-geometrie.
  grid: { rows: 5, columns: 5 },
  assets: {
    board: `${ASSET_ROOT}/board.png`,
    manifest: `${ASSET_ROOT}/manifest.json`,
  },
  characters: [
    { id: "lehi", name: "Lehi", asset: `${SHARED_ASSET_ROOT}/lehi.png` },
    { id: "sariah", name: "Sariah", asset: `${SHARED_ASSET_ROOT}/sariah.png` },
    { id: "laman", name: "Laman", asset: `${SHARED_ASSET_ROOT}/laman.png` },
    { id: "lemuel", name: "Lemuel", asset: `${SHARED_ASSET_ROOT}/lemuel.png` },
    { id: "sam", name: "Sam", asset: `${ASSET_ROOT}/sam.png` },
  ],
  solution: {
    laman: { row: 1, column: 5 },
    sam: { row: 2, column: 3 },
    lemuel: { row: 3, column: 1 },
    sariah: { row: 4, column: 4 },
    lehi: { row: 5, column: 2 },
  },
  landmarks: {
    "stone-altar": { row: 5, column: 1 },
    tent: { row: 3, column: 3 },
  },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery001b.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery001b.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery001b.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery001b.clue4" },
    { id: "clue-5", kind: "PUZZLE_FICTION", textKey: "mystery001b.clue5" },
    { id: "clue-6", kind: "PUZZLE_FICTION", textKey: "mystery001b.clue6" },
  ],
  hints: {
    mode: "investigator",
    softDirection: "mystery001b.hint1",
    ranking: "mystery001b.hint2",
    columns: "mystery001b.hint3",
    nextLehi: "mystery001b.hint4Lehi",
    nextSam: "mystery001b.hint4Sam",
    nextRelation: "mystery001b.hint4Relation",
  },
  story: MYSTERY_001A.story,
} as const satisfies MysteryDefinition;

export function emptyMystery001bPlacements() {
  return {
    lehi: null,
    sariah: null,
    laman: null,
    lemuel: null,
    sam: null,
  } as const;
}
