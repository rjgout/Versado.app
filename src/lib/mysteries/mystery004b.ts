import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-004b-onderzoeker";

export const MYSTERY_004B = {
  id: "mystery-004b",
  mysteryNumber: 4,
  mysteryId: "mystery-004",
  routeId: "004b",
  logicId: "mystery-004b",
  titleKey: "mystery004.title",
  difficulty: "investigator",
  difficultyLabelKey: "mystery004b.difficulty",
  difficultyDescriptionKey: "mystery004b.difficultyDescription",
  completionLabelKey: "mystery004b.investigatorComplete",
  playIntroKey: "mystery004b.playIntro",
  readerLabelKey: "mystery004b.read",
  grid: { rows: 5, columns: 5 },
  assets: { board: `${ASSET_ROOT}/board.png`, manifest: `${ASSET_ROOT}/manifest.json` },
  characters: [
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
    { id: "lehi", name: "Lehi", asset: "/mysterie-001a-ontdekker/lehi.png" },
    { id: "sam", name: "Sam", asset: "/mysterie-001b-onderzoeker/sam.png" },
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
  ],
  solution: {
    nephi: { row: 1, column: 4 },
    lehi: { row: 2, column: 2 },
    sam: { row: 3, column: 5 },
    laman: { row: 4, column: 1 },
    lemuel: { row: 5, column: 3 },
  },
  landmarks: { brokenBow: { row: 1, column: 3 }, liahona: { row: 2, column: 1 } },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery004b.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery004b.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery004b.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery004b.clue4" },
    { id: "clue-5", kind: "PUZZLE_FICTION", textKey: "mystery004b.clue5" },
    { id: "clue-6", kind: "PUZZLE_FICTION", textKey: "mystery004b.clue6" },
  ],
  hints: { mode: "sequence", softDirection: "mystery004b.hint1", reasoning: "mystery004b.hint2", stronger: "mystery004b.hint3" },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery004.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 16, chapterEnd: 16 },
  },
} as const satisfies MysteryDefinition;
