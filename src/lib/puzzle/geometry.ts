import { PUZZLE_GEOMETRY_VERSION, puzzleGrid, type PuzzleEdge, type PuzzleGeometry, type PuzzlePieceCount, type PuzzlePieceGeometry } from "@/lib/puzzle/types";

function hash(input: string): number { let value = 2166136261; for (let i = 0; i < input.length; i++) value = Math.imul(value ^ input.charCodeAt(i), 16777619); return value >>> 0; }
function rng(seed: string) { let state = hash(seed) || 1; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 0x1_0000_0000; }; }
function legacyEdge(id: string, random: () => number): PuzzleEdge {
  return { id, tab: random() < .5 ? -1 : 1, position: .38 + random() * .24, width: .22 + random() * .12, depth: .16 + random() * .1, skew: -.12 + random() * .24 };
}

/** Een klassieke tab: breed genoeg voor een afgeronde kop, maar met een
 * smallere hals. De descriptor wordt slechts eenmaal per gedeelde rand
 * gemaakt; beide stukken lezen dus exact dezelfde parameters. */
function classicEdge(id: string, random: () => number): PuzzleEdge {
  return {
    id,
    tab: random() < .5 ? -1 : 1,
    position: .37 + random() * .26,
    width: .34 + random() * .10,
    depth: .20 + random() * .075,
    skew: -.08 + random() * .16,
    neck: .17 + random() * .07,
    roundness: .88 + random() * .18,
  };
}

/** De gedeelde rand wordt precies één keer gemaakt; buren verwijzen naar hetzelfde object. */
export function createPuzzleGeometry(pieceCount: PuzzlePieceCount, seed: string, version = PUZZLE_GEOMETRY_VERSION): PuzzleGeometry {
  if (version !== 1 && version !== PUZZLE_GEOMETRY_VERSION) throw new Error("Onbekende puzzelgeometrieversie.");
  const grid = puzzleGrid(pieceCount); const random = rng(`${version}:${seed}:${pieceCount}`);
  const createEdge = version === 1 ? legacyEdge : classicEdge;
  const vertical = new Map<string, PuzzleEdge>(); const horizontal = new Map<string, PuzzleEdge>();
  const pieces: PuzzlePieceGeometry[] = [];
  for (let row = 0; row < grid.rows; row++) for (let column = 0; column < grid.columns; column++) {
    const id = row * grid.columns + column;
    const top = row === 0 ? null : horizontal.get(`${row - 1}:${column}`)!;
    const left = column === 0 ? null : vertical.get(`${row}:${column - 1}`)!;
    const right = column === grid.columns - 1 ? null : createEdge(`v:${row}:${column}`, random);
    const bottom = row === grid.rows - 1 ? null : createEdge(`h:${row}:${column}`, random);
    if (right) vertical.set(`${row}:${column}`, right); if (bottom) horizontal.set(`${row}:${column}`, bottom);
    pieces.push({ id, column, row, top, right, bottom, left });
  }
  return { version, seed, grid, pieces };
}

export function pieceKind(piece: PuzzlePieceGeometry): "CORNERS" | "EDGES" | "MIDDLES" {
  const boundary = [piece.top, piece.right, piece.bottom, piece.left].filter((edge) => edge === null).length;
  return boundary > 1 ? "CORNERS" : boundary === 1 ? "EDGES" : "MIDDLES";
}

export function areNeighbours(geometry: PuzzleGeometry, a: number, b: number): boolean {
  const one = geometry.pieces[a]; const two = geometry.pieces[b];
  return !!one && !!two && Math.abs(one.column - two.column) + Math.abs(one.row - two.row) === 1;
}

type Point = readonly [number, number];
interface Segment { from: Point; to: Point; controls?: readonly [Point, Point]; }

/** Eén canoniek pad per rand. Bij omkeren wisselen ook de Bézier-controlpunten:
 * alleen het tab-teken omkeren verschuift position/skew bij de tegenligger. */
