import { areNeighbours, pieceKind } from "@/lib/puzzle/geometry";
import { boardPosition, groupFor, worldOf } from "@/lib/puzzle/engine";
import { puzzlePolicy, type PuzzleDifficulty, type PuzzleFilter, type PuzzleGeometry, type PuzzleHint, type PuzzleHintTarget, type PuzzleHintType, type PuzzleSnapshot } from "@/lib/puzzle/types";

/** Alleen visuele hulp: een target verandert geen positie of verbinding. */
export function puzzleHintTarget(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, type: PuzzleHintType, pieceId?: number, filter?: PuzzleFilter): PuzzleHintTarget | null {
  if (type === "PREVIEW") return { type };
  if (type === "FILTER") return filter ? { type, filter, pieceIds: geometry.pieces.filter((piece) => pieceKind(piece) === filter).map((piece) => piece.id) } : null;
  const group = pieceId === undefined ? undefined : groupFor(snapshot, pieceId);
  if (!group) return null;
  if (type === "LOCATION") return { type, groupId: group.id, pieceIds: [...group.pieceIds], ...boardPosition(geometry, group) };
  // Zoek echte externe buren voor de hele groep, niet alleen het eerste stuk.
  const candidates = group.pieceIds.flatMap((id) => geometry.pieces.flatMap((piece) => {
    const neighbor = groupFor(snapshot, piece.id);
    if (!neighbor || neighbor.id === group.id || !areNeighbours(geometry, id, piece.id)) return [];
    const a = worldOf(geometry, group, id); const b = worldOf(geometry, neighbor, piece.id);
    return [{ pieceId: id, neighborId: piece.id, neighborGroupId: neighbor.id, distance: Math.hypot(a.x - b.x, a.y - b.y) }];
  })).sort((a, b) => a.distance - b.distance || a.pieceId - b.pieceId || a.neighborId - b.neighborId);
  const target = candidates[0];
  return target ? { type: "CONNECTION", groupId: group.id, pieceId: target.pieceId, neighborId: target.neighborId, neighborGroupId: target.neighborGroupId } : null;
}

export function activePuzzleHint(snapshot: PuzzleSnapshot, now = Date.now()): PuzzleHint | null {
  return [...snapshot.hints].reverse().find((hint) => hint.target && hint.expiresAt && Date.parse(hint.expiresAt) > now) ?? null;
}

export function puzzleHintBudget(snapshot: PuzzleSnapshot, difficulty: PuzzleDifficulty, rulesVersion?: number) {
  const included = puzzlePolicy(difficulty, rulesVersion).includedHints;
  return { remaining: included === null ? null : Math.max(0, included - snapshot.hints.length), used: snapshot.hints.length, extra: snapshot.hints.filter((hint) => hint.extra).length };
}
