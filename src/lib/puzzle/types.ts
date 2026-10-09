export const PUZZLE_GEOMETRY_VERSION = 1;
export const PUZZLE_RULES_VERSION = 1;
export const SOLO_PIECE_COUNTS = [6, 12, 24, 48, 96] as const;
export type PuzzlePieceCount = (typeof SOLO_PIECE_COUNTS)[number];
export type PuzzleDifficulty = "DISCOVERER" | "ADVENTURER" | "EXPERT" | "MASTER";
export type PuzzleHintType = "PREVIEW" | "LOCATION" | "CONNECTION" | "FILTER";
export type PuzzleFilter = "CORNERS" | "EDGES" | "MIDDLES" | null;

export interface PuzzleGrid { columns: number; rows: number; }
export interface PuzzleEdge { id: string; tab: 1 | -1; position: number; width: number; depth: number; skew: number; }
export interface PuzzlePieceGeometry { id: number; column: number; row: number; top: PuzzleEdge | null; right: PuzzleEdge | null; bottom: PuzzleEdge | null; left: PuzzleEdge | null; }
export interface PuzzleGeometry { version: number; seed: string; grid: PuzzleGrid; pieces: PuzzlePieceGeometry[]; }
export interface PuzzleGroup { id: string; pieceIds: number[]; x: number; y: number; rotation: 0 | 90 | 180 | 270; }
export interface PuzzleConnection { a: number; b: number; }
export interface PuzzleSnapshot { version: number; groups: PuzzleGroup[]; connections: PuzzleConnection[]; hints: Array<{ type: PuzzleHintType; at: string; extra: boolean }>; filter: PuzzleFilter; completedAt: string | null; }

export const PUZZLE_DIFFICULTIES: Record<PuzzleDifficulty, { includedHints: number | null; snap: number; showGhost: boolean; showOutline: boolean; showPieceContours: boolean; rotationRequired: boolean }> = {
  DISCOVERER: { includedHints: null, snap: 0.28, showGhost: true, showOutline: true, showPieceContours: true, rotationRequired: false },
  ADVENTURER: { includedHints: 3, snap: 0.18, showGhost: false, showOutline: true, showPieceContours: false, rotationRequired: false },
  EXPERT: { includedHints: 2, snap: 0.12, showGhost: false, showOutline: true, showPieceContours: false, rotationRequired: false },
  MASTER: { includedHints: 1, snap: 0.1, showGhost: false, showOutline: false, showPieceContours: false, rotationRequired: true },
};

export function puzzleGrid(pieces: PuzzlePieceCount): PuzzleGrid {
  const columns = { 6: 3, 12: 4, 24: 6, 48: 8, 96: 12 }[pieces];
  return { columns, rows: pieces / columns };
}
