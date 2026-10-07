import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-005b-onderzoeker";

export const MYSTERY_005B = {
  id: "mystery-005b",
  mysteryNumber: 5,
  mysteryId: "mystery-005",
  routeId: "005b",
  logicId: "mystery-005b",
  titleKey: "mystery005.title",
  difficulty: "investigator",
  difficultyLabelKey: "mystery005b.difficulty",
  difficultyDescriptionKey: "mystery005b.difficultyDescription",
  completionLabelKey: "mystery005b.investigatorComplete",
  playIntroKey: "mystery005b.playIntro",
  readerLabelKey: "mystery005b.read",
  grid: { rows: 5, columns: 5 },
  assets: { board: `${ASSET_ROOT}/board.png`, manifest: `${ASSET_ROOT}/manifest.json` },
  characters: [
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
    { id: "sam", name: "Sam", asset: "/mysterie-001b-onderzoeker/sam.png" },
    { id: "lehi", name: "Lehi", asset: "/mysterie-001a-ontdekker/lehi.png" },
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
  ],
  solution: {
    nephi: { row: 1, column: 4 },
    sam: { row: 2, column: 2 },
    lehi: { row: 3, column: 5 },
    laman: { row: 4, column: 1 },
    lemuel: { row: 5, column: 3 },
  },
  landmarks: { smithFire: { row: 2, column: 3 }, timberPile: { row: 3, column: 4 } },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery005b.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery005b.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery005b.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery005b.clue4" },
  ],
  hints: { mode: "sequence", softDirection: "mystery005b.hint1", reasoning: "mystery005b.hint2", stronger: "mystery005b.hint3" },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery005.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 17, chapterEnd: 17 },
  },
} as const satisfies MysteryDefinition;
