import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hintFor, isSolutionCorrect, satisfiesPuzzleClues } from "@/lib/mysteries/logic";
import { parseBoardManifest } from "@/lib/mysteries/manifest";
import { MYSTERY_GAME } from "@/lib/mysteries/game";
import { MYSTERY_003A } from "@/lib/mysteries/mystery003a";
import { MYSTERY_003B } from "@/lib/mysteries/mystery003b";
import { MYSTERY_003C } from "@/lib/mysteries/mystery003c";
import { MYSTERY_004A } from "@/lib/mysteries/mystery004a";
import { MYSTERY_004B } from "@/lib/mysteries/mystery004b";
import { MYSTERY_004C } from "@/lib/mysteries/mystery004c";
import { MYSTERY_005A } from "@/lib/mysteries/mystery005a";
import { MYSTERY_005B } from "@/lib/mysteries/mystery005b";
import { MYSTERY_005C } from "@/lib/mysteries/mystery005c";
import { MYSTERY_006A } from "@/lib/mysteries/mystery006a";
import { MYSTERY_006B } from "@/lib/mysteries/mystery006b";
import { MYSTERY_006C } from "@/lib/mysteries/mystery006c";
import type { MysteryDefinition, Placements } from "@/lib/mysteries/types";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const definitions: readonly MysteryDefinition[] = [
  MYSTERY_003A, MYSTERY_003B, MYSTERY_003C,
  MYSTERY_004A, MYSTERY_004B, MYSTERY_004C,
  MYSTERY_005A, MYSTERY_005B, MYSTERY_005C,
  MYSTERY_006A, MYSTERY_006B, MYSTERY_006C,
];

function solutionOf(definition: MysteryDefinition): Placements {
  return { ...definition.solution };
}

test("Mysterie 003–006 laden alle vaste definitions, assets en manifestgeometrie", () => {
  assert.deepEqual(definitions.map((definition) => definition.mysteryId), [
    "mystery-003", "mystery-003", "mystery-003",
    "mystery-004", "mystery-004", "mystery-004",
    "mystery-005", "mystery-005", "mystery-005",
    "mystery-006", "mystery-006", "mystery-006",
  ]);
  for (const definition of definitions) {
    const board = path.join(PUBLIC, definition.assets.board);
    const manifest = path.join(PUBLIC, definition.assets.manifest);
    assert.ok(existsSync(board), `${definition.id}: board ontbreekt`);
    assert.ok(existsSync(manifest), `${definition.id}: manifest ontbreekt`);
    const geometry = parseBoardManifest(JSON.parse(readFileSync(manifest, "utf8")));
    assert.ok(geometry, `${definition.id}: manifest is niet leesbaar`);
    assert.equal(geometry.rows, definition.grid.rows);
    assert.equal(geometry.columns, definition.grid.columns);
    assert.deepEqual(geometry.bounds, JSON.parse(readFileSync(manifest, "utf8")).boundsNormalized);
    assert.equal(geometry.footAnchorInCell.x, 0.5);
    assert.equal(geometry.footAnchorInCell.y, 0.8);
    assert.equal(geometry.maxVisibleCharacterHeight, 0.65);
    for (const character of definition.characters) assert.ok(existsSync(path.join(PUBLIC, character.asset)), `${definition.id}: ${character.id} ontbreekt`);
  }
});

test("Mysterie 003–006 accepteren hun exacte oplossingen en clues", () => {
  for (const definition of definitions) {
    const solution = solutionOf(definition);
    assert.equal(isSolutionCorrect(definition, solution), true, `${definition.id}: solution`);
    assert.equal(satisfiesPuzzleClues(definition, solution), true, `${definition.id}: clues`);
    const swapped = { ...solution };
    const first = definition.characters[0].id;
    const second = definition.characters[1].id;
    swapped[first] = solution[second] ?? null;
    swapped[second] = solution[first] ?? null;
    assert.equal(isSolutionCorrect(definition, swapped), false, `${definition.id}: swap`);
  }
});

test("De nieuwe mysteries volgen de 002 → 003 → 004 → 005 → 006-volgorde", () => {
  assert.deepEqual(MYSTERY_GAME.mysteries.map((mystery) => mystery.number), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(MYSTERY_GAME.mysteries.slice(2).map((mystery) => mystery.href), ["/mysteries/003", "/mysteries/004", "/mysteries/005", "/mysteries/006"]);
  assert.deepEqual(MYSTERY_GAME.mysteries.slice(2).map((mystery) => mystery.definition.story.source.chapterStart), [7, 16, 17, 18]);
});

test("Ismaël wordt gedeeld door Onderzoeker en Schriftkenner", () => {
  const ismaelB = MYSTERY_003B.characters.find((character) => character.id === "ismael");
  const ismaelC = MYSTERY_003C.characters.find((character) => character.id === "ismael");
  assert.equal(ismaelB?.asset, "/mysterie-003b-onderzoeker/ismael.png");
  assert.equal(ismaelC?.asset, "/mysterie-003b-onderzoeker/ismael.png");
  assert.deepEqual(JSON.parse(readFileSync(path.join(PUBLIC, MYSTERY_003B.assets.manifest), "utf8")).ismael.footAnchorPixels, [627, 1149]);
});

test("Alle nieuwe varianten hebben centrale hints en play-routes", () => {
  for (const definition of definitions) {
    if (definition.hints.mode !== "sequence") throw new Error(`${definition.id}: verkeerde hintmodus`);
    assert.equal(hintFor(definition, {}), definition.hints.softDirection);
    const first = { [definition.characters[0].id]: definition.solution[definition.characters[0].id] };
    assert.equal(hintFor(definition, first), definition.hints.reasoning);
    const firstTwo = {
      ...first,
      [definition.characters[1].id]: definition.solution[definition.characters[1].id],
    };
    assert.equal(hintFor(definition, firstTwo), definition.hints.stronger);
    assert.ok(existsSync(path.join(path.dirname(PUBLIC), "src/app/mysteries", `${definition.routeId}/play/page.tsx`)));
  }
});
