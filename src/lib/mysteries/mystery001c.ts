import { MYSTERY_001A } from "./mystery001a";
import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-001c-schriftkenner";
const SHARED_A = "/mysterie-001a-ontdekker";
const SHARED_B = "/mysterie-001b-onderzoeker";

export const MYSTERY_001C = {
  id: "mystery-001c",
  mysteryNumber: 1,
  mysteryId: "mystery-001",
  routeId: "001c",
  logicId: "mystery-001c",
  titleKey: "pages.mystery001a",
  difficulty: "scripture-scholar",
  difficultyLabelKey: "mystery001c.difficulty",
  difficultyDescriptionKey: "mystery001c.difficultyDescription",
  completionLabelKey: "mystery001c.scriptureScholarComplete",
  playIntroKey: "mystery001c.playIntro",
  readerLabelKey: "mystery001a.read",
  grid: { rows: 6, columns: 6 },
  assets: {
    board: `${ASSET_ROOT}/board.png`,
    manifest: `${ASSET_ROOT}/manifest.json`,
  },
  characters: [
    { id: "lehi", name: "Lehi", asset: `${SHARED_A}/lehi.png` },
    { id: "sariah", name: "Sariah", asset: `${SHARED_A}/sariah.png` },
    { id: "laman", name: "Laman", asset: `${SHARED_A}/laman.png` },
    { id: "lemuel", name: "Lemuel", asset: `${SHARED_A}/lemuel.png` },
    { id: "sam", name: "Sam", asset: `${SHARED_B}/sam.png` },
    { id: "nephi", name: "Nephi", asset: `${ASSET_ROOT}/nephi.png` },
  ],
  solution: {
    laman: { row: 1, column: 6 },
    nephi: { row: 2, column: 3 },
    sam: { row: 3, column: 5 },
    lemuel: { row: 4, column: 1 },
    sariah: { row: 5, column: 4 },
    lehi: { row: 6, column: 2 },
  },
  landmarks: {
    "stone-altar": { row: 6, column: 1 },
    tent: { row: 4, column: 4 },
  },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery001c.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery001c.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery001c.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery001c.clue4" },
    { id: "clue-5", kind: "PUZZLE_FICTION", textKey: "mystery001c.clue5" },
    { id: "clue-6", kind: "PUZZLE_FICTION", textKey: "mystery001c.clue6" },
    { id: "clue-7", kind: "PUZZLE_FICTION", textKey: "mystery001c.clue7" },
    { id: "clue-8", kind: "PUZZLE_FICTION", textKey: "mystery001c.clue8" },
  ],
  hints: {
    mode: "scripture-scholar",
    softDirection: "mystery001c.hint1",
    ranking: "mystery001c.hint2",
    columns: "mystery001c.hint3",
    final: "mystery001c.hint4",
  },
  story: MYSTERY_001A.story,
} as const satisfies MysteryDefinition;
