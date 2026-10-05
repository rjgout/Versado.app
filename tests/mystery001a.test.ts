import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MYSTERY_001A, emptyMysteryPlacements } from "@/lib/mysteries/mystery001a";
import { MYSTERY_GAME } from "@/lib/mysteries/game";
import { MYSTERY_001B } from "@/lib/mysteries/mystery001b";
import { GAME_CATALOG } from "@/lib/gameCatalog";
import {
  allCharactersPlaced,
  cellFromBoardPoint,
  countSolutions,
  hintFor,
  isHardConstraintValid,
  isSolutionCorrect,
  placeCharacter,
  publicSolutionResult,
} from "@/lib/mysteries/logic";
import { firstCompletionUpdate } from "@/lib/mysteries/progressRules";
import { parseBoardManifest, type BoardGeometry } from "@/lib/mysteries/manifest";
import type { Placements } from "@/lib/mysteries/types";

const solution: Placements = {
  laman: { row: 1, column: 3 },
  lemuel: { row: 2, column: 1 },
  sariah: { row: 3, column: 4 },
  lehi: { row: 4, column: 2 },
};

const geometry: BoardGeometry = {
  imageWidth: 1254,
  imageHeight: 1254,
  bounds: { left: 0.09, top: 0.13, right: 0.91, bottom: 0.87 },
  rows: 4,
  columns: 4,
  cellWidthNormalized: 0.205,
  cellHeightNormalized: 0.185,
  footAnchorInCell: { x: 0.5, y: 0.8 },
  footAnchorPixels: { x: 627, y: 1149 },
  maxVisibleCharacterHeight: 0.65,
  visibleCharacterHeightPixels: undefined,
};

describe("Mysterie 001A", () => {
  it("scheidt de spelidentiteit van de eerste puzzel", () => {
    assert.equal(MYSTERY_GAME.id, "mystery");
    assert.equal(MYSTERY_GAME.puzzles[0].id, "mystery-001a");
    assert.equal(GAME_CATALOG.find((game) => game.id === "mystery")?.href, "/mysteries");
    assert.equal(GAME_CATALOG.some((game) => (game.id as string) === "mystery-001a"), false);
  });

  it("heeft alle productie-assets op de public-runtimepaden", () => {
    const root = join(process.cwd(), "public", "mysterie-001a-ontdekker");
    for (const file of ["board.png", "lehi.png", "sariah.png", "laman.png", "lemuel.png", "manifest.json"]) {
      assert.equal(existsSync(join(root, file)), true, file);
    }
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    assert.deepEqual(parseBoardManifest(manifest)?.bounds, geometry.bounds);
  });

  it("accepteert uitsluitend de exacte oplossing", () => {
    assert.equal(isSolutionCorrect(MYSTERY_001A, solution), true);
    assert.equal(isSolutionCorrect(MYSTERY_001A, { ...solution, laman: solution.lemuel!, lemuel: solution.laman! }), false);
    assert.equal(isSolutionCorrect(MYSTERY_001A, {
      lehi: { row: 1, column: 1 }, sariah: { row: 2, column: 2 }, laman: { row: 3, column: 3 }, lemuel: { row: 4, column: 4 },
    }), false);
  });

  it("dwingt één persoon per rij en kolom af", () => {
    const placed = { ...emptyMysteryPlacements(), lehi: { row: 4, column: 2 } };
    assert.equal(isHardConstraintValid(MYSTERY_001A, placed, "sariah", { row: 4, column: 1 }), false);
    assert.equal(isHardConstraintValid(MYSTERY_001A, placed, "sariah", { row: 1, column: 2 }), false);
    assert.equal(isHardConstraintValid(MYSTERY_001A, placed, "sariah", { row: 1, column: 1 }), true);
  });

  it("activeert controleren pas bij vier plaatsingen", () => {
    assert.equal(allCharactersPlaced(MYSTERY_001A, solution), true);
    assert.equal(allCharactersPlaced(MYSTERY_001A, { ...solution, lemuel: null }), false);
  });

  it("onthult bij een fout geen specifiek personage of vak", () => {
    const result = publicSolutionResult(MYSTERY_001A, { ...solution, laman: solution.lemuel!, lemuel: solution.laman! });
    assert.deepEqual(result, { correct: false, messageKey: "mystery001a.wrongText" });
    assert.equal(JSON.stringify(result).includes("laman"), false);
    assert.equal(JSON.stringify(result).includes("R1C3"), false);
  });

  it("bewaart alleen de eerste completion en negeert replay", () => {
    const at = new Date("2026-10-04T12:00:00Z");
    assert.deepEqual(firstCompletionUpdate(false, 2, at), { completed: true, completedAt: at, hintCount: 2, tutorialSeenAt: at });
    assert.equal(firstCompletionUpdate(true, 0, at), null);
  });

  it("kiest alleen vooraf geschreven, state-aware hints", () => {
    assert.equal(hintFor(MYSTERY_001A, emptyMysteryPlacements()), "mystery001a.hintA");
    assert.equal(hintFor(MYSTERY_001A, { ...emptyMysteryPlacements(), lehi: solution.lehi }), "mystery001a.hintB");
    assert.equal(hintFor(MYSTERY_001A, { ...emptyMysteryPlacements(), lehi: solution.lehi, sariah: solution.sariah }), "mystery001a.hintC");
    assert.equal(hintFor(MYSTERY_001A, { ...solution, laman: solution.lemuel, lemuel: solution.laman }), "mystery001a.hintD");
  });

  it("controleert inhoudelijk alleen de begeleide eerste zet", () => {
    const start = emptyMysteryPlacements();
    assert.equal(placeCharacter(MYSTERY_001A, start, "lehi", { row: 1, column: 1 }, true).accepted, false);
    const tutorial = placeCharacter(MYSTERY_001A, start, "lehi", solution.lehi!, true);
    assert.equal(tutorial.accepted, true);
    assert.equal(tutorial.tutorialCorrect, true);
    const wrongButHardValid = placeCharacter(MYSTERY_001A, tutorial.placements, "sariah", { row: 1, column: 1 }, false);
    assert.equal(wrongButHardValid.accepted, true);
    assert.deepEqual(wrongButHardValid.placements.sariah, { row: 1, column: 1 });
  });

  it("mapt coördinaten via de 9/13/91/87%-bounds en niet via het hele canvas", () => {
    const rect = { left: 100, top: 50, width: 1000, height: 1000 };
    assert.equal(cellFromBoardPoint({ x: 150, y: 100 }, rect, geometry), null);
    assert.deepEqual(cellFromBoardPoint({ x: 100 + 0.09 * 1000 + 0.1025 * 1000, y: 50 + 0.13 * 1000 + 0.0925 * 1000 }, rect, geometry), { row: 1, column: 1 });
    assert.deepEqual(cellFromBoardPoint({ x: 100 + (0.09 + 3.5 * 0.205) * 1000, y: 50 + (0.13 + 2.5 * 0.185) * 1000 }, rect, geometry), { row: 3, column: 4 });
  });

  it("leest de opgegeven rastergeometrie uit het manifestformaat", () => {
    const parsed = parseBoardManifest({
      board: { width: 1254, height: 1254 },
      logicalPlayfield: { left: 0.09, top: 0.13, right: 0.91, bottom: 0.87 },
      grid: { rows: 4, columns: 4, cellWidthNormalized: 0.205, cellHeightNormalized: 0.185 },
      footAnchorWithinCell: { x: 0.5, y: 0.8 },
      footAnchorPixels: [627, 1149],
      maxVisibleCharacterHeight: 0.65,
    });
    assert.deepEqual(parsed, geometry);
  });

  it("heeft onder harde regels en vastgelegde clues exact één oplossing", () => {
    const found = countSolutions();
    assert.equal(found.length, 1);
    assert.deepEqual(found[0], solution);
  });
});

