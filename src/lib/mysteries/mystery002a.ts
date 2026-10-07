import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-002a-ontdekker";

export const MYSTERY_002A = {
  id: "mystery-002a",
  mysteryNumber: 2,
  mysteryId: "mystery-002",
  routeId: "002a",
  logicId: "mystery-002a",
  titleKey: "pages.mystery002",
  difficulty: "discoverer",
  difficultyLabelKey: "mystery002a.difficulty",
  difficultyDescriptionKey: "mystery002a.difficultyDescription",
  completionLabelKey: "mystery002a.discovererComplete",
  playIntroKey: "mystery002a.playIntro",
  readerLabelKey: "mystery002a.read",
  grid: { rows: 4, columns: 4 },
  assets: {
    board: `${ASSET_ROOT}/board.png`,
    manifest: `${ASSET_ROOT}/manifest.json`,
  },
  characters: [
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
    { id: "sam", name: "Sam", asset: "/mysterie-001b-onderzoeker/sam.png" },
  ],
  solution: {
    laman: { row: 1, column: 4 },
    sam: { row: 2, column: 2 },
    lemuel: { row: 3, column: 1 },
    nephi: { row: 4, column: 3 },
  },
  landmarks: {
    valuables: { row: 2, column: 1 },
    "house-of-laban": { row: 4, column: 2 },
  },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery002a.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery002a.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery002a.clue3" },
  ],
  hints: {
    mode: "discoverer",
    lehiMissing: "mystery002a.hint1",
    sariahMissing: "mystery002a.hint2",
    remainingPair: "mystery002a.hint3",
    comparePair: "mystery002a.hint4",
  },
  tutorial: { characterId: "nephi", cell: { row: 4, column: 3 } },
  tutorialCopyKey: "mystery002a.tutorial",
  tutorialTryAgainKey: "mystery002a.tutorialTryAgain",
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery002a.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 3, chapterEnd: 4 },
  },
} as const satisfies MysteryDefinition;
