import type { MysteryDefinition, Placements } from "./types";

const ASSET_ROOT = "/mysterie-001a-ontdekker";

export const MYSTERY_001A = {
  id: "mystery-001a",
  mysteryNumber: 1,
  mysteryId: "mystery-001",
  routeId: "001a",
  titleKey: "pages.mystery001a",
  difficulty: "discoverer",
  difficultyLabelKey: "mystery001a.difficulty",
  completionLabelKey: "mystery001a.discovererComplete",
  grid: { rows: 4, columns: 4 },
  assets: {
    board: `${ASSET_ROOT}/board.png`,
    manifest: `${ASSET_ROOT}/manifest.json`,
  },
  characters: [
    { id: "lehi", name: "Lehi", asset: `${ASSET_ROOT}/lehi.png` },
    { id: "sariah", name: "Sariah", asset: `${ASSET_ROOT}/sariah.png` },
    { id: "laman", name: "Laman", asset: `${ASSET_ROOT}/laman.png` },
    { id: "lemuel", name: "Lemuel", asset: `${ASSET_ROOT}/lemuel.png` },
  ],
  solution: {
    lehi: { row: 4, column: 2 },
    sariah: { row: 3, column: 4 },
    laman: { row: 1, column: 3 },
    lemuel: { row: 2, column: 1 },
  },
  // Ook dit zijn bordgegevens, geen beweringen over historische posities.
  landmarks: {
    "stone-altar": { row: 4, column: 1 },
    tent: { row: 3, column: 3 },
  },
  clues: [
    { id: "clue-1", kind: "PUZZLE_FICTION", textKey: "mystery001a.clue1" },
    { id: "clue-2", kind: "PUZZLE_FICTION", textKey: "mystery001a.clue2" },
    { id: "clue-3", kind: "PUZZLE_FICTION", textKey: "mystery001a.clue3" },
  ],
  hints: {
    mode: "discoverer",
    lehiMissing: "mystery001a.hintA",
    sariahMissing: "mystery001a.hintB",
    remainingPair: "mystery001a.hintC",
    comparePair: "mystery001a.hintD",
  },
  tutorial: { characterId: "lehi", cell: { row: 4, column: 2 } },
  story: {
    kind: "SCRIPTURE_STORY",
    summaryKey: "mystery001a.story",
    source: { work: "bofm", bookKey: "bofm/1-ne", chapterStart: 1, chapterEnd: 2 },
  },
} as const satisfies MysteryDefinition;

export function emptyMysteryPlacements(definition: { characters: readonly { id: import("./types").CharacterId }[] } = MYSTERY_001A): Placements {
  return Object.fromEntries(definition.characters.map((character) => [character.id, null])) as Placements;
}
