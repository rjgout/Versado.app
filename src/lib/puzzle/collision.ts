import { boardSnapTarget, findSnapConnection } from "@/lib/puzzle/engine";
import type { PuzzleDifficulty, PuzzleGeometry, PuzzleGroup, PuzzleSnapshot } from "@/lib/puzzle/types";
import { PUZZLE_RULES_VERSION } from "@/lib/puzzle/types";
import { groupAnchor, puzzleWorktable, type PuzzleBounds } from "@/lib/puzzle/worktable";

// Botsingen tussen groepen en het rustig ruimte maken ("settle").
//
// Dit is de enige plek die bepaalt wanneer twee groepen ongewenst overlappen en waar een groep dan heen schuift. Client
// en server gebruiken exact dezelfde functie, maar de server is de enige die de uitkomst vastlegt: een client gebruikt
// `planSettle` alleen om te weten of een serveractie zin heeft (geen netwerkverkeer zonder botsing).
//
// Uitgangspunten (volgorde = prioriteit):
//  1. Een geldige snap of bordverankering gaat altijd voor: kan de groep nog verbinden, dan verplaatst dit bestand niets.
//  2. Vastgezette groepen en groepen die iemand vasthoudt (`immovable`) bewegen nooit.
//  3. De laatst neergelegde groep (`focusGroupId`) blijft liggen, tenzij ze op een onbeweeglijke groep ligt: dan zoekt zij zelf
//     de dichtstbijzijnde vrije plek.
//  4. Anders wijken de overlappende groepen uit, zo weinig mogelijk en zo kort mogelijk.
// De uitkomst is een pure functie van snapshot + opties (vaste volgorde, vaste tie-breakers): geen toeval, geen tijd.
// Een verbonden groep is één onderdeel; de verbindingen en het anker blijven onaangeroerd.

/** Hoeveel (in beide richtingen) twee stukkernen moeten overlappen voordat het een ongewenste botsing heet. */
export const DETECT_PENETRATION = 0.22;
/** Marge rond een stuk bij het kiezen van een nieuwe plek: de nieuwe plek is altijd strenger dan de detectie (geen heen-en-weer). */
export const PLACEMENT_CLEARANCE = 0.04;

export interface SettleLimits {
  /** Rasterstap van de zoektocht naar een vrije plek, in stukbreedtes. */
  step: number;
  /** Verste verplaatsing van één groep. Een groep blijft zo altijd dicht bij waar de speler hem liet liggen. */
  maxRadius: number;
  /** Zoekstraal als een groep een andere beweeglijke groep mag verdringen (korte kettingreactie). */
  chainRadius: number;
  /** Maximum aantal verplaatste groepen per settle. */
  maxMoves: number;
  /** Maximale diepte van een kettingreactie. */
  maxDepth: number;
}
export const DEFAULT_SETTLE_LIMITS: SettleLimits = { step: 0.5, maxRadius: 6, chainRadius: 3, maxMoves: 10, maxDepth: 2 };

export interface Rect { minX: number; minY: number; maxX: number; maxY: number }
export interface SettleMove { groupId: string; x: number; y: number; fromX: number; fromY: number }
export type SettleReason = "none" | "snap-possible" | "moved" | "blocked";
export interface SettlePlan {
  moves: SettleMove[];
  /** Groepen die nog overlappen met de focusgroep omdat er geen veilige plek was; de focusgroep blijft dan bovenop en bereikbaar. */
  unresolved: string[];
  reason: SettleReason;
}
export interface SettleOptions {
  focusGroupId: string;
  difficulty: PuzzleDifficulty;
  rulesVersion?: number;
  /** Groepen die niet mogen bewegen (naast vastgezette): bijvoorbeeld een groep die een andere speler vasthoudt. */
  immovable?: ReadonlySet<string>;
  limits?: Partial<SettleLimits>;
}

const round = (value: number) => Math.round(value * 1e4) / 1e4;
const EMPTY: SettlePlan = { moves: [], unresolved: [], reason: "none" };

