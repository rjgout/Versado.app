import { areNeighbours } from "@/lib/puzzle/geometry";
import { PUZZLE_DIFFICULTIES, type PuzzleConnection, type PuzzleDifficulty, type PuzzleGeometry, type PuzzleGroup, type PuzzleSnapshot } from "@/lib/puzzle/types";

const connectionKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
export function newPuzzleSnapshot(geometry: PuzzleGeometry, difficulty: PuzzleDifficulty): PuzzleSnapshot {
  const groups: PuzzleGroup[] = geometry.pieces.map((piece, index) => ({ id: `p${piece.id}`, pieceIds: [piece.id], x: geometry.grid.columns + 1 + (index % 5) * 1.25, y: (Math.floor(index / 5) % Math.max(1, geometry.grid.rows)) * 1.2, rotation: difficulty === "MASTER" ? ([0, 90, 180, 270][index % 4] as 0 | 90 | 180 | 270) : 0 }));
  return { version: 1, groups, connections: [], hints: [], filter: null, completedAt: null };
}
export function cloneSnapshot(snapshot: PuzzleSnapshot): PuzzleSnapshot { return JSON.parse(JSON.stringify(snapshot)) as PuzzleSnapshot; }
export function groupFor(snapshot: PuzzleSnapshot, pieceId: number) { return snapshot.groups.find((group) => group.pieceIds.includes(pieceId)); }
export function moveGroup(snapshot: PuzzleSnapshot, groupId: string, x: number, y: number): PuzzleSnapshot { const next = cloneSnapshot(snapshot); const group = next.groups.find((item) => item.id === groupId); if (!group || next.completedAt) return snapshot; group.x = x; group.y = y; return next; }
export function rotateGroup(snapshot: PuzzleSnapshot, groupId: string): PuzzleSnapshot { const next = cloneSnapshot(snapshot); const group = next.groups.find((item) => item.id === groupId); if (!group || next.completedAt) return snapshot; group.rotation = ((group.rotation + 90) % 360) as 0 | 90 | 180 | 270; return next; }
function worldOf(geometry: PuzzleGeometry, group: PuzzleGroup, piece: number) { const p = geometry.pieces[piece]; const first = geometry.pieces[group.pieceIds[0]]; return { x: group.x + p.column - first.column, y: group.y + p.row - first.row }; }
function merge(snapshot: PuzzleSnapshot, one: PuzzleGroup, two: PuzzleGroup, a: number, b: number, geometry: PuzzleGeometry) {
  const next = cloneSnapshot(snapshot); const target = next.groups.find((g) => g.id === one.id)!; const removed = next.groups.find((g) => g.id === two.id)!;
  // De relatieve positie is net gevalideerd; de coördinaten van het eerste stuk
  // van target blijven het anker voor de samengevoegde groep.
  target.pieceIds = [...target.pieceIds, ...removed.pieceIds].sort((x, y) => x - y); target.rotation = 0;
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
export function connectedPieces(snapshot: PuzzleSnapshot) { return snapshot.connections.length + (snapshot.connections.length > 0 ? 1 : 0); }
