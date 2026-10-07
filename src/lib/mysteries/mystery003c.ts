import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-003c-schriftkenner";

export const MYSTERY_003C = {
  id: "mystery-003c",
  mysteryNumber: 3,
  mysteryId: "mystery-003",
  routeId: "003c",
  logicId: "mystery-003c",
  titleKey: "mystery003.title",
  difficulty: "scripture-scholar",
  difficultyLabelKey: "mystery003c.difficulty",
  difficultyDescriptionKey: "mystery003c.difficultyDescription",
  completionLabelKey: "mystery003c.scriptureScholarComplete",
  playIntroKey: "mystery003c.playIntro",
  readerLabelKey: "mystery003c.read",
  grid: { rows: 6, columns: 6 },
  assets: { board: `${ASSET_ROOT}/board.png`, manifest: `${ASSET_ROOT}/manifest.json` },
  characters: [
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
    { id: "ismael", name: "Ismaël", asset: "/mysterie-003b-onderzoeker/ismael.png" },
    { id: "sam", name: "Sam", asset: "/mysterie-001b-onderzoeker/sam.png" },
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
    { id: "lehi", name: "Lehi", asset: "/mysterie-001a-ontdekker/lehi.png" },
  ],
  solution: {
    nephi: { row: 1, column: 4 },
    ismael: { row: 2, column: 1 },
    sam: { row: 3, column: 6 },
    laman: { row: 4, column: 3 },
    lemuel: { row: 5, column: 5 },
    lehi: { row: 6, column: 2 },
  },
  landmarks: {
    ropes: { row: 2, column: 4 },
    smallRockMarker: { row: 2, column: 2 },
    tent: { row: 6, column: 1 },
  },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery003c.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery003c.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery003c.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery003c.clue4" },
    { id: "clue-5", kind: "PUZZLE_FICTION", textKey: "mystery003c.clue5" },
    { id: "clue-6", kind: "PUZZLE_FICTION", textKey: "mystery003c.clue6" },
    { id: "clue-7", kind: "PUZZLE_FICTION", textKey: "mystery003c.clue7" },
  ],
  hints: { mode: "sequence", softDirection: "mystery003c.hint1", reasoning: "mystery003c.hint2", stronger: "mystery003c.hint3" },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery003.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 7, chapterEnd: 7 },
  },
} as const satisfies MysteryDefinition;
