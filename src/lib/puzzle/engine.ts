import { areNeighbours } from "@/lib/puzzle/geometry";
import { PUZZLE_DIFFICULTIES, type PuzzleDifficulty, type PuzzleGeometry, type PuzzleGroup, type PuzzleSnapshot } from "@/lib/puzzle/types";
import { clampGroupPosition, groupAnchor, puzzleWorktable } from "@/lib/puzzle/worktable";

const connectionKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
export function newPuzzleSnapshot(geometry: PuzzleGeometry, difficulty: PuzzleDifficulty): PuzzleSnapshot {
  const table = puzzleWorktable(geometry);
  const groups: PuzzleGroup[] = geometry.pieces.map((piece, index) => {
    const slot = table.slots[index];
    return { id: `p${piece.id}`, pieceIds: [piece.id], x: slot.x, y: slot.y, rotation: difficulty === "MASTER" ? ([0, 90, 180, 270][index % 4] as 0 | 90 | 180 | 270) : 0 };
  });
  return { version: 1, groups, connections: [], hints: [], filter: null, completedAt: null };
}
export function cloneSnapshot(snapshot: PuzzleSnapshot): PuzzleSnapshot { return JSON.parse(JSON.stringify(snapshot)) as PuzzleSnapshot; }
export function groupFor(snapshot: PuzzleSnapshot, pieceId: number) { return snapshot.groups.find((group) => group.pieceIds.includes(pieceId)); }
export function moveGroup(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, groupId: string, x: number, y: number): PuzzleSnapshot {
  const next = cloneSnapshot(snapshot); const group = next.groups.find((item) => item.id === groupId); if (!group || next.completedAt) return snapshot;
  const position = clampGroupPosition(geometry, group, x, y); group.x = position.x; group.y = position.y; return next;
}
export function rotateGroup(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, groupId: string): PuzzleSnapshot {
  const next = cloneSnapshot(snapshot); const group = next.groups.find((item) => item.id === groupId); if (!group || next.completedAt) return snapshot;
  group.rotation = ((group.rotation + 90) % 360) as 0 | 90 | 180 | 270;
  const position = clampGroupPosition(geometry, group, group.x, group.y); group.x = position.x; group.y = position.y;
  return next;
}
export function worldOf(geometry: PuzzleGeometry, group: PuzzleGroup, piece: number) { const p = geometry.pieces[piece]; const anchor = groupAnchor(geometry, group); return { x: group.x + p.column - anchor.column, y: group.y + p.row - anchor.row }; }
function merge(snapshot: PuzzleSnapshot, one: PuzzleGroup, two: PuzzleGroup, a: number, b: number, geometry: PuzzleGeometry) {
  const next = cloneSnapshot(snapshot); const target = next.groups.find((g) => g.id === one.id)!; const removed = next.groups.find((g) => g.id === two.id)!;
  // De relatieve positie is net gevalideerd; de coördinaten van het eerste stuk
  // van target blijven het anker voor de samengevoegde groep.
  // De eerste entry is het anker van de groep. Sorteer hem nooit tijdens een
  // fusie: dat zou dezelfde x/y daarna aan een ander stuk koppelen.
  target.pieceIds = [...target.pieceIds, ...removed.pieceIds]; target.rotation = 0;
  // De drag kan een los stuk tot aan de tafelrand brengen. Na de fusie is de
  // relatieve bounding box groter; klem hem opnieuw zodat de nieuw gevormde
  // groep niet deels buiten de enige bereikbare wereld terechtkomt.
  const position = clampGroupPosition(geometry, target, target.x, target.y);
  target.x = position.x; target.y = position.y;
  next.groups = next.groups.filter((g) => g.id !== removed.id);
  next.connections.push({ a: Math.min(a, b), b: Math.max(a, b) });
  if (next.groups.length === 1 && next.connections.length === geometry.pieces.length - 1) next.completedAt = new Date().toISOString();
  return next;
}
/** Probeert uitsluitend een canonieke buurrelatie op relatieve world-positie te verbinden. */
export function connectGroups(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, difficulty: PuzzleDifficulty, a: number, b: number): PuzzleSnapshot {
  if (!areNeighbours(geometry, a, b) || snapshot.connections.some((c) => connectionKey(c.a, c.b) === connectionKey(a, b))) return snapshot;
  const one = groupFor(snapshot, a); const two = groupFor(snapshot, b); if (!one || !two || one === two || one.rotation !== 0 || two.rotation !== 0) return snapshot;
  const aw = worldOf(geometry, one, a); const bw = worldOf(geometry, two, b); const pa = geometry.pieces[a]; const pb = geometry.pieces[b]; const wantedX = pb.column - pa.column; const wantedY = pb.row - pa.row;
  if (Math.hypot((bw.x - aw.x) - wantedX, (bw.y - aw.y) - wantedY) > PUZZLE_DIFFICULTIES[difficulty].snap) return snapshot;
  return merge(snapshot, one, two, a, b, geometry);
}
export function findSnapConnection(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, difficulty: PuzzleDifficulty, movedGroupId: string) {
  const moved = snapshot.groups.find((group) => group.id === movedGroupId);
  if (!moved || moved.rotation !== 0) return null;
  let candidate: { a: number; b: number; error: number } | null = null;
  for (const a of moved.pieceIds) for (const b of geometry.pieces.map((piece) => piece.id)) {
    if (!areNeighbours(geometry, a, b)) continue;
    const other = groupFor(snapshot, b); if (!other || other.id === moved.id || other.rotation !== 0) continue;
    const aw = worldOf(geometry, moved, a); const bw = worldOf(geometry, other, b); const pa = geometry.pieces[a]; const pb = geometry.pieces[b];
    const error = Math.hypot((bw.x - aw.x) - (pb.column - pa.column), (bw.y - aw.y) - (pb.row - pa.row));
    if (error <= PUZZLE_DIFFICULTIES[difficulty].snap && (!candidate || error < candidate.error)) candidate = { a, b, error };
  }
  return candidate;
}
export function connectedPieces(snapshot: PuzzleSnapshot) { return snapshot.groups.filter((group) => group.pieceIds.length > 1).reduce((total, group) => total + group.pieceIds.length, 0); }
