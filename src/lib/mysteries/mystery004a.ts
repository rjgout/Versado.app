import type { MysteryDefinition } from "./types";

const ASSET_ROOT = "/mysterie-004a-ontdekker";

export const MYSTERY_004A = {
  id: "mystery-004a",
  mysteryNumber: 4,
  mysteryId: "mystery-004",
  routeId: "004a",
  logicId: "mystery-004a",
  titleKey: "mystery004.title",
  difficulty: "discoverer",
  difficultyLabelKey: "mystery004a.difficulty",
  difficultyDescriptionKey: "mystery004a.difficultyDescription",
  completionLabelKey: "mystery004a.discovererComplete",
  playIntroKey: "mystery004a.playIntro",
  readerLabelKey: "mystery004a.read",
  grid: { rows: 4, columns: 4 },
  assets: { board: `${ASSET_ROOT}/board.png`, manifest: `${ASSET_ROOT}/manifest.json` },
  characters: [
    { id: "lehi", name: "Lehi", asset: "/mysterie-001a-ontdekker/lehi.png" },
    { id: "laman", name: "Laman", asset: "/mysterie-001a-ontdekker/laman.png" },
    { id: "lemuel", name: "Lemuel", asset: "/mysterie-001a-ontdekker/lemuel.png" },
    { id: "nephi", name: "Nephi", asset: "/mysterie-001c-schriftkenner/nephi.png" },
  ],
  solution: {
    lehi: { row: 1, column: 3 },
    laman: { row: 2, column: 1 },
    lemuel: { row: 3, column: 4 },
    nephi: { row: 4, column: 2 },
  },
  landmarks: { liahona: { row: 1, column: 2 }, brokenBow: { row: 4, column: 1 } },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery004a.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery004a.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery004a.clue3" },
  ],
  hints: { mode: "sequence", softDirection: "mystery004a.hint1", reasoning: "mystery004a.hint2", stronger: "mystery004a.hint3" },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery004.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 16, chapterEnd: 16 },
  },
} as const satisfies MysteryDefinition;
