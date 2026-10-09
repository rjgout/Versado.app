import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MYSTERY_001A, emptyMysteryPlacements } from "@/lib/mysteries/mystery001a";
import { MYSTERY_GAME } from "@/lib/mysteries/game";
import { MYSTERY_001B } from "@/lib/mysteries/mystery001b";
import { MYSTERY_001C } from "@/lib/mysteries/mystery001c";
import { GAME_CATALOG } from "@/lib/gameCatalog";
import {
  allCharactersPlaced,
  cellFootAnchor,
  cellFromBoardPoint,
  cellNormalizedRect,
  countSolutions,
  gridPixelRect,
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

function pngDimensions(filePath: string): { width: number; height: number } {
  const image = readFileSync(filePath);
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${filePath}: geen PNG`);
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

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

  it("schaalt grid, cellen en voetankers vanuit één image-rechthoek", () => {
    const small = { left: 10, top: 20, width: 250, height: 250 };
    const large = { left: 40, top: 80, width: 1000, height: 1000 };
    const smallGrid = gridPixelRect(small, geometry);
    const largeGrid = gridPixelRect(large, geometry);
    for (const [actual, expected] of [[smallGrid, { left: 32.5, top: 52.5, width: 205, height: 185 }], [largeGrid, { left: 130, top: 210, width: 820, height: 740 }]] as const) {
      for (const key of ["left", "top", "width", "height"] as const) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-9, key);
    }
    const cell = cellNormalizedRect({ row: 3, column: 4 }, geometry);
    for (const [key, expected] of Object.entries({ left: 0.705, top: 0.5, width: 0.205, height: 0.185 }) as [keyof typeof cell, number][]) assert.ok(Math.abs(cell[key] - expected) < 1e-9, key);
    const foot = cellFootAnchor({ row: 3, column: 4 }, geometry);
    assert.ok(Math.abs(foot.x - 0.8075) < 1e-9);
    assert.ok(Math.abs(foot.y - 0.648) < 1e-9);
    for (const rect of [small, large]) {
      const anchor = cellFootAnchor({ row: 3, column: 4 }, geometry);
      assert.deepEqual(cellFromBoardPoint({ x: rect.left + anchor.x * rect.width, y: rect.top + anchor.y * rect.height }, rect, geometry), { row: 3, column: 4 });
    }
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

  it("weigert een manifest waarvan celmaat en buitenbounds niet overeenkomen", () => {
    const invalid = parseBoardManifest({
      board: { width: 1254, height: 1254 },
      logicalPlayfield: { left: 0.09, top: 0.13, right: 0.91, bottom: 0.87 },
      grid: { rows: 4, columns: 4, cellWidthNormalized: 0.2, cellHeightNormalized: 0.185 },
      footAnchorWithinCell: { x: 0.5, y: 0.8 },
      footAnchorPixels: [627, 1149],
      maxVisibleCharacterHeight: 0.65,
    });
    assert.equal(invalid, null);
  });

  it("heeft onder harde regels en vastgelegde clues exact één oplossing", () => {
    const found = countSolutions();
    assert.equal(found.length, 1);
    assert.deepEqual(found[0], solution);
  });

  it("leidt voor iedere bestaande variant grid, oplossingen en landmarks uit het actuele manifest af", () => {
    const boardRect = { left: 37, top: 71, width: 913, height: 641 };
    for (const definition of MYSTERY_GAME.puzzles) {
      const manifestPath = join(process.cwd(), "public", definition.assets.manifest.replace(/^\//, ""));
      const boardPath = join(process.cwd(), "public", definition.assets.board.replace(/^\//, ""));
      const geometryForDefinition = parseBoardManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
      assert.ok(geometryForDefinition, `${definition.id}: manifest`);
      assert.deepEqual(pngDimensions(boardPath), { width: geometryForDefinition.imageWidth, height: geometryForDefinition.imageHeight }, `${definition.id}: boardratio`);
      assert.equal(geometryForDefinition.rows, definition.grid.rows, `${definition.id}: rows`);
      assert.equal(geometryForDefinition.columns, definition.grid.columns, `${definition.id}: columns`);
      for (const cell of [...Object.values(definition.solution), ...Object.values(definition.landmarks)]) {
        if (!cell) continue;
        assert.ok(cell.row >= 1 && cell.row <= geometryForDefinition.rows, `${definition.id}: rij`);
        assert.ok(cell.column >= 1 && cell.column <= geometryForDefinition.columns, `${definition.id}: kolom`);
        const anchor = cellFootAnchor(cell, geometryForDefinition);
        assert.deepEqual(
          cellFromBoardPoint({ x: boardRect.left + anchor.x * boardRect.width, y: boardRect.top + anchor.y * boardRect.height }, boardRect, geometryForDefinition),
          cell,
          `${definition.id}: anchor ${cell.row}/${cell.column}`,
        );
      }
    }
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
    assert.equal(MYSTERY_GAME.puzzles.length, 18);
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
    assert.deepEqual(cellFromBoardPoint({ x: 100 + 0.5 * 1000, y: 50 + 0.5 * 1000 }, { left: 100, top: 50, width: 1000, height: 1000 }, parsed!), { row: 3, column: 3 });
  });

  it("kiest de vooraf geschreven investigator-hints op basis van state", () => {
    assert.equal(hintFor(MYSTERY_001B, emptyMysteryPlacements(MYSTERY_001B)), "mystery001b.hint1");
    assert.equal(hintFor(MYSTERY_001B, { ...emptyMysteryPlacements(MYSTERY_001B), laman: solutionB.laman, lemuel: solutionB.lemuel, sariah: solutionB.sariah }), "mystery001b.hint3");
    assert.equal(hintFor(MYSTERY_001B, { ...solutionB, lehi: { row: 4, column: 2 } }), "mystery001b.hint4Lehi");
  });
});

describe("Mysterie 001C Schriftkenner", () => {
  const solutionC: Placements = {
    laman: { row: 1, column: 6 },
    nephi: { row: 2, column: 3 },
    sam: { row: 3, column: 5 },
    lemuel: { row: 4, column: 1 },
    sariah: { row: 5, column: 4 },
    lehi: { row: 6, column: 2 },
  };

  it("accepteert de unieke 6x6-oplossing en geen verwisseling", () => {
    assert.equal(isSolutionCorrect(MYSTERY_001C, solutionC), true);
    assert.equal(isSolutionCorrect(MYSTERY_001C, { ...solutionC, nephi: solutionC.sam, sam: solutionC.nephi }), false);
    assert.equal(countSolutions(MYSTERY_001C).length, 1);
  });

  it("dwingt rij- en kolomregels af voor zes personages", () => {
    const placed = { ...solutionC, nephi: null };
    assert.equal(isHardConstraintValid(MYSTERY_001C, placed, "nephi", { row: 6, column: 1 }), false);
    assert.equal(isHardConstraintValid(MYSTERY_001C, placed, "nephi", { row: 2, column: 6 }), false);
    assert.equal(isHardConstraintValid(MYSTERY_001C, placed, "nephi", { row: 2, column: 3 }), true);
    assert.equal(allCharactersPlaced(MYSTERY_001C, solutionC), true);
    assert.equal(allCharactersPlaced(MYSTERY_001C, { ...solutionC, nephi: null }), false);
  });

  it("gebruikt de actuele 6x6-manifestgeometrie en Nephi-assets", () => {
    const root = join(process.cwd(), "public", "mysterie-001c-schriftkenner");
    for (const file of ["board.png", "nephi.png", "manifest.json", "controle.txt"]) assert.equal(existsSync(join(root, file)), true, file);
    assert.equal(MYSTERY_001C.assets.board, "/mysterie-001c-schriftkenner/board.png");
    assert.equal(MYSTERY_001C.characters.find((character) => character.id === "nephi")?.asset, "/mysterie-001c-schriftkenner/nephi.png");
    assert.deepEqual(MYSTERY_001C.grid, { rows: 6, columns: 6 });
    const parsed = parseBoardManifest(JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")));
    assert.deepEqual(parsed?.bounds, { left: 0.08, top: 0.13, right: 0.92, bottom: 0.91 });
    assert.equal(parsed?.rows, 6);
    assert.equal(parsed?.columns, 6);
  });

  it("kiest de vooraf geschreven Schriftkenner-hints", () => {
    assert.equal(hintFor(MYSTERY_001C, { lehi: null, sariah: null, laman: null, lemuel: null, sam: null, nephi: null }), "mystery001c.hint1");
    assert.equal(hintFor(MYSTERY_001C, { ...solutionC, lehi: null }), "mystery001c.hint4");
  });
});
