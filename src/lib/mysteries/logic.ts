import type { MessageKey } from "@/lib/i18n/core";
import { MYSTERY_001A } from "./mystery001a";
import type { BoardGeometry } from "./manifest";
import type { CharacterId, GridCell, MysteryDefinition, Placements } from "./types";

export interface BoardRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type GridRect = BoardRect;

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
  if (definition.hints.mode === "sequence") {
    const placed = definition.characters.filter((character) => !!placements[character.id]).length;
    if (placed === 0) return definition.hints.softDirection;
    if (placed < 2) return definition.hints.reasoning;
    return definition.hints.stronger;
  }
  if (definition.logicId === "mystery-002a" && definition.hints.mode === "discoverer") {
    if (!placements.nephi && !placements.sam) return definition.hints.lehiMissing;
    if (!placements.nephi || !placements.sam) return definition.hints.sariahMissing;
    if (!placements.laman || !placements.lemuel) return definition.hints.remainingPair;
    return definition.hints.comparePair;
  }
  if (definition.logicId === "mystery-002b" && definition.hints.mode === "investigator") {
    if (!placements.nephi && !placements.laban) return definition.hints.softDirection;
    if (!placements.laman || !placements.sam || !placements.lemuel) return definition.hints.ranking;
    if (!sameCell(placements.sam, definition.solution.sam)
      || !sameCell(placements.lemuel, definition.solution.lemuel)
      || !sameCell(placements.laman, definition.solution.laman)) return definition.hints.columns;
    return definition.hints.nextRelation;
  }
  if (definition.logicId === "mystery-002c" && definition.hints.mode === "scripture-scholar") {
    if (!placements.nephi && !placements.laban) return definition.hints.softDirection;
    if (!placements.laman || !placements.zoram || !placements.sam || !placements.lemuel) return definition.hints.ranking;
    if (!sameCell(placements.sam, definition.solution.sam)
      || !sameCell(placements.lemuel, definition.solution.lemuel)
      || !sameCell(placements.zoram, definition.solution.zoram)
      || !sameCell(placements.laman, definition.solution.laman)) return definition.hints.columns;
    return definition.hints.final;
  }
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
  boardRect: BoardRect,
  geometry: BoardGeometry
): GridCell | null {
  const grid = gridPixelRect(boardRect, geometry);
  if (point.x < grid.left || point.x >= grid.left + grid.width || point.y < grid.top || point.y >= grid.top + grid.height) return null;
  const column = Math.floor((point.x - grid.left) / (grid.width / geometry.columns)) + 1;
  const row = Math.floor((point.y - grid.top) / (grid.height / geometry.rows)) + 1;
  return row <= geometry.rows && column <= geometry.columns ? { row, column } : null;
}

/** De genormaliseerde rasterrechthoek komt uitsluitend uit manifest-bounds. */
export function gridNormalizedRect(geometry: BoardGeometry): GridRect {
  return {
    left: geometry.bounds.left,
    top: geometry.bounds.top,
    width: geometry.bounds.right - geometry.bounds.left,
    height: geometry.bounds.bottom - geometry.bounds.top,
  };
}

/** Zet dezelfde manifestgeometrie om naar pixels in het echte boardbeeld. */
export function gridPixelRect(boardRect: BoardRect, geometry: BoardGeometry): GridRect {
  const grid = gridNormalizedRect(geometry);
  return {
    left: boardRect.left + grid.left * boardRect.width,
    top: boardRect.top + grid.top * boardRect.height,
    width: grid.width * boardRect.width,
    height: grid.height * boardRect.height,
  };
}

/** Een cel deelt de geometry-bron met rasterlijnen, anchors en hit testing. */
export function cellNormalizedRect(cell: GridCell, geometry: BoardGeometry): GridRect {
  const grid = gridNormalizedRect(geometry);
  return {
    left: grid.left + (cell.column - 1) * (grid.width / geometry.columns),
    top: grid.top + (cell.row - 1) * (grid.height / geometry.rows),
    width: grid.width / geometry.columns,
    height: grid.height / geometry.rows,
  };
}

export function cellFootAnchor(cell: GridCell, geometry: BoardGeometry): { x: number; y: number } {
  const rect = cellNormalizedRect(cell, geometry);
  return {
    x: rect.left + geometry.footAnchorInCell.x * rect.width,
    y: rect.top + geometry.footAnchorInCell.y * rect.height,
  };
}

