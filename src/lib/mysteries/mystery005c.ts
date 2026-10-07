import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-005c-schriftkenner";

export const MYSTERY_005C = {
  id: "mystery-005c",
  mysteryNumber: 5,
  mysteryId: "mystery-005",
  routeId: "005c",
  logicId: "mystery-005c",
  titleKey: "mystery005.title",
  difficulty: "scripture-scholar",
  difficultyLabelKey: "mystery005c.difficulty",
  difficultyDescriptionKey: "mystery005c.difficultyDescription",
  completionLabelKey: "mystery005c.scriptureScholarComplete",
  playIntroKey: "mystery005c.playIntro",
  readerLabelKey: "mystery005c.read",
  grid: { rows: 6, columns: 6 },
  assets: { board: `${ASSET_ROOT}/board.png`, manifest: `${ASSET_ROOT}/manifest.json` },
  characters: [
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
    { id: "sam", name: "Sam", asset: "/mysterie-001b-onderzoeker/sam.png" },
    { id: "lehi", name: "Lehi", asset: "/mysterie-001a-ontdekker/lehi.png" },
    { id: "sariah", name: "Sariah", asset: "/mysterie-001a-ontdekker/sariah.png" },
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
  ],
  solution: {
    nephi: { row: 1, column: 5 },
    sam: { row: 2, column: 3 },
    lehi: { row: 3, column: 6 },
    sariah: { row: 4, column: 2 },
    laman: { row: 5, column: 1 },
    lemuel: { row: 6, column: 4 },
  },
  landmarks: { smithFire: { row: 2, column: 4 }, timberPile: { row: 3, column: 5 } },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery005c.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery005c.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery005c.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery005c.clue4" },
    { id: "clue-5", kind: "PUZZLE_FICTION", textKey: "mystery005c.clue5" },
    { id: "clue-6", kind: "PUZZLE_FICTION", textKey: "mystery005c.clue6" },
    { id: "clue-7", kind: "PUZZLE_FICTION", textKey: "mystery005c.clue7" },
  ],
  hints: { mode: "sequence", softDirection: "mystery005c.hint1", reasoning: "mystery005c.hint2", stronger: "mystery005c.hint3" },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery005.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 17, chapterEnd: 17 },
  },
} as const satisfies MysteryDefinition;
