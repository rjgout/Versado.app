import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-003a-ontdekker";
const NEPHI_ASSET = "/mysterie-001c-schriftkenner/nephi.png";
const SAM_ASSET = "/mysterie-001b-onderzoeker/sam.png";
const LAMAN_ASSET = "/mysterie-001a-ontdekker/laman.png";
const LEMUEL_ASSET = "/mysterie-001a-ontdekker/lemuel.png";

export const MYSTERY_003A = {
  id: "mystery-003a",
  mysteryNumber: 3,
  mysteryId: "mystery-003",
  routeId: "003a",
  logicId: "mystery-003a",
  titleKey: "mystery003.title",
  difficulty: "discoverer",
  difficultyLabelKey: "mystery003a.difficulty",
  difficultyDescriptionKey: "mystery003a.difficultyDescription",
  completionLabelKey: "mystery003a.discovererComplete",
  playIntroKey: "mystery003a.playIntro",
  readerLabelKey: "mystery003a.read",
  grid: { rows: 4, columns: 4 },
  assets: { board: `${ASSET_ROOT}/board.png`, manifest: `${ASSET_ROOT}/manifest.json` },
  characters: [
    { id: "nephi", name: "Nephi", asset: NEPHI_ASSET },
    { id: "sam", name: "Sam", asset: SAM_ASSET },
    { id: "laman", name: "Laman", asset: LAMAN_ASSET },
    { id: "lemuel", name: "Lemuel", asset: LEMUEL_ASSET },
  ],
  solution: {
    nephi: { row: 1, column: 2 },
    sam: { row: 2, column: 4 },
    laman: { row: 3, column: 1 },
    lemuel: { row: 4, column: 3 },
  },
  landmarks: { ropes: { row: 2, column: 2 } },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery003a.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery003a.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery003a.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery003a.clue4" },
  ],
  hints: { mode: "sequence", softDirection: "mystery003a.hint1", reasoning: "mystery003a.hint2", stronger: "mystery003a.hint3" },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery003.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 7, chapterEnd: 7 },
  },
} as const satisfies MysteryDefinition;