function rotateAroundCentre(x: number, y: number, degrees: PuzzleGroup["rotation"]) {
  if (degrees === 0) return { x, y };
  const radians = degrees * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  const px = x - .5; const py = y - .5;
  return { x: px * cosine - py * sine + .5, y: px * sine + py * cosine + .5 };
}

/** De kern (1 x 1) van elk stuk, relatief aan het anker van de groep en al gedraaid. Uitsteeksels tellen bewust niet mee: twee passende stukken botsen dus nooit. */
export function pieceCoreRects(geometry: PuzzleGeometry, group: PuzzleGroup): Rect[] {
  const anchor = groupAnchor(geometry, group);
  return group.pieceIds.map((id) => {
    const piece = geometry.pieces[id]; const ox = piece.column - anchor.column; const oy = piece.row - anchor.row;
    const a = rotateAroundCentre(ox, oy, group.rotation); const b = rotateAroundCentre(ox + 1, oy + 1, group.rotation);
    return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
  });
}

function bounding(rects: readonly Rect[]): Rect {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const r of rects) { minX = Math.min(minX, r.minX); minY = Math.min(minY, r.minY); maxX = Math.max(maxX, r.maxX); maxY = Math.max(maxY, r.maxY); }
  return { minX, minY, maxX, maxY };
}

/** Overlap in beide richtingen (negatief = ruimte ertussen). */
function overlap(a: Rect, b: Rect) { return { x: Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX), y: Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) }; }

/** Raakt dit stuk een ander ongewenst? `inflate` > 0 maakt de test strenger (plaatsing), `threshold` is de toegestane doordringing (detectie). */
function touches(a: Rect, b: Rect, threshold: number, inflate: number) {
  const o = overlap(a, b);
  return o.x + inflate * 2 > threshold && o.y + inflate * 2 > threshold;
}

const CELL = 2;
const cellKey = (cx: number, cy: number) => (cx + 2048) * 8192 + (cy + 2048);

/** Ruimtelijke index op stukniveau: een vraag kijkt alleen naar de dichtstbijzijnde cellen, niet naar alle groepen. */
class Occupancy {
  private readonly cells = new Map<number, number[]>();
  private readonly rects: Rect[] = []; private readonly owner: string[] = [];
  private readonly byGroup = new Map<string, number[]>();
  private stamp = 0; private readonly seen: number[] = [];

  add(groupId: string, rects: readonly Rect[]) {
    const ids: number[] = [];
    for (const rect of rects) {
      const index = this.rects.length; this.rects.push(rect); this.owner.push(groupId); this.seen.push(0); ids.push(index);
      for (let cx = Math.floor(rect.minX / CELL); cx <= Math.floor(rect.maxX / CELL); cx++) for (let cy = Math.floor(rect.minY / CELL); cy <= Math.floor(rect.maxY / CELL); cy++) {
        const key = cellKey(cx, cy); const list = this.cells.get(key); if (list) list.push(index); else this.cells.set(key, [index]);
      }
    }
    this.byGroup.set(groupId, ids);
  }
  remove(groupId: string) {
    const ids = this.byGroup.get(groupId); if (!ids) return;
    for (const index of ids) {
      const rect = this.rects[index];
      for (let cx = Math.floor(rect.minX / CELL); cx <= Math.floor(rect.maxX / CELL); cx++) for (let cy = Math.floor(rect.minY / CELL); cy <= Math.floor(rect.maxY / CELL); cy++) {
        const list = this.cells.get(cellKey(cx, cy)); if (!list) continue; const at = list.indexOf(index); if (at >= 0) list.splice(at, 1);
      }
    }
    this.byGroup.delete(groupId);
  }
  /** Alle andere groepen die met één van deze stukken botsen. */
  hits(selfId: string, rects: readonly Rect[], threshold: number, inflate: number): Set<string> {
    const found = new Set<string>(); const mark = ++this.stamp;
    for (const rect of rects) {
      const pad = inflate + 1e-9;
      for (let cx = Math.floor((rect.minX - pad) / CELL); cx <= Math.floor((rect.maxX + pad) / CELL); cx++) for (let cy = Math.floor((rect.minY - pad) / CELL); cy <= Math.floor((rect.maxY + pad) / CELL); cy++) {
        const list = this.cells.get(cellKey(cx, cy)); if (!list) continue;
        for (const index of list) {
          if (this.seen[index] === mark || this.owner[index] === selfId) continue; this.seen[index] = mark;
          if (touches(rect, this.rects[index], threshold, inflate)) found.add(this.owner[index]);
        }
      }
    }
    return found;
  }
}

