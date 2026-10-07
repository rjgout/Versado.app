import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-004c-schriftkenner";

export const MYSTERY_004C = {
  id: "mystery-004c",
  mysteryNumber: 4,
  mysteryId: "mystery-004",
  routeId: "004c",
  logicId: "mystery-004c",
  titleKey: "mystery004.title",
  difficulty: "scripture-scholar",
  difficultyLabelKey: "mystery004c.difficulty",
  difficultyDescriptionKey: "mystery004c.difficultyDescription",
  completionLabelKey: "mystery004c.scriptureScholarComplete",
  playIntroKey: "mystery004c.playIntro",
  readerLabelKey: "mystery004c.read",
  grid: { rows: 6, columns: 6 },
  assets: { board: `${ASSET_ROOT}/board.png`, manifest: `${ASSET_ROOT}/manifest.json` },
  characters: [
    { id: "sariah", name: "Sariah", asset: "/mysterie-001a-ontdekker/sariah.png" },
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
    { id: "lehi", name: "Lehi", asset: "/mysterie-001a-ontdekker/lehi.png" },
    { id: "sam", name: "Sam", asset: "/mysterie-001b-onderzoeker/sam.png" },
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
  ],
  solution: {
    sariah: { row: 1, column: 5 },
    nephi: { row: 2, column: 3 },
    lehi: { row: 3, column: 1 },
    sam: { row: 4, column: 6 },
    laman: { row: 5, column: 2 },
    lemuel: { row: 6, column: 4 },
  },
  landmarks: { arrowBundle: { row: 1, column: 4 }, brokenBow: { row: 2, column: 2 }, liahona: { row: 3, column: 2 } },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery004c.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery004c.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery004c.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery004c.clue4" },
    { id: "clue-5", kind: "PUZZLE_FICTION", textKey: "mystery004c.clue5" },
    { id: "clue-6", kind: "PUZZLE_FICTION", textKey: "mystery004c.clue6" },
    { id: "clue-7", kind: "PUZZLE_FICTION", textKey: "mystery004c.clue7" },
  ],
  hints: { mode: "sequence", softDirection: "mystery004c.hint1", reasoning: "mystery004c.hint2", stronger: "mystery004c.hint3" },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery004.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 16, chapterEnd: 16 },
  },
} as const satisfies MysteryDefinition;
