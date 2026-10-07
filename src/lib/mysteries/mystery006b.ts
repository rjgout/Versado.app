import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-006b-onderzoeker";

export const MYSTERY_006B = {
  id: "mystery-006b",
  mysteryNumber: 6,
  mysteryId: "mystery-006",
  routeId: "006b",
  logicId: "mystery-006b",
  titleKey: "mystery006.title",
  difficulty: "investigator",
  difficultyLabelKey: "mystery006b.difficulty",
  difficultyDescriptionKey: "mystery006b.difficultyDescription",
  completionLabelKey: "mystery006b.investigatorComplete",
  playIntroKey: "mystery006b.playIntro",
  readerLabelKey: "mystery006b.read",
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
    nephi: { row: 1, column: 5 },
    sam: { row: 2, column: 2 },
    lehi: { row: 3, column: 4 },
    laman: { row: 4, column: 1 },
    lemuel: { row: 5, column: 3 },
  },
  landmarks: { ropeCoil: { row: 2, column: 3 }, mast: { row: 3, column: 3 } },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery006b.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery006b.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery006b.clue3" },
    { id: "clue-4", kind: "PUZZLE_FICTION", textKey: "mystery006b.clue4" },
    { id: "clue-5", kind: "PUZZLE_FICTION", textKey: "mystery006b.clue5" },
  ],
  hints: { mode: "sequence", softDirection: "mystery006b.hint1", reasoning: "mystery006b.hint2", stronger: "mystery006b.hint3" },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery006.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 18, chapterEnd: 18 },
  },
} as const satisfies MysteryDefinition;
