import { areNeighbours } from "@/lib/puzzle/geometry";
import { puzzlePolicy, PUZZLE_RULES_VERSION, type PuzzleDifficulty, type PuzzleGeometry, type PuzzleGroup, type PuzzleSnapshot } from "@/lib/puzzle/types";
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
  const next = cloneSnapshot(snapshot); const group = next.groups.find((item) => item.id === groupId); if (!group || group.anchored || next.completedAt) return snapshot;
  const position = clampGroupPosition(geometry, group, x, y); group.x = position.x; group.y = position.y; return next;
}
export function rotateGroup(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, groupId: string): PuzzleSnapshot {
  const next = cloneSnapshot(snapshot); const group = next.groups.find((item) => item.id === groupId); if (!group || group.anchored || next.completedAt) return snapshot;
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
  if (one.anchored || two.anchored) target.anchored = true;
  // De drag kan een los stuk tot aan de tafelrand brengen. Na de fusie is de
  // relatieve bounding box groter; klem hem opnieuw zodat de nieuw gevormde
  // groep niet deels buiten de enige bereikbare wereld terechtkomt.
  const position = clampGroupPosition(geometry, target, target.x, target.y);
  target.x = position.x; target.y = position.y;
  next.groups = next.groups.filter((g) => g.id !== removed.id);
  next.connections.push({ a: Math.min(a, b), b: Math.max(a, b) });
  return next;
}
/** Probeert uitsluitend een canonieke buurrelatie op relatieve world-positie te verbinden. */
export function connectGroups(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, difficulty: PuzzleDifficulty, a: number, b: number, rulesVersion = PUZZLE_RULES_VERSION): PuzzleSnapshot {
  if (snapshot.completedAt || !validPuzzleStructure(snapshot, geometry, difficulty, rulesVersion)) return snapshot;
  if (!areNeighbours(geometry, a, b) || snapshot.connections.some((c) => connectionKey(c.a, c.b) === connectionKey(a, b))) return snapshot;
  let one = groupFor(snapshot, a); let two = groupFor(snapshot, b); if (!one || !two || one === two || one.rotation !== 0 || two.rotation !== 0) return snapshot;
  const aw = worldOf(geometry, one, a); const bw = worldOf(geometry, two, b); const pa = geometry.pieces[a]; const pb = geometry.pieces[b]; const wantedX = pb.column - pa.column; const wantedY = pb.row - pa.row;
  if (Math.hypot((bw.x - aw.x) - wantedX, (bw.y - aw.y) - wantedY) > puzzlePolicy(difficulty, rulesVersion).snap) return snapshot;
  // Een bordanker mag ook bij omgekeerde clientvolgorde nooit verspringen.
  if (two.anchored && !one.anchored) { [one, two] = [two, one]; [a, b] = [b, a]; }
  const joined = merge(snapshot, one, two, a, b, geometry);
  return finishPuzzle(joined.groups.some((group) => group.anchored) ? joinAnchoredGroups(joined, geometry) : joined, geometry, difficulty, rulesVersion);
}
export function findSnapConnection(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, difficulty: PuzzleDifficulty, movedGroupId: string, rulesVersion = PUZZLE_RULES_VERSION) {
  const moved = snapshot.groups.find((group) => group.id === movedGroupId);
  if (!moved || moved.anchored || moved.rotation !== 0) return null;
  let candidate: { a: number; b: number; error: number } | null = null;
  for (const a of moved.pieceIds) for (const b of geometry.pieces.map((piece) => piece.id)) {
    if (!areNeighbours(geometry, a, b)) continue;
    const other = groupFor(snapshot, b); if (!other || other.id === moved.id || other.rotation !== 0) continue;
    const aw = worldOf(geometry, moved, a); const bw = worldOf(geometry, other, b); const pa = geometry.pieces[a]; const pb = geometry.pieces[b];
    const error = Math.hypot((bw.x - aw.x) - (pb.column - pa.column), (bw.y - aw.y) - (pb.row - pa.row));
    // merge behoudt groep a. De stilstaande buur is dus het anker; het
    // versleepte stuk/de groep valt daarna exact naar zijn canonieke positie.
    if (error <= puzzlePolicy(difficulty, rulesVersion).snap && (!candidate || error < candidate.error)) candidate = { a: b, b: a, error };
  }
  return candidate;
}
export function connectedPieces(snapshot: PuzzleSnapshot) { return snapshot.groups.filter((group) => group.pieceIds.length > 1).reduce((total, group) => total + group.pieceIds.length, 0); }


