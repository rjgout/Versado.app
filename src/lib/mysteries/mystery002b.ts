import { MYSTERY_002A } from "./mystery002a";
import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-002b-onderzoeker";

export const MYSTERY_002B = {
  id: "mystery-002b",
  mysteryNumber: 2,
  mysteryId: "mystery-002",
  routeId: "002b",
  logicId: "mystery-002b",
  titleKey: "pages.mystery002",
  difficulty: "investigator",
  difficultyLabelKey: "mystery002b.difficulty",
  difficultyDescriptionKey: "mystery002b.difficultyDescription",
  completionLabelKey: "mystery002b.investigatorComplete",
  playIntroKey: "mystery002b.playIntro",
  readerLabelKey: "mystery002a.read",
  grid: { rows: 5, columns: 5 },
  assets: {
    board: `${ASSET_ROOT}/board.png`,
    manifest: `${ASSET_ROOT}/manifest.json`,
  },
  characters: [
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
    { id: "sam", name: "Sam", asset: "/mysterie-001b-onderzoeker/sam.png" },
    { id: "laban", name: "Laban", asset: `${ASSET_ROOT}/laban.png` },
  ],
  solution: {
    laman: { row: 1, column: 5 },
    laban: { row: 2, column: 3 },
    sam: { row: 3, column: 1 },
    lemuel: { row: 4, column: 4 },
    nephi: { row: 5, column: 2 },
  },
  landmarks: {
    valuables: { row: 2, column: 2 },
    "house-of-laban": { row: 5, column: 1 },
  },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery002b.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery002b.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery002b.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery002b.clue4" },
    { id: "clue-5", kind: "PUZZLE_FICTION", textKey: "mystery002b.clue5" },
    { id: "clue-6", kind: "PUZZLE_FICTION", textKey: "mystery002b.clue6" },
  ],
  hints: {
    mode: "investigator",
    softDirection: "mystery002b.hint1",
    ranking: "mystery002b.hint2",
    columns: "mystery002b.hint3",
    nextLehi: "mystery002b.hint4",
    nextSam: "mystery002b.hint4",
    nextRelation: "mystery002b.hint4",
  },
  story: MYSTERY_002A.story,
} as const satisfies MysteryDefinition;
