import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-003b-onderzoeker";

export const MYSTERY_003B = {
  id: "mystery-003b",
  mysteryNumber: 3,
  mysteryId: "mystery-003",
  routeId: "003b",
  logicId: "mystery-003b",
  titleKey: "mystery003.title",
  difficulty: "investigator",
  difficultyLabelKey: "mystery003b.difficulty",
  difficultyDescriptionKey: "mystery003b.difficultyDescription",
  completionLabelKey: "mystery003b.investigatorComplete",
  playIntroKey: "mystery003b.playIntro",
  readerLabelKey: "mystery003b.read",
  grid: { rows: 5, columns: 5 },
  assets: { board: `${ASSET_ROOT}/board.png`, manifest: `${ASSET_ROOT}/manifest.json` },
  characters: [
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
    { id: "ismael", name: "Ismaël", asset: `${ASSET_ROOT}/ismael.png` },
    { id: "sam", name: "Sam", asset: "/mysterie-001b-onderzoeker/sam.png" },
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
  ],
  solution: {
    nephi: { row: 1, column: 3 },
    ismael: { row: 2, column: 5 },
    sam: { row: 3, column: 1 },
    laman: { row: 4, column: 4 },
    lemuel: { row: 5, column: 2 },
  },
  landmarks: { ropes: { row: 2, column: 3 }, smallTent: { row: 2, column: 4 } },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery003b.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery003b.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery003b.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery003b.clue4" },
    { id: "clue-5", kind: "PUZZLE_FICTION", textKey: "mystery003b.clue5" },
    { id: "clue-6", kind: "PUZZLE_FICTION", textKey: "mystery003b.clue6" },
  ],
  hints: { mode: "sequence", softDirection: "mystery003b.hint1", reasoning: "mystery003b.hint2", stronger: "mystery003b.hint3" },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery003.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 7, chapterEnd: 7 },
  },
} as const satisfies MysteryDefinition;
