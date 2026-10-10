import type { PuzzleGeometry, PuzzleGroup } from "@/lib/puzzle/types";

export interface PuzzleBounds { minX: number; minY: number; maxX: number; maxY: number; }
export interface PuzzleWorktable { bounds: PuzzleBounds; puzzle: { x: number; y: number; width: number; height: number }; slots: Array<{ x: number; y: number }>; }

const PIECE_OVERHANG = .28;
const SLOT_DISTANCE = 1.6;

function intersects(a: PuzzleBounds, b: PuzzleBounds) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function hash(seed: string) { let value = 2166136261; for (let i = 0; i < seed.length; i++) value = Math.imul(value ^ seed.charCodeAt(i), 16777619); return value >>> 0; }
function shuffle<T>(values: T[], seed: string) {
  let state = hash(seed) || 1; const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; };
  const copy = [...values]; for (let index = copy.length - 1; index > 0; index--) { const other = Math.floor(random() * (index + 1)); [copy[index], copy[other]] = [copy[other], copy[index]]; }
  return copy;
}

function slotsFor(geometry: PuzzleGeometry, margin: number): PuzzleWorktable {
  const puzzle = { x: margin, y: margin, width: geometry.grid.columns, height: geometry.grid.rows };
  const bounds = { minX: 0, minY: 0, maxX: geometry.grid.columns + margin * 2, maxY: geometry.grid.rows + margin * 2 };
  const reserved = { minX: puzzle.x - PIECE_OVERHANG, minY: puzzle.y - PIECE_OVERHANG, maxX: puzzle.x + puzzle.width + PIECE_OVERHANG, maxY: puzzle.y + puzzle.height + PIECE_OVERHANG };
  const slots: Array<{ x: number; y: number }> = [];
  for (let y = .32; y + 1 + PIECE_OVERHANG <= bounds.maxY; y += SLOT_DISTANCE) for (let x = .32; x + 1 + PIECE_OVERHANG <= bounds.maxX; x += SLOT_DISTANCE) {
    const pieceBounds = { minX: x - PIECE_OVERHANG, minY: y - PIECE_OVERHANG, maxX: x + 1 + PIECE_OVERHANG, maxY: y + 1 + PIECE_OVERHANG };
    if (!intersects(pieceBounds, reserved)) slots.push({ x, y });
  }
  return { bounds, puzzle, slots };
}

/** Een eindige tafel reserveert het midden voor de afbeelding en genoeg losse,
 * niet-overlappende parkeerplaatsen voor ieder stuk. */
export function puzzleWorktable(geometry: PuzzleGeometry): PuzzleWorktable {
  let margin = 4;
  let table = slotsFor(geometry, margin);
  while (table.slots.length < geometry.pieces.length) { margin += 1; table = slotsFor(geometry, margin); }
  return { ...table, slots: shuffle(table.slots, `${geometry.version}:${geometry.seed}:${geometry.pieces.length}`) };
}

export function groupAnchor(geometry: PuzzleGeometry, group: PuzzleGroup) { return geometry.pieces[group.pieceIds[0]]; }

function rotate(point: { x: number; y: number }, degrees: PuzzleGroup["rotation"]) {
  if (degrees === 0) return point;
  const radians = degrees * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine };
}

/** Bounds relatief aan het anker van de groep, inclusief uitstekende tabs. */
export function groupRelativeBounds(geometry: PuzzleGeometry, group: PuzzleGroup): PuzzleBounds {
  const anchor = groupAnchor(geometry, group); let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const id of group.pieceIds) {
    const piece = geometry.pieces[id]; const offsetX = piece.column - anchor.column; const offsetY = piece.row - anchor.row;
    for (const x of [offsetX - PIECE_OVERHANG, offsetX + 1 + PIECE_OVERHANG]) for (const y of [offsetY - PIECE_OVERHANG, offsetY + 1 + PIECE_OVERHANG]) {
      const rotated = rotate({ x: x - .5, y: y - .5 }, group.rotation); minX = Math.min(minX, rotated.x + .5); minY = Math.min(minY, rotated.y + .5); maxX = Math.max(maxX, rotated.x + .5); maxY = Math.max(maxY, rotated.y + .5);
    }
  }
  return { minX, minY, maxX, maxY };
}

export function groupBounds(geometry: PuzzleGeometry, group: PuzzleGroup): PuzzleBounds {
  const relative = groupRelativeBounds(geometry, group);
  return { minX: group.x + relative.minX, minY: group.y + relative.minY, maxX: group.x + relative.maxX, maxY: group.y + relative.maxY };
}

/** Behoudt de vorm en groepsleden, maar laat de groep niet buiten de tafel verdwijnen. */
export function clampGroupPosition(geometry: PuzzleGeometry, group: PuzzleGroup, x: number, y: number) {
  const relative = groupRelativeBounds(geometry, group); const table = puzzleWorktable(geometry).bounds;
  return {
    x: Math.min(Math.max(x, table.minX - relative.minX), table.maxX - relative.maxX),
    y: Math.min(Math.max(y, table.minY - relative.minY), table.maxY - relative.maxY),
  };
}

/** Zet een world-punt terug in de niet-geroteerde lokale groepsruimte. */
export function worldToGroupLocal(group: PuzzleGroup, point: { x: number; y: number }) {
  const relative = { x: point.x - group.x - .5, y: point.y - group.y - .5 };
  const inverse = rotate(relative, ((360 - group.rotation) % 360) as PuzzleGroup["rotation"]);
  return { x: inverse.x + .5, y: inverse.y + .5 };
}

export function groupMemberAt(geometry: PuzzleGeometry, group: PuzzleGroup, point: { x: number; y: number }) {
  const anchor = groupAnchor(geometry, group); const local = worldToGroupLocal(group, point);
  for (const id of [...group.pieceIds].reverse()) {
    const piece = geometry.pieces[id]; const x = piece.column - anchor.column; const y = piece.row - anchor.row;
    if (local.x >= x - PIECE_OVERHANG && local.x <= x + 1 + PIECE_OVERHANG && local.y >= y - PIECE_OVERHANG && local.y <= y + 1 + PIECE_OVERHANG) return id;
  }
  return null;
}