describe("Mysterie 001B Onderzoeker", () => {
  const solutionB: Placements = {
    laman: { row: 1, column: 5 },
    sam: { row: 2, column: 3 },
    lemuel: { row: 3, column: 1 },
    sariah: { row: 4, column: 4 },
    lehi: { row: 5, column: 2 },
  };

  it("accepteert de unieke 5x5-oplossing en geen verwisseling", () => {
    assert.equal(MYSTERY_001A.mysteryId, MYSTERY_001B.mysteryId);
    assert.equal(MYSTERY_GAME.puzzles.length, 2);
    assert.equal(isSolutionCorrect(MYSTERY_001B, solutionB), true);
    assert.equal(isSolutionCorrect(MYSTERY_001B, { ...solutionB, laman: solutionB.lemuel, lemuel: solutionB.laman }), false);
    assert.equal(countSolutions(MYSTERY_001B).length, 1);
  });

  it("dwingt rij- en kolomregels af voor vijf personages", () => {
    const placed = { ...solutionB, sam: null };
    assert.equal(isHardConstraintValid(MYSTERY_001B, placed, "sam", { row: 5, column: 1 }), false);
    assert.equal(isHardConstraintValid(MYSTERY_001B, placed, "sam", { row: 1, column: 1 }), false);
    assert.equal(isHardConstraintValid(MYSTERY_001B, placed, "sam", { row: 2, column: 3 }), true);
    assert.equal(allCharactersPlaced(MYSTERY_001B, solutionB), true);
    assert.equal(allCharactersPlaced(MYSTERY_001B, { ...solutionB, sam: null }), false);
  });

  it("leest de exacte 5x5-geometrie en productie-assets", () => {
    const root = join(process.cwd(), "public", "mysterie-001b-onderzoeker");
    assert.equal(existsSync(join(root, "board.png")), true);
    assert.equal(existsSync(join(root, "sam.png")), true);
    assert.equal(MYSTERY_001B.assets.board, "/mysterie-001b-onderzoeker/board.png");
    assert.equal(MYSTERY_001B.characters.find((character) => character.id === "sam")?.asset, "/mysterie-001b-onderzoeker/sam.png");
    assert.deepEqual(MYSTERY_001B.grid, { rows: 5, columns: 5 });
    const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
    const parsed = parseBoardManifest(manifest);
    assert.deepEqual(parsed?.bounds, { left: 0.08, top: 0.14, right: 0.92, bottom: 0.86 });
    assert.equal(parsed?.rows, 5);
    assert.equal(parsed?.columns, 5);
  });

  it("kiest de vooraf geschreven investigator-hints op basis van state", () => {
    assert.equal(hintFor(MYSTERY_001B, emptyMysteryPlacements(MYSTERY_001B)), "mystery001b.hint1");
    assert.equal(hintFor(MYSTERY_001B, { ...emptyMysteryPlacements(MYSTERY_001B), laman: solutionB.laman, lemuel: solutionB.lemuel, sariah: solutionB.sariah }), "mystery001b.hint3");
    assert.equal(hintFor(MYSTERY_001B, { ...solutionB, lehi: { row: 4, column: 2 } }), "mystery001b.hint4Lehi");
  });
});