const offsetCache = new Map<string, Array<{ dx: number; dy: number; dist: number }>>();
/** Verschuivingen op een raster, op volgorde van afstand en dan vaste volgorde: dezelfde invoer geeft altijd dezelfde uitkomst. */
function offsets(radius: number, step: number) {
  const key = `${radius}:${step}`; const cached = offsetCache.get(key); if (cached) return cached;
  const n = Math.floor(radius / step); const list: Array<{ dx: number; dy: number; dist: number }> = [];
  for (let iy = -n; iy <= n; iy++) for (let ix = -n; ix <= n; ix++) { const dist = Math.hypot(ix * step, iy * step); if (dist <= radius + 1e-9) list.push({ dx: ix * step, dy: iy * step, dist }); }
  list.sort((a, b) => a.dist - b.dist || a.dy - b.dy || a.dx - b.dx);
  offsetCache.set(key, list); return list;
}

interface Item { id: string; group: PuzzleGroup; rel: Rect[]; relBounds: Rect; x: number; y: number; fixed: boolean }

/** Plant het ruimte maken rond de zojuist neergelegde groep. Muteert niets; `settleGroups` past het resultaat toe. */
export function planSettle(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, options: SettleOptions): SettlePlan {
  const limits = { ...DEFAULT_SETTLE_LIMITS, ...options.limits };
  if (snapshot.completedAt) return EMPTY;
  const focusGroup = snapshot.groups.find((group) => group.id === options.focusGroupId);
  if (!focusGroup || focusGroup.anchored) return EMPTY;
  const immovable = options.immovable ?? new Set<string>();
  // Prioriteit 1: een geldige snap of bordverankering. Dan is het niet aan dit bestand om iets te verplaatsen.
  const rulesVersion = options.rulesVersion ?? PUZZLE_RULES_VERSION;
  if (findSnapConnection(snapshot, geometry, options.difficulty, focusGroup.id, rulesVersion) || boardSnapTarget(snapshot, geometry, options.difficulty, focusGroup.id, rulesVersion)) return { moves: [], unresolved: [], reason: "snap-possible" };

  const table: PuzzleBounds = puzzleWorktable(geometry).bounds;
  const items = new Map<string, Item>(); const occupancy = new Occupancy();
  for (const group of snapshot.groups) {
    const rel = pieceCoreRects(geometry, group);
    // Uitsteeksels tellen mee voor de tafelrand (zelfde klem als de engine), niet voor de botsing.
    const relBounds = bounding(rel);
    items.set(group.id, { id: group.id, group, rel, relBounds, x: group.x, y: group.y, fixed: group.anchored === true || immovable.has(group.id) });
    occupancy.add(group.id, rel.map((r) => ({ minX: r.minX + group.x, minY: r.minY + group.y, maxX: r.maxX + group.x, maxY: r.maxY + group.y })));
  }
  const focus = items.get(focusGroup.id)!;
  const world = (item: Item, x = item.x, y = item.y) => item.rel.map((r) => ({ minX: r.minX + x, minY: r.minY + y, maxX: r.maxX + x, maxY: r.maxY + y }));
  const overhang = 0.28; // tabs mogen de tafelrand niet raken (zelfde reserve als de engine)
  const inTable = (item: Item, x: number, y: number) => x + item.relBounds.minX - overhang >= table.minX - 1e-9 && y + item.relBounds.minY - overhang >= table.minY - 1e-9 && x + item.relBounds.maxX + overhang <= table.maxX + 1e-9 && y + item.relBounds.maxY + overhang <= table.maxY + 1e-9;

  const original = new Map<string, { x: number; y: number }>(snapshot.groups.map((group) => [group.id, { x: group.x, y: group.y }]));
  const moved = new Set<string>(); const log: Array<{ id: string; x: number; y: number; wasMoved: boolean }> = [];
  const place = (item: Item, x: number, y: number) => {
    log.push({ id: item.id, x: item.x, y: item.y, wasMoved: moved.has(item.id) });
    occupancy.remove(item.id); item.x = round(x); item.y = round(y); occupancy.add(item.id, world(item)); moved.add(item.id);
  };
  const rollback = (mark: number) => {
    while (log.length > mark) { const entry = log.pop()!; const item = items.get(entry.id)!; occupancy.remove(entry.id); item.x = entry.x; item.y = entry.y; occupancy.add(entry.id, world(item)); if (!entry.wasMoved) moved.delete(entry.id); }
  };
  const conflictsWith = (item: Item, x: number, y: number, threshold: number, inflate: number) => occupancy.hits(item.id, world(item, x, y), threshold, inflate);
  const free = (item: Item, x: number, y: number) => inTable(item, x, y) && conflictsWith(item, x, y, 0, PLACEMENT_CLEARANCE).size === 0;
  const movable = (id: string) => { const item = items.get(id); return !!item && !item.fixed && id !== focus.id && !moved.has(id); };

  /** Dichtstbijzijnde vrije plek binnen `radius`, bij gelijke afstand liever van de focusgroep af. */
  const nearestFree = (item: Item, radius: number, away: { x: number; y: number } | null): { x: number; y: number } | null => {
    let best: { x: number; y: number; cost: number } | null = null; let firstDist = -1;
    for (const o of offsets(radius, limits.step)) {
      if (best && o.dist > firstDist + 0.35) break;
      const x = item.x + o.dx; const y = item.y + o.dy;
      if (!free(item, x, y)) continue;
      if (firstDist < 0) firstDist = o.dist;
      const cos = away && o.dist > 0 ? (o.dx * away.x + o.dy * away.y) / (o.dist * Math.hypot(away.x, away.y) || 1) : 1;
      const cost = o.dist + 0.4 * (1 - cos);
      if (!best || cost < best.cost - 1e-12) best = { x, y, cost };
    }
    return best ? { x: best.x, y: best.y } : null;
  };

  const centreOf = (item: Item) => ({ x: item.x + (item.relBounds.minX + item.relBounds.maxX) / 2, y: item.y + (item.relBounds.minY + item.relBounds.maxY) / 2 });
  const awayFrom = (item: Item) => { const a = centreOf(item); const b = centreOf(focus); const dx = a.x - b.x; const dy = a.y - b.y; return dx === 0 && dy === 0 ? null : { x: dx, y: dy }; };

  /** Verplaatst één beweeglijke groep: eerst een vrije plek, anders (beperkt) een andere beweeglijke groep laten meeschuiven. */
  const tryPlace = (id: string, depth: number): boolean => {
    const item = items.get(id)!; const away = awayFrom(item); const mark = log.length;
    const spot = nearestFree(item, limits.maxRadius, away);
    if (spot) { place(item, spot.x, spot.y); return true; }
    if (depth >= limits.maxDepth || moved.size >= limits.maxMoves) return false;
    const candidates: Array<{ x: number; y: number; others: string[]; cost: number; dist: number; dx: number; dy: number }> = [];
    for (const o of offsets(limits.chainRadius, limits.step)) {
      const x = item.x + o.dx; const y = item.y + o.dy; if (!inTable(item, x, y)) continue;
      const hit = conflictsWith(item, x, y, 0, PLACEMENT_CLEARANCE);
      if (hit.size === 0 || hit.size > 2 || ![...hit].every(movable)) continue;
      candidates.push({ x, y, others: [...hit].sort(), cost: o.dist + 0.8 * hit.size, dist: o.dist, dx: o.dx, dy: o.dy });
    }
    candidates.sort((a, b) => a.cost - b.cost || a.dy - b.dy || a.dx - b.dx);
    for (const candidate of candidates.slice(0, 3)) {
      place(item, candidate.x, candidate.y);
      if (candidate.others.every((other) => tryPlace(other, depth + 1))) return true;
      rollback(mark);
    }
    return false;
  };

  const focusHits = () => conflictsWith(focus, focus.x, focus.y, DETECT_PENETRATION, 0);
  const initial = focusHits();
  if (!initial.size) return EMPTY;
  const unresolved: string[] = [];
  const blockers = [...initial].filter((id) => items.get(id)!.fixed).sort();
  if (blockers.length) {
    // De focusgroep ligt (deels) op een groep die niet mag bewegen: zij zoekt zelf een vrije plek. Kan dat niet, dan blijft zij bovenop liggen.
    const spot = focus.fixed ? null : nearestFree(focus, limits.maxRadius, null);
    if (spot) place(focus, spot.x, spot.y); else unresolved.push(...blockers);
  }
  if (!moved.has(focus.id)) {
    // Overlap met beweeglijke groepen: de grootste overlap eerst, daarna op id (vaste volgorde).
    const loose = [...focusHits()].filter((id) => !items.get(id)!.fixed);
    const area = (id: string) => { let sum = 0; const rects = world(items.get(id)!); for (const a of world(focus)) for (const b of rects) { const o = overlap(a, b); if (o.x > 0 && o.y > 0) sum += o.x * o.y; } return sum; };
    loose.sort((a, b) => area(b) - area(a) || (a < b ? -1 : 1));
    for (const id of loose) {
      if (!focusHits().has(id)) continue; // een eerdere verplaatsing heeft dit al opgelost
      if (!movable(id) || !tryPlace(id, 0)) unresolved.push(id);
    }
  }
  const moves: SettleMove[] = [];
  for (const group of snapshot.groups) { const item = items.get(group.id)!; const from = original.get(group.id)!; if (item.x !== from.x || item.y !== from.y) moves.push({ groupId: group.id, x: item.x, y: item.y, fromX: from.x, fromY: from.y }); }
  return { moves, unresolved: [...new Set(unresolved)].sort(), reason: moves.length ? "moved" : "blocked" };
}

