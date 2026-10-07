import type { MessageKey } from "@/lib/i18n/core";
import { MYSTERY_001A } from "./mystery001a";
import type { BoardGeometry } from "./manifest";
import type { CharacterId, GridCell, MysteryDefinition, Placements } from "./types";

export function sameCell(a: GridCell | null | undefined, b: GridCell | null | undefined): boolean {
  return !!a && !!b && a.row === b.row && a.column === b.column;
}

export function cellKey(cell: GridCell): string {
  return `R${cell.row}C${cell.column}`;
}

export function occupantAt(placements: Placements, cell: GridCell): CharacterId | null {
  return (Object.entries(placements) as [CharacterId, GridCell | null][]).find(([, placed]) => sameCell(placed, cell))?.[0] ?? null;
}

export function isHardConstraintValid(
  definition: MysteryDefinition,
  placements: Placements,
  characterId: CharacterId,
  cell: GridCell
): boolean {
  if (cell.row < 1 || cell.row > definition.grid.rows || cell.column < 1 || cell.column > definition.grid.columns) return false;
  return (Object.entries(placements) as [CharacterId, GridCell | null][]).every(
    ([id, placed]) => id === characterId || !placed || (placed.row !== cell.row && placed.column !== cell.column)
  );
}

export function placeCharacter(
  definition: MysteryDefinition,
  placements: Placements,
  characterId: CharacterId,
  cell: GridCell,
  tutorialActive = false
): { accepted: boolean; placements: Placements; tutorialCorrect: boolean } {
  const tutorialCorrect = !!definition.tutorial
    && characterId === definition.tutorial.characterId
    && sameCell(cell, definition.tutorial.cell);
  if (!isHardConstraintValid(definition, placements, characterId, cell)) return { accepted: false, placements, tutorialCorrect: false };
  // Alleen de eerste begeleide zet toetst inhoudelijk. Hierna blijven alle
  // rij-/kolomgeldige hypotheses staan, ook als een clue ze later uitsluit.
  if (tutorialActive && definition.tutorial && !tutorialCorrect) return { accepted: false, placements, tutorialCorrect: false };
  return { accepted: true, placements: { ...placements, [characterId]: cell }, tutorialCorrect };
}

export function allCharactersPlaced(definition: MysteryDefinition, placements: Placements): boolean {
  return definition.characters.every((character) => !!placements[character.id]);
}

export function isSolutionCorrect(definition: MysteryDefinition, placements: Placements): boolean {
  return allCharactersPlaced(definition, placements) && definition.characters.every((character) => sameCell(placements[character.id], definition.solution[character.id]));
}

/** Een foutresultaat bevat expres geen personage, cel of mismatch. */
export function publicSolutionResult(definition: MysteryDefinition, placements: Placements): { correct: true } | { correct: false; messageKey: MessageKey } {
  return isSolutionCorrect(definition, placements) ? { correct: true } : { correct: false, messageKey: "mystery001a.wrongText" };
}

export function hintFor(definition: MysteryDefinition, placements: Placements): MessageKey {
  if (definition.hints.mode === "discoverer") {
    if (!sameCell(placements.lehi, definition.solution.lehi)) return definition.hints.lehiMissing;
    if (!sameCell(placements.sariah, definition.solution.sariah)) return definition.hints.sariahMissing;
    if (!placements.laman || !placements.lemuel) return definition.hints.remainingPair;
    return definition.hints.comparePair;
  }
  if (definition.hints.mode === "investigator") {
    if (!placements.lehi && !placements.sam && !placements.laman && !placements.lemuel && !placements.sariah) return definition.hints.softDirection;
    if (!placements.laman || !placements.lemuel || !placements.sariah) return definition.hints.ranking;
    if (!sameCell(placements.sam, definition.solution.sam) || !sameCell(placements.sariah, definition.solution.sariah) || !sameCell(placements.laman, definition.solution.laman)) return definition.hints.columns;
    if (!sameCell(placements.lehi, definition.solution.lehi)) return definition.hints.nextLehi;
    if (!sameCell(placements.sam, definition.solution.sam)) return definition.hints.nextSam;
    return definition.hints.nextRelation;
  }
  if (!placements.lehi && !placements.sam && !placements.nephi && !placements.laman && !placements.lemuel && !placements.sariah) return definition.hints.softDirection;
  if (!placements.laman || !placements.nephi || !placements.lemuel || !placements.sariah) return definition.hints.ranking;
  if (!sameCell(placements.nephi, definition.solution.nephi) || !sameCell(placements.lemuel, definition.solution.lemuel) || !sameCell(placements.sariah, definition.solution.sariah)) return definition.hints.columns;
  return definition.hints.final;
}

