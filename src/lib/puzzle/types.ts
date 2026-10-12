/**
 * Versie 1 gebruikte een generieke, golvende Bézier-rand. Nieuwe sessies
 * krijgen versie 2: een klassieke tab met een smalle hals en ronde kop.
 * Oude sessies houden hun definitie én dus hun vorm bij versie 1.
 */
export const PUZZLE_GEOMETRY_VERSION = 2;
export const PUZZLE_RULES_VERSION = 2;
export const SOLO_PIECE_COUNTS = [6, 12, 24, 48, 96] as const;
/** Samen: grotere puzzels, omdat meerdere spelers tegelijk of verspreid over dagen puzzelen. */
export const COOP_PIECE_COUNTS = [24, 48, 96, 150, 300] as const;
/** Tegen elkaar: dezelfde tijdvergelijkbare maten als Solo. */
export const MATCH_PIECE_COUNTS = [6, 12, 24, 48, 96] as const;
export type PuzzlePieceCount = (typeof SOLO_PIECE_COUNTS)[number] | (typeof COOP_PIECE_COUNTS)[number];
export type PuzzleDifficulty = "DISCOVERER" | "ADVENTURER" | "EXPERT" | "MASTER";
export type PuzzleHintType = "PREVIEW" | "LOCATION" | "CONNECTION" | "FILTER";
export type PuzzleFilter = "CORNERS" | "EDGES" | "MIDDLES" | null;

export interface PuzzleGrid { columns: number; rows: number; }
export interface PuzzleEdge {
  id: string;
  tab: 1 | -1;
  position: number;
  width: number;
  depth: number;
  skew: number;
  /** Alleen vanaf geometry v2; optioneel voor opgeslagen v1-sessies. */
  neck?: number;
  roundness?: number;
}
export interface PuzzlePieceGeometry { id: number; column: number; row: number; top: PuzzleEdge | null; right: PuzzleEdge | null; bottom: PuzzleEdge | null; left: PuzzleEdge | null; }
export interface PuzzleGeometry { version: number; seed: string; grid: PuzzleGrid; pieces: PuzzlePieceGeometry[]; }
export interface PuzzleGroup { id: string; pieceIds: number[]; x: number; y: number; rotation: 0 | 90 | 180 | 270; anchored?: boolean; }
export interface PuzzleConnection { a: number; b: number; }
export interface PuzzleSnapshot { version: number; groups: PuzzleGroup[]; connections: PuzzleConnection[]; hints: PuzzleHint[]; filter: PuzzleFilter; completedAt: string | null; }

const LEGACY_DIFFICULTIES = {
  // World-units, dus niet afhankelijk van de actuele zoom. Een stukje is
  // één world-unit breed; deze marges zijn bewust comfortabel voor touch.
  DISCOVERER: { includedHints: null, snap: 0.42, showGhost: true, showOutline: true, showPieceContours: true, rotationRequired: false },
  ADVENTURER: { includedHints: 3, snap: 0.32, showGhost: false, showOutline: true, showPieceContours: false, rotationRequired: false },
  EXPERT: { includedHints: 2, snap: 0.24, showGhost: false, showOutline: true, showPieceContours: false, rotationRequired: false },
  MASTER: { includedHints: 1, snap: 0.20, showGhost: false, showOutline: false, showPieceContours: false, rotationRequired: true },
};

export type PuzzleHintTarget =
  | { type: "PREVIEW" }
  | { type: "LOCATION"; groupId: string; pieceIds: number[]; x: number; y: number }
  | { type: "CONNECTION"; groupId: string; pieceId: number; neighborId: number; neighborGroupId: string }
  | { type: "FILTER"; filter: Exclude<PuzzleFilter, null>; pieceIds: number[] };
export interface PuzzleHint { type: PuzzleHintType; at: string; extra: boolean; source?: "INCLUDED" | "PERSONAL"; actionId?: string; expiresAt?: string; target?: PuzzleHintTarget; }
export const PUZZLE_HINT_DURATION_MS = 5000;
export const PUZZLE_SNAP_DISTANCE = .36;
export type PuzzlePolicy = { includedHints: number | null; snap: number; boardSnap: boolean; boardSnapDistance: number; showGhost: boolean; showOutline: boolean; showPieceContours: boolean; rotationRequired: boolean };
export const PUZZLE_DIFFICULTIES: Record<PuzzleDifficulty, PuzzlePolicy> = {
  DISCOVERER: { ...LEGACY_DIFFICULTIES.DISCOVERER, snap: PUZZLE_SNAP_DISTANCE, boardSnap: true, boardSnapDistance: .36 },
  ADVENTURER: { ...LEGACY_DIFFICULTIES.ADVENTURER, snap: PUZZLE_SNAP_DISTANCE, boardSnap: true, boardSnapDistance: .36 },
  EXPERT: { ...LEGACY_DIFFICULTIES.EXPERT, snap: PUZZLE_SNAP_DISTANCE, boardSnap: false, boardSnapDistance: .36, showOutline: false },
  MASTER: { ...LEGACY_DIFFICULTIES.MASTER, snap: PUZZLE_SNAP_DISTANCE, boardSnap: false, boardSnapDistance: .36 },
};

/** Een hervatte oude variant houdt zijn oorspronkelijke spelregels. */
export function puzzlePolicy(difficulty: PuzzleDifficulty, rulesVersion = PUZZLE_RULES_VERSION): PuzzlePolicy {
  if (rulesVersion === 1) return { ...LEGACY_DIFFICULTIES[difficulty], boardSnap: false, boardSnapDistance: 0 };
  if (rulesVersion !== PUZZLE_RULES_VERSION) throw new Error("Onbekende puzzelregelversie.");
  return PUZZLE_DIFFICULTIES[difficulty];
}

export function puzzleGrid(pieces: PuzzlePieceCount): PuzzleGrid {
  const columns = { 6: 3, 12: 4, 24: 6, 48: 8, 96: 12, 150: 15, 300: 20 }[pieces];
  return { columns, rows: pieces / columns };
}