/** Past een plan toe op een kopie van de snapshot. Geen verandering = dezelfde instantie, zodat de aanroeper geen versie ophoogt. */
export function settleGroups(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, options: SettleOptions): PuzzleSnapshot {
  const plan = planSettle(snapshot, geometry, options);
  if (!plan.moves.length) return snapshot;
  const byId = new Map(plan.moves.map((move) => [move.groupId, move]));
  return { ...snapshot, groups: snapshot.groups.map((group) => { const move = byId.get(group.id); return move ? { ...group, x: move.x, y: move.y } : group; }) };
}

/** Snelle controle voor de client: zou een settle nu iets verplaatsen? Dezelfde berekening als de server, zonder netwerk. */
export function settleWouldMove(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, options: SettleOptions): boolean {
  return planSettle(snapshot, geometry, options).moves.length > 0;
}

/** Welke groepen overlappen ongewenst met deze groep? (Voor tests en diagnose; gebruikt dezelfde drempel als het plan.) */
export function overlappingGroups(snapshot: PuzzleSnapshot, geometry: PuzzleGeometry, groupId: string): string[] {
  const group = snapshot.groups.find((candidate) => candidate.id === groupId); if (!group) return [];
  const mine = pieceCoreRects(geometry, group).map((r) => ({ minX: r.minX + group.x, minY: r.minY + group.y, maxX: r.maxX + group.x, maxY: r.maxY + group.y }));
  const found: string[] = [];
  for (const other of snapshot.groups) {
    if (other.id === groupId) continue;
    const theirs = pieceCoreRects(geometry, other).map((r) => ({ minX: r.minX + other.x, minY: r.minY + other.y, maxX: r.maxX + other.x, maxY: r.maxY + other.y }));
    if (mine.some((a) => theirs.some((b) => touches(a, b, DETECT_PENETRATION, 0)))) found.push(other.id);
  }
  return found.sort();
}