export function tracePuzzleSide(ctx: CanvasPath, ax: number, ay: number, bx: number, by: number, edge: PuzzleEdge | null, inverse: boolean): void {
  if (!edge) { ctx.lineTo(bx, by); return; }
  const x = inverse ? bx : ax; const y = inverse ? by : ay;
  const dx = inverse ? ax - bx : bx - ax; const dy = inverse ? ay - by : by - ay;
  const point = (along: number, out = 0): Point => [x + dx * along + dy * out, y + dy * along - dx * out];
  const start = edge.position - edge.width / 2; const end = edge.position + edge.width / 2;
  const tab = edge.tab * edge.depth;
  const segments: Segment[] = []; let current = point(0);
  const line = (to: Point) => { segments.push({ from: current, to }); current = to; };
  const curve = (first: Point, second: Point, to: Point) => { segments.push({ from: current, to, controls: [first, second] }); current = to; };
  line(point(start));
  if (edge.neck === undefined) {
    curve(point(start + edge.width * .18), point(edge.position - edge.width * .22, tab), point(edge.position, tab));
    curve(point(edge.position + edge.width * .22, tab), point(end - edge.width * .18), point(end));
  } else {
    const roundness = edge.roundness ?? 1;
    const leftRoot = edge.position - edge.width * (.33 + edge.skew * .10);
    const rightRoot = edge.position + edge.width * (.33 - edge.skew * .10);
    const leftShoulder = edge.position - edge.width * (.22 + edge.skew * .08);
    const rightShoulder = edge.position + edge.width * (.22 - edge.skew * .08);
    curve(point(start + edge.neck), point(leftRoot, tab * .12), point(leftShoulder, tab * .48 * roundness));
    curve(point(edge.position - edge.width * .12, tab * .98), point(edge.position - edge.width * .04, tab), point(edge.position, tab));
    curve(point(edge.position + edge.width * .04, tab), point(edge.position + edge.width * .12, tab * .98), point(rightShoulder, tab * .48 * roundness));
    curve(point(rightRoot, tab * .12), point(end - edge.neck), point(end));
  }
  line(point(1));
  for (const segment of inverse ? segments.reverse() : segments) {
    if (segment.controls) {
      const [first, second] = inverse ? [segment.controls[1], segment.controls[0]] : segment.controls;
      ctx.bezierCurveTo(...first, ...second, ...(inverse ? segment.from : segment.to));
    } else ctx.lineTo(...(inverse ? segment.from : segment.to));
  }
}

/** Lokale stukcoördinaten; top/left volgen exact dezelfde curve achterstevoren. */
export function tracePuzzlePiece(ctx: CanvasPath, piece: PuzzlePieceGeometry): void {
  ctx.moveTo(0, 0);
  tracePuzzleSide(ctx, 0, 0, 1, 0, piece.top, true);
  tracePuzzleSide(ctx, 1, 0, 1, 1, piece.right, false);
  tracePuzzleSide(ctx, 1, 1, 0, 1, piece.bottom, false);
  tracePuzzleSide(ctx, 0, 1, 0, 0, piece.left, true);
  ctx.closePath();
}

/** De echte buitencontour van een groep, inclusief gaten. Interne gedeelde
 * randen verdwijnen uit het pad; de afbeelding krijgt één doorlopende clip. */
export function tracePuzzleGroup(ctx: CanvasPath, geometry: PuzzleGeometry, pieceIds: number[]): void {
  const anchor = geometry.pieces[pieceIds[0]]; const members = new Set(pieceIds);
  type Side = { from: Point; to: Point; edge: PuzzleEdge | null; inverse: boolean; direction: number };
  const sides: Side[] = [];
  const key = (point: Point) => point.join(':');
  for (const id of pieceIds) {
    const piece = geometry.pieces[id]; const x = piece.column - anchor.column; const y = piece.row - anchor.row;
    if (piece.row === 0 || !members.has(id - geometry.grid.columns)) sides.push({ from: [x, y], to: [x + 1, y], edge: piece.top, inverse: true, direction: 0 });
    if (piece.column === geometry.grid.columns - 1 || !members.has(id + 1)) sides.push({ from: [x + 1, y], to: [x + 1, y + 1], edge: piece.right, inverse: false, direction: 1 });
    if (piece.row === geometry.grid.rows - 1 || !members.has(id + geometry.grid.columns)) sides.push({ from: [x + 1, y + 1], to: [x, y + 1], edge: piece.bottom, inverse: false, direction: 2 });
    if (piece.column === 0 || !members.has(id - 1)) sides.push({ from: [x, y + 1], to: [x, y], edge: piece.left, inverse: true, direction: 3 });
  }
  const outgoing = new Map<string, Side[]>();
  for (const side of sides) outgoing.set(key(side.from), [...(outgoing.get(key(side.from)) ?? []), side]);
  const remaining = new Set(sides);
  while (remaining.size) {
    const first = remaining.values().next().value!; let side = first;
    ctx.moveTo(...first.from);
    while (true) {
      remaining.delete(side);
      tracePuzzleSide(ctx, ...side.from, ...side.to, side.edge, side.inverse);
      if (key(side.to) === key(first.from)) break;
      const candidates = (outgoing.get(key(side.to)) ?? []).filter((candidate) => remaining.has(candidate));
      // Houd de groepsbinnenkant rechts, ook waar twee contouren een hoek delen.
      const priority = [1, 0, 3, 2];
      candidates.sort((a, b) => priority.indexOf((a.direction - side.direction + 4) % 4) - priority.indexOf((b.direction - side.direction + 4) % 4));
      if (!candidates[0]) throw new Error('Onvolledige groepscontour.');
      side = candidates[0];
    }
    ctx.closePath();
  }
}

interface CanvasPath { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void; closePath(): void; }