/** Canonieke bordpositie hangt uitsluitend af van definitie en groepsanker. */
export function boardPosition(geometry: PuzzleGeometry, group: PuzzleGroup) {
  const board = puzzleWorktable(geometry).puzzle; const anchor = groupAnchor(geometry, group);
  return { x: board.x + anchor.column, y: board.y + anchor.row };
}

/** Bewijs iedere groep via een acyclische boom; geen timestamp/positieclaims. */
export function validPuzzleStructure(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, difficulty: PuzzleDifficulty, rulesVersion = PUZZLE_RULES_VERSION): boolean {
  const policy = puzzlePolicy(difficulty, rulesVersion); const count = geometry.pieces.length;
  const owner = new Map<number, string>(); const ids = new Set<string>();
  const parent = Array.from({ length: count }, (_, i) => i);
  const root = (id: number): number => { while (parent[id] !== id) id = parent[id]; return id; };
  for (const group of snapshot.groups) {
    if (!group.pieceIds.length || ids.has(group.id) || !Number.isFinite(group.x) || !Number.isFinite(group.y) || ![0, 90, 180, 270].includes(group.rotation)) return false;
    ids.add(group.id);
    for (const id of group.pieceIds) { if (!Number.isInteger(id) || id < 0 || id >= count || owner.has(id)) return false; owner.set(id, group.id); }
    if (group.anchored) { const to = boardPosition(geometry, group); if (!policy.boardSnap || group.rotation !== 0 || Math.hypot(group.x - to.x, group.y - to.y) > 1e-9) return false; }
  }
  if (owner.size !== count || snapshot.connections.length !== count - snapshot.groups.length) return false;
  for (const { a, b } of snapshot.connections) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || !owner.has(a) || !owner.has(b) || owner.get(a) !== owner.get(b) || !areNeighbours(geometry, a, b) || root(a) === root(b)) return false;
    parent[root(b)] = root(a);
  }
  return snapshot.groups.every((group) => group.pieceIds.every((id) => root(id) === root(group.pieceIds[0])));
}

export function isPuzzleComplete(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, difficulty: PuzzleDifficulty, rulesVersion = PUZZLE_RULES_VERSION) {
  return validPuzzleStructure(snapshot, geometry, difficulty, rulesVersion) && snapshot.groups.every((group) => group.rotation === 0) &&
    (snapshot.groups.length === 1 || snapshot.groups.every((group) => group.anchored === true));
}
function finishPuzzle(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, difficulty: PuzzleDifficulty, rulesVersion: number) {
  return isPuzzleComplete(snapshot, geometry, difficulty, rulesVersion) ? { ...snapshot, completedAt: snapshot.completedAt ?? new Date().toISOString() } : snapshot;
}

export function boardSnapTarget(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, difficulty: PuzzleDifficulty, groupId: string, rulesVersion = PUZZLE_RULES_VERSION) {
  const policy = puzzlePolicy(difficulty, rulesVersion); const group = snapshot.groups.find((candidate) => candidate.id === groupId);
  if (!policy.boardSnap || !group || group.anchored || group.rotation !== 0 || snapshot.completedAt || !validPuzzleStructure(snapshot, geometry, difficulty, rulesVersion)) return null;
  const to = boardPosition(geometry, group);
  return Math.hypot(group.x - to.x, group.y - to.y) <= policy.boardSnapDistance ? to : null;
}
function joinAnchoredGroups(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry) {
  let current = snapshot;
  while (true) {
    let pair: { one: PuzzleGroup; two: PuzzleGroup; a: number; b: number } | null = null;
    for (const one of current.groups.filter((group) => group.anchored)) {
      for (const a of one.pieceIds) {
        for (const piece of geometry.pieces) { const two = groupFor(current, piece.id); if (two?.anchored && two !== one && areNeighbours(geometry, a, piece.id)) { pair = { one, two, a, b: piece.id }; break; } }
        if (pair) break;
      }
      if (pair) break;
    }
    if (!pair) return current;
    current = merge(current, pair.one, pair.two, pair.a, pair.b, geometry);
  }
}

/** Afzonderlijke server-gevalideerde plaatsing; bestaande verbindingen blijven. */
export function anchorGroup(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, difficulty: PuzzleDifficulty, groupId: string, rulesVersion = PUZZLE_RULES_VERSION): PuzzleSnapshot {
  const to = boardSnapTarget(snapshot, geometry, difficulty, groupId, rulesVersion); if (!to) return snapshot;
  const next = cloneSnapshot(snapshot); const group = next.groups.find((candidate) => candidate.id === groupId)!;
  Object.assign(group, to, { anchored: true });
  return finishPuzzle(joinAnchoredGroups(next, geometry), geometry, difficulty, rulesVersion);
}
