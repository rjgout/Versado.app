import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-006a-ontdekker";

export const MYSTERY_006A = {
  id: "mystery-006a",
  mysteryNumber: 6,
  mysteryId: "mystery-006",
  routeId: "006a",
  logicId: "mystery-006a",
  titleKey: "mystery006.title",
  difficulty: "discoverer",
  difficultyLabelKey: "mystery006a.difficulty",
  difficultyDescriptionKey: "mystery006a.difficultyDescription",
  completionLabelKey: "mystery006a.discovererComplete",
  playIntroKey: "mystery006a.playIntro",
  readerLabelKey: "mystery006a.read",
  grid: { rows: 4, columns: 4 },
  assets: { board: `${ASSET_ROOT}/board.png`, manifest: `${ASSET_ROOT}/manifest.json` },
  characters: [
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
    { id: "sam", name: "Sam", asset: "/mysterie-001b-onderzoeker/sam.png" },
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
  ],
  solution: {
    laman: { row: 1, column: 2 },
    lemuel: { row: 2, column: 4 },
    sam: { row: 3, column: 1 },
    nephi: { row: 4, column: 3 },
  },
  landmarks: { mast: { row: 2, column: 3 }, ropeCoil: { row: 4, column: 2 } },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery006a.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery006a.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery006a.clue3" },
  ],
  hints: { mode: "sequence", softDirection: "mystery006a.hint1", reasoning: "mystery006a.hint2", stronger: "mystery006a.hint3" },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery006.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 18, chapterEnd: 18 },
  },
} as const satisfies MysteryDefinition;
