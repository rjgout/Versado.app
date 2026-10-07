import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-005a-ontdekker";

export const MYSTERY_005A = {
  id: "mystery-005a",
  mysteryNumber: 5,
  mysteryId: "mystery-005",
  routeId: "005a",
  logicId: "mystery-005a",
  titleKey: "mystery005.title",
  difficulty: "discoverer",
  difficultyLabelKey: "mystery005a.difficulty",
  difficultyDescriptionKey: "mystery005a.difficultyDescription",
  completionLabelKey: "mystery005a.discovererComplete",
  playIntroKey: "mystery005a.playIntro",
  readerLabelKey: "mystery005a.read",
  grid: { rows: 4, columns: 4 },
  assets: { board: `${ASSET_ROOT}/board.png`, manifest: `${ASSET_ROOT}/manifest.json` },
  characters: [
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
    { id: "sam", name: "Sam", asset: "/mysterie-001b-onderzoeker/sam.png" },
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
  ],
  solution: {
    nephi: { row: 1, column: 3 },
    sam: { row: 2, column: 1 },
    laman: { row: 3, column: 4 },
    lemuel: { row: 4, column: 2 },
  },
  landmarks: { smithFire: { row: 2, column: 2 } },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery005a.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery005a.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery005a.clue3" },
  ],
  hints: { mode: "sequence", softDirection: "mystery005a.hint1", reasoning: "mystery005a.hint2", stronger: "mystery005a.hint3" },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery005.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 17, chapterEnd: 17 },
  },
} as const satisfies MysteryDefinition;
