import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-006c-schriftkenner";

export const MYSTERY_006C = {
  id: "mystery-006c",
  mysteryNumber: 6,
  mysteryId: "mystery-006",
  routeId: "006c",
  logicId: "mystery-006c",
  titleKey: "mystery006.title",
  difficulty: "scripture-scholar",
  difficultyLabelKey: "mystery006c.difficulty",
  difficultyDescriptionKey: "mystery006c.difficultyDescription",
  completionLabelKey: "mystery006c.scriptureScholarComplete",
  playIntroKey: "mystery006c.playIntro",
  readerLabelKey: "mystery006c.read",
  grid: { rows: 6, columns: 6 },
  assets: { board: `${ASSET_ROOT}/board.png`, manifest: `${ASSET_ROOT}/manifest.json` },
  characters: [
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "sam", name: "Sam", asset: "/mysterie-001b-onderzoeker/sam.png" },
    { id: "lehi", name: "Lehi", asset: "/mysterie-001a-ontdekker/lehi.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
    { id: "sariah", name: "Sariah", asset: "/mysterie-001a-ontdekker/sariah.png" },
  ],
  solution: {
    nephi: { row: 1, column: 4 },
    laman: { row: 2, column: 1 },
    sam: { row: 3, column: 6 },
    lehi: { row: 4, column: 2 },
    lemuel: { row: 5, column: 5 },
    sariah: { row: 6, column: 3 },
  },
  landmarks: { ropeCoil: { row: 1, column: 3 }, mast: { row: 4, column: 5 }, hatch: { row: 4, column: 1 } },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery006c.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery006c.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery006c.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery006c.clue4" },
    { id: "clue-5", kind: "PUZZLE_FICTION", textKey: "mystery006c.clue5" },
    { id: "clue-6", kind: "PUZZLE_FICTION", textKey: "mystery006c.clue6" },
    { id: "clue-7", kind: "PUZZLE_FICTION", textKey: "mystery006c.clue7" },
  ],
  hints: { mode: "sequence", softDirection: "mystery006c.hint1", reasoning: "mystery006c.hint2", stronger: "mystery006c.hint3" },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery006.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 18, chapterEnd: 18 },
  },
} as const satisfies MysteryDefinition;
