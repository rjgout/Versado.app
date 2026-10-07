import { MYSTERY_002A } from "./mystery002a";
import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-002c-schriftkenner";

export const MYSTERY_002C = {
  id: "mystery-002c",
  mysteryNumber: 2,
  mysteryId: "mystery-002",
  routeId: "002c",
  logicId: "mystery-002c",
  titleKey: "pages.mystery002",
  difficulty: "scripture-scholar",
  difficultyLabelKey: "mystery002c.difficulty",
  difficultyDescriptionKey: "mystery002c.difficultyDescription",
  completionLabelKey: "mystery002c.scriptureScholarComplete",
  playIntroKey: "mystery002c.playIntro",
  readerLabelKey: "mystery002a.read",
  grid: { rows: 6, columns: 6 },
  assets: {
    board: `${ASSET_ROOT}/board.png`,
    manifest: `${ASSET_ROOT}/manifest.json`,
  },
  characters: [
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
    { id: "sam", name: "Sam", asset: "/mysterie-001b-onderzoeker/sam.png" },
    { id: "laban", name: "Laban", asset: "/mysterie-002b-onderzoeker/laban.png" },
    { id: "zoram", name: "Zoram", asset: `${ASSET_ROOT}/zoram.png` },
  ],
  solution: {
    laman: { row: 1, column: 6 },
    laban: { row: 2, column: 2 },
    zoram: { row: 3, column: 5 },
    sam: { row: 4, column: 1 },
    lemuel: { row: 5, column: 4 },
    nephi: { row: 6, column: 3 },
  },
  landmarks: {
    valuables: { row: 2, column: 1 },
    "house-of-laban": { row: 6, column: 2 },
  },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery002c.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery002c.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery002c.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery002c.clue4" },
    { id: "clue-5", kind: "PUZZLE_FICTION", textKey: "mystery002c.clue5" },
    { id: "clue-6", kind: "PUZZLE_FICTION", textKey: "mystery002c.clue6" },
    { id: "clue-7", kind: "PUZZLE_FICTION", textKey: "mystery002c.clue7" },
    { id: "clue-8", kind: "PUZZLE_FICTION", textKey: "mystery002c.clue8" },
  ],
  hints: {
    mode: "scripture-scholar",
    softDirection: "mystery002c.hint1",
    ranking: "mystery002c.hint2",
    columns: "mystery002c.hint3",
    final: "mystery002c.hint4",
  },
  story: MYSTERY_002A.story,
} as const satisfies MysteryDefinition;
