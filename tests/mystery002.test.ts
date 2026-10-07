import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MYSTERY_GAME } from "@/lib/mysteries/game";
import { MYSTERY_002A } from "@/lib/mysteries/mystery002a";
import { MYSTERY_002B } from "@/lib/mysteries/mystery002b";
import { MYSTERY_002C } from "@/lib/mysteries/mystery002c";
import { allCharactersPlaced, countSolutions, hintFor, isHardConstraintValid, isSolutionCorrect } from "@/lib/mysteries/logic";
import { emptyMysteryPlacements } from "@/lib/mysteries/mystery001a";
import { parseBoardManifest } from "@/lib/mysteries/manifest";
import type { Placements } from "@/lib/mysteries/types";

const solutionA: Placements = {
  laman: { row: 1, column: 4 },
  sam: { row: 2, column: 2 },
  lemuel: { row: 3, column: 1 },
  nephi: { row: 4, column: 3 },
};
const solutionB: Placements = {
  laman: { row: 1, column: 5 },
  laban: { row: 2, column: 3 },
  sam: { row: 3, column: 1 },
  lemuel: { row: 4, column: 4 },
  nephi: { row: 5, column: 2 },
};
const solutionC: Placements = {
  laman: { row: 1, column: 6 },
  laban: { row: 2, column: 2 },
  zoram: { row: 3, column: 5 },
  sam: { row: 4, column: 1 },
  lemuel: { row: 5, column: 4 },
  nephi: { row: 6, column: 3 },
};

describe("Mysterie 002", () => {
  it("staat als tweede mysterie in Het Mysterie", () => {
    assert.deepEqual(MYSTERY_GAME.mysteries.map((mystery) => mystery.id), ["mystery-001", "mystery-002"]);
    assert.equal(MYSTERY_GAME.puzzles.length, 6);
    assert.equal(MYSTERY_002A.mysteryNumber, 2);
    assert.equal(MYSTERY_002A.story.source.chapterStart, 3);
    assert.equal(MYSTERY_002A.story.source.chapterEnd, 4);
  });

  it("accepteert de unieke Ontdekker-oplossing", () => {
    assert.equal(isSolutionCorrect(MYSTERY_002A, solutionA), true);
    assert.equal(isSolutionCorrect(MYSTERY_002A, { ...solutionA, laman: solutionA.lemuel, lemuel: solutionA.laman }), false);
    assert.equal(countSolutions(MYSTERY_002A).length, 1);
    assert.equal(allCharactersPlaced(MYSTERY_002A, solutionA), true);
  });

  it("accepteert de unieke Onderzoeker-oplossing", () => {
    assert.equal(isSolutionCorrect(MYSTERY_002B, solutionB), true);
    assert.equal(isSolutionCorrect(MYSTERY_002B, { ...solutionB, laban: solutionB.sam, sam: solutionB.laban }), false);
    assert.equal(countSolutions(MYSTERY_002B).length, 1);
    const empty = emptyMysteryPlacements(MYSTERY_002B);
    assert.equal(isHardConstraintValid(MYSTERY_002B, { ...empty, laban: solutionB.laban }, "sam", { row: 2, column: 1 }), false);
    assert.equal(isHardConstraintValid(MYSTERY_002B, { ...empty, laban: solutionB.laban }, "sam", { row: 3, column: 1 }), true);
  });

  it("accepteert de unieke Schriftkenner-oplossing", () => {
    assert.equal(isSolutionCorrect(MYSTERY_002C, solutionC), true);
    assert.equal(isSolutionCorrect(MYSTERY_002C, { ...solutionC, zoram: solutionC.sam, sam: solutionC.zoram }), false);
    assert.equal(countSolutions(MYSTERY_002C).length, 1);
    assert.equal(allCharactersPlaced(MYSTERY_002C, { ...solutionC, zoram: null }), false);
  });

  it("leest 4x4-, 5x5- en 6x6-geometry uit de actuele manifests", () => {
    const expected = [
      [MYSTERY_002A, "mysterie-002a-ontdekker", { left: 0.08, top: 0.14, right: 0.92, bottom: 0.9 }],
      [MYSTERY_002B, "mysterie-002b-onderzoeker", { left: 0.08, top: 0.13, right: 0.92, bottom: 0.88 }],
      [MYSTERY_002C, "mysterie-002c-schriftkenner", { left: 0.09, top: 0.1, right: 0.95, bottom: 0.88 }],
    ] as const;
    for (const [definition, directory, bounds] of expected) {
      const root = join(process.cwd(), "public", directory);
      assert.equal(existsSync(join(root, "board.png")), true);
      assert.equal(existsSync(join(root, "manifest.json")), true);
      const manifest = parseBoardManifest(JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")));
      assert.equal(manifest?.rows, definition.grid.rows);
      assert.equal(manifest?.columns, definition.grid.columns);
      assert.deepEqual(manifest?.bounds, bounds);
    }
    assert.equal(MYSTERY_002B.characters.find((character) => character.id === "laban")?.asset, "/mysterie-002b-onderzoeker/laban.png");
    assert.equal(MYSTERY_002C.characters.find((character) => character.id === "zoram")?.asset, "/mysterie-002c-schriftkenner/zoram.png");
  });

  it("kiest de centrale vooraf geschreven hints per variant", () => {
    assert.equal(hintFor(MYSTERY_002A, emptyMysteryPlacements(MYSTERY_002A)), "mystery002a.hint1");
    assert.equal(hintFor(MYSTERY_002B, emptyMysteryPlacements(MYSTERY_002B)), "mystery002b.hint1");
    assert.equal(hintFor(MYSTERY_002C, emptyMysteryPlacements(MYSTERY_002C)), "mystery002c.hint1");
    assert.equal(hintFor(MYSTERY_002A, solutionA), "mystery002a.hint4");
    assert.equal(hintFor(MYSTERY_002B, solutionB), "mystery002b.hint4");
    assert.equal(hintFor(MYSTERY_002C, solutionC), "mystery002c.hint4");
  });
});