export function cellFromBoardPoint(
  point: { x: number; y: number },
  boardRect: { left: number; top: number; width: number; height: number },
  geometry: BoardGeometry
): GridCell | null {
  const x = (point.x - boardRect.left) / boardRect.width;
  const y = (point.y - boardRect.top) / boardRect.height;
  if (x < geometry.bounds.left || x >= geometry.bounds.right || y < geometry.bounds.top || y >= geometry.bounds.bottom) return null;
  const column = Math.floor((x - geometry.bounds.left) / geometry.cellWidthNormalized) + 1;
  const row = Math.floor((y - geometry.bounds.top) / geometry.cellHeightNormalized) + 1;
  return row <= geometry.rows && column <= geometry.columns ? { row, column } : null;
}

export function cellFootAnchor(cell: GridCell, geometry: BoardGeometry): { x: number; y: number } {
  return {
    x: geometry.bounds.left + (cell.column - 1 + geometry.footAnchorInCell.x) * geometry.cellWidthNormalized,
    y: geometry.bounds.top + (cell.row - 1 + geometry.footAnchorInCell.y) * geometry.cellHeightNormalized,
  };
}

export function characterImageMetrics(geometry: BoardGeometry): { height: number; anchorX: number; anchorY: number } {
  const visibleRatio = (geometry.visibleCharacterHeightPixels ?? geometry.imageHeight) / geometry.imageHeight;
  return {
    height: geometry.cellHeightNormalized * geometry.maxVisibleCharacterHeight / visibleRatio,
    anchorX: geometry.footAnchorPixels.x / geometry.imageWidth,
    anchorY: geometry.footAnchorPixels.y / geometry.imageHeight,
  };
}

/** Pure controle voor de handmatig ontworpen clue-set; gebruikt door tests. */
export function satisfiesPuzzleClues(definition: MysteryDefinition, placements: Placements): boolean {
  const { lehi, sariah, laman, lemuel, sam, nephi } = placements;
  if (!lehi || !sariah || !laman || !lemuel) return false;
  const altar = definition.landmarks["stone-altar"];
  const tent = definition.landmarks.tent;
  if (definition.hints.mode === "discoverer") {
    return lehi.row === altar.row && lehi.column === altar.column + 1
      && sariah.row === tent.row && sariah.column === tent.column + 1
      && laman.row < lemuel.row && laman.column > lemuel.column;
  }
  if (definition.hints.mode === "investigator") {
    if (!sam) return false;
    return lehi.row === altar.row && lehi.column === altar.column + 1
      && sam.row === tent.row - 1 && sam.column === tent.column
      && laman.row < lemuel.row && laman.column > lemuel.column
      && lemuel.row < sariah.row
      && sariah.column > sam.column
      && sariah.column < laman.column;
  }
  if (!sam || !nephi) return false;
  return lehi.row === altar.row && lehi.column === altar.column + 1
    && sam.row === tent.row - 1 && sam.column === tent.column + 1
    && laman.row < nephi.row
    && nephi.row < lemuel.row
    && lemuel.row < sariah.row
    && nephi.column === lemuel.column + 2
    && sariah.column === nephi.column + 1
    && laman.column > sariah.column;
}

export function countSolutions(definition: MysteryDefinition = MYSTERY_001A): Placements[] {
  const cells: GridCell[] = Array.from({ length: definition.grid.rows }, (_, row) => Array.from({ length: definition.grid.columns }, (_, column) => ({ row: row + 1, column: column + 1 }))).flat();
  const characters = definition.characters.map((character) => character.id);
  const found: Placements[] = [];
  function visit(index: number, placements: Placements) {
    if (index === characters.length) {
      if (satisfiesPuzzleClues(definition, placements)) found.push(placements);
      return;
    }
    const character = characters[index];
    for (const cell of cells) {
      if (!isHardConstraintValid(definition, placements, character, cell)) continue;
      visit(index + 1, { ...placements, [character]: cell });
    }
  }
  visit(0, Object.fromEntries(characters.map((character) => [character, null])) as Placements);
  return found;
}

export function completionTransition(alreadyCompleted: boolean): { firstCompletion: boolean; shouldRecordActivity: boolean } {
  return alreadyCompleted
    ? { firstCompletion: false, shouldRecordActivity: false }
    : { firstCompletion: true, shouldRecordActivity: true };
}
