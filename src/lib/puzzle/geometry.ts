import { PUZZLE_GEOMETRY_VERSION, puzzleGrid, type PuzzleEdge, type PuzzleGeometry, type PuzzlePieceCount, type PuzzlePieceGeometry } from "@/lib/puzzle/types";

function hash(input: string): number { let value = 2166136261; for (let i = 0; i < input.length; i++) value = Math.imul(value ^ input.charCodeAt(i), 16777619); return value >>> 0; }
function rng(seed: string) { let state = hash(seed) || 1; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; }; }
function edge(id: string, random: () => number): PuzzleEdge { return { id, tab: random() < .5 ? -1 : 1, position: .38 + random() * .24, width: .22 + random() * .12, depth: .16 + random() * .1, skew: -.12 + random() * .24 }; }

/** De gedeelde rand wordt precies één keer gemaakt; buren verwijzen naar hetzelfde object. */
export function createPuzzleGeometry(pieceCount: PuzzlePieceCount, seed: string, version = PUZZLE_GEOMETRY_VERSION): PuzzleGeometry {
  if (version !== PUZZLE_GEOMETRY_VERSION) throw new Error("Onbekende puzzelgeometrieversie.");
  const grid = puzzleGrid(pieceCount); const random = rng(`${version}:${seed}:${pieceCount}`);
  const vertical = new Map<string, PuzzleEdge>(); const horizontal = new Map<string, PuzzleEdge>();
  const pieces: PuzzlePieceGeometry[] = [];
  for (let row = 0; row < grid.rows; row++) for (let column = 0; column < grid.columns; column++) {
    const id = row * grid.columns + column;
    const top = row === 0 ? null : horizontal.get(`${row - 1}:${column}`)!;
    const left = column === 0 ? null : vertical.get(`${row}:${column - 1}`)!;
    const right = column === grid.columns - 1 ? null : edge(`v:${row}:${column}`, random);
    const bottom = row === grid.rows - 1 ? null : edge(`h:${row}:${column}`, random);
    if (right) vertical.set(`${row}:${column}`, right); if (bottom) horizontal.set(`${row}:${column}`, bottom);
    pieces.push({ id, column, row, top, right, bottom, left });
  }
  return { version, seed, grid, pieces };
}

export function pieceKind(piece: PuzzlePieceGeometry, geometry: PuzzleGeometry): "CORNERS" | "EDGES" | "MIDDLES" {
  const boundary = [piece.top, piece.right, piece.bottom, piece.left].filter((edge) => edge === null).length;
  return boundary > 1 ? "CORNERS" : boundary === 1 ? "EDGES" : "MIDDLES";
}

export function areNeighbours(geometry: PuzzleGeometry, a: number, b: number): boolean {
  const one = geometry.pieces[a]; const two = geometry.pieces[b];
  return !!one && !!two && Math.abs(one.column - two.column) + Math.abs(one.row - two.row) === 1;
}

/** Tekenpad in lokale stukcoördinaten. Dezelfde edge krijgt bij de buur de
 * omgekeerde looprichting, zodat tab en inkeping werkelijk complementair zijn. */
export function tracePuzzlePiece(ctx: CanvasPath, piece: PuzzlePieceGeometry): void {
  const side = (ax: number, ay: number, bx: number, by: number, edge: PuzzleEdge | null, inverse: boolean) => {
    if (!edge) { ctx.lineTo(bx, by); return; }
    const dx = bx - ax; const dy = by - ay; const nx = dy; const ny = -dx;
    const start = edge.position - edge.width / 2; const end = edge.position + edge.width / 2; const tab = edge.tab * (inverse ? -1 : 1) * edge.depth;
    const point = (along: number, out = 0) => [ax + dx * along + nx * out, ay + dy * along + ny * out] as const;
    const line = point(start); const c1 = point(start + edge.width * .18); const c2 = point(edge.position - edge.width * .22, tab); const middle = point(edge.position, tab);
    const c3 = point(edge.position + edge.width * .22, tab); const c4 = point(end - edge.width * .18); const finish = point(end); ctx.lineTo(...line); ctx.bezierCurveTo(...c1, ...c2, ...middle); ctx.bezierCurveTo(...c3, ...c4, ...finish); ctx.lineTo(bx, by);
  };
  ctx.moveTo(0, 0); side(0, 0, 1, 0, piece.top, true); side(1, 0, 1, 1, piece.right, false); side(1, 1, 0, 1, piece.bottom, false); side(0, 1, 0, 0, piece.left, true); ctx.closePath();
}

interface CanvasPath { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void; closePath(): void; }