export function characterImageMetrics(geometry: BoardGeometry): { height: number; anchorX: number; anchorY: number } {
  const visibleRatio = (geometry.visibleCharacterHeightPixels ?? geometry.imageHeight) / geometry.imageHeight;
  const grid = gridNormalizedRect(geometry);
  return {
    height: (grid.height / geometry.rows) * geometry.maxVisibleCharacterHeight / visibleRatio,
    anchorX: geometry.footAnchorPixels.x / geometry.imageWidth,
    anchorY: geometry.footAnchorPixels.y / geometry.imageHeight,
  };
}

/** Pure controle voor de handmatig ontworpen clue-set; gebruikt door tests. */
export function satisfiesPuzzleClues(definition: MysteryDefinition, placements: Placements): boolean {
  const { lehi, sariah, laman, lemuel, sam, nephi, laban, zoram, ismael } = placements;
  if (definition.logicId === "mystery-002a") {
    const house = definition.landmarks["house-of-laban"];
    const valuables = definition.landmarks.valuables;
    return !!nephi && !!sam && !!laman && !!lemuel
      && nephi.row === house.row && nephi.column === house.column + 1
      && sam.row === valuables.row && sam.column === valuables.column + 1
      && laman.row < lemuel.row && laman.column > lemuel.column;
  }
  if (definition.logicId === "mystery-002b") {
    const house = definition.landmarks["house-of-laban"];
    const valuables = definition.landmarks.valuables;
    return !!nephi && !!laban && !!sam && !!laman && !!lemuel
      && nephi.row === house.row && nephi.column === house.column + 1
      && laban.row === valuables.row && laban.column === valuables.column + 1
      && laman.row < sam.row && sam.row < lemuel.row
      && sam.column < lemuel.column && lemuel.column < laman.column;
  }
  if (definition.logicId === "mystery-002c") {
    const house = definition.landmarks["house-of-laban"];
    const valuables = definition.landmarks.valuables;
    return !!nephi && !!laban && !!zoram && !!sam && !!laman && !!lemuel
      && nephi.row === house.row && nephi.column === house.column + 1
      && laban.row === valuables.row && laban.column === valuables.column + 1
      && laman.row < zoram.row && zoram.row < sam.row && sam.row < lemuel.row
      && sam.column < lemuel.column && lemuel.column < zoram.column && zoram.column < laman.column;
  }
  if (definition.logicId === "mystery-003a") {
    const ropes = definition.landmarks.ropes;
    return !!nephi && !!sam && !!laman && !!lemuel
      && nephi.row === ropes.row - 1 && nephi.column === ropes.column
      && sam.column === nephi.column + 2
      && sam.row === laman.row - 1
      && lemuel.row === laman.row + 1 && lemuel.column === laman.column + 2;
  }
  if (definition.logicId === "mystery-003b") {
    const ropes = definition.landmarks.ropes;
    const tent = definition.landmarks.smallTent;
    return !!nephi && !!ismael && !!sam && !!laman && !!lemuel
      && nephi.row === ropes.row - 1 && nephi.column === ropes.column
      && ismael.row === tent.row && ismael.column === tent.column + 1
      && laman.row > sam.row && laman.row < lemuel.row
      && sam.row < lemuel.row
      && lemuel.column === sam.column + 1
      && laman.column === lemuel.column + 2;
  }
  if (definition.logicId === "mystery-003c") {
    const ropes = definition.landmarks.ropes;
    const marker = definition.landmarks.smallRockMarker;
    const tent = definition.landmarks.tent;
    return !!nephi && !!ismael && !!sam && !!laman && !!lemuel && !!lehi
      && nephi.row === ropes.row - 1 && nephi.column === ropes.column
      && lehi.row === tent.row && lehi.column === tent.column + 1
      && ismael.row === marker.row && ismael.column === marker.column - 1
      && laman.row > sam.row && laman.row < lemuel.row
      && sam.row < lemuel.row
      && lemuel.column === laman.column + 2
      && sam.column > lemuel.column;
  }
  if (definition.logicId === "mystery-004a") {
    const liahona = definition.landmarks.liahona;
    const brokenBow = definition.landmarks.brokenBow;
    return !!lehi && !!laman && !!lemuel && !!nephi
      && lehi.row === liahona.row && lehi.column === liahona.column + 1
      && nephi.row === brokenBow.row && nephi.column === brokenBow.column + 1
      && laman.row < lemuel.row && laman.column < lemuel.column;
  }
  if (definition.logicId === "mystery-004b") {
    const brokenBow = definition.landmarks.brokenBow;
    const liahona = definition.landmarks.liahona;
    return !!nephi && !!lehi && !!sam && !!laman && !!lemuel
      && nephi.row === brokenBow.row && nephi.column === brokenBow.column + 1
      && lehi.row === liahona.row && lehi.column === liahona.column + 1
      && sam.column === lemuel.column + 2
      && laman.row === lemuel.row - 1
      && laman.column < lemuel.column
      && sam.row < laman.row;
  }
  if (definition.logicId === "mystery-004c") {
    const arrows = definition.landmarks.arrowBundle;
    const brokenBow = definition.landmarks.brokenBow;
    const liahona = definition.landmarks.liahona;
    return !!sariah && !!nephi && !!lehi && !!sam && !!laman && !!lemuel
      && sariah.row === arrows.row && sariah.column === arrows.column + 1
      && nephi.row === brokenBow.row && nephi.column === brokenBow.column + 1
      && lehi.row === liahona.row && lehi.column === liahona.column - 1
      && lemuel.column === laman.column + 2
      && sam.column > lemuel.column
      && sam.row < laman.row
      && laman.row < lemuel.row;
  }
  if (definition.logicId === "mystery-005a") {
    const fire = definition.landmarks.smithFire;
    return !!nephi && !!sam && !!laman && !!lemuel
      && nephi.row === fire.row - 1 && nephi.column === fire.column + 1
      && sam.row === fire.row && sam.column === fire.column - 1
      && laman.row === lemuel.row - 1 && laman.column === lemuel.column + 2;
  }
  if (definition.logicId === "mystery-005b") {
    const fire = definition.landmarks.smithFire;
    const timber = definition.landmarks.timberPile;
    return !!nephi && !!sam && !!lehi && !!laman && !!lemuel
      && nephi.row === fire.row - 1 && nephi.column === fire.column + 1
      && sam.row === fire.row && sam.column === fire.column - 1
      && lehi.row === timber.row && lehi.column === timber.column + 1
      && lemuel.row === laman.row + 1 && lemuel.column === laman.column + 2;
  }
  if (definition.logicId === "mystery-005c") {
    const fire = definition.landmarks.smithFire;
    const timber = definition.landmarks.timberPile;
    return !!nephi && !!sam && !!lehi && !!sariah && !!laman && !!lemuel
      && nephi.row === fire.row - 1 && nephi.column === fire.column + 1
      && sam.row === fire.row && sam.column === fire.column - 1
      && lehi.row === timber.row && lehi.column === timber.column + 1
      && sariah.row < laman.row
      && laman.column < sariah.column
      && lemuel.row > laman.row
      && lemuel.column === sariah.column + 2;
  }
  if (definition.logicId === "mystery-006a") {
    const mast = definition.landmarks.mast;
    const rope = definition.landmarks.ropeCoil;
    return !!laman && !!lemuel && !!sam && !!nephi
      && lemuel.row === mast.row && lemuel.column === mast.column + 1
      && nephi.row === rope.row && nephi.column === rope.column + 1
      && laman.row < sam.row && laman.column > sam.column;
  }
  if (definition.logicId === "mystery-006b") {
    const rope = definition.landmarks.ropeCoil;
    const mast = definition.landmarks.mast;
    return !!nephi && !!sam && !!lehi && !!laman && !!lemuel
      && lehi.row === mast.row && lehi.column === mast.column + 1
      && sam.row === rope.row && sam.column === rope.column - 1
      && nephi.row === lehi.row - 2 && nephi.column === lehi.column + 1
      && laman.row < lemuel.row
      && lemuel.column === laman.column + 2;
  }
  if (definition.logicId === "mystery-006c") {
    const rope = definition.landmarks.ropeCoil;
    const mast = definition.landmarks.mast;
    const hatch = definition.landmarks.hatch;
    return !!nephi && !!laman && !!sam && !!lehi && !!lemuel && !!sariah
      && nephi.row === rope.row && nephi.column === rope.column + 1
      && sam.row === mast.row - 1 && sam.column === mast.column + 1
      && lehi.row === hatch.row && lehi.column === hatch.column + 1
      && laman.row < lemuel.row
      && sariah.row > lemuel.row
      && sariah.column === lemuel.column - 2
      && laman.column < lehi.column;
  }
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
