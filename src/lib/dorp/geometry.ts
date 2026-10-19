import { DORP_OBJECT_BY_ID } from "./catalog";
import type { PlacedDorpObject, TileCoordinate } from "./types";

export const TILE_WIDTH = 128;
export const TILE_HEIGHT = 64;
export const START_RADIUS = 8;
export const MAX_RADIUS = 62;
export const EXPANSION_COUNT = 16;
export const CHAPTER_COUNT = 239;

export const PROTOTYPE_PHASES = [
  { id: 0, label: "Startgebied", radius: 8 },
  { id: 1, label: "Eerste uitbreiding", radius: 11 },
  { id: 2, label: "R14-testniveau", radius: 14 },
  { id: 8, label: "Middenfase", radius: 35 },
  { id: 16, label: "Volledige kaart", radius: 62 },
] as const;

export function radiusForPhase(phase: number): number {
  const safePhase = Math.max(0, Math.min(EXPANSION_COUNT, Math.trunc(phase)));
  return START_RADIUS + safePhase * 3 + Math.floor((6 * safePhase) / EXPANSION_COUNT);
}

export function chapterThresholdForPhase(phase: number): number {
  const safePhase = Math.max(1, Math.min(EXPANSION_COUNT, Math.trunc(phase)));
  return Math.ceil((CHAPTER_COUNT * safePhase) / EXPANSION_COUNT);
}

export function isTileBuildable(u: number, v: number, radius: number): boolean {
  return Number.isInteger(u) && Number.isInteger(v) && u * u + v * v <= radius * radius;
}

export function buildableTileCount(radius: number): number {
  let count = 0;
  for (let u = -radius; u <= radius; u += 1) {
    for (let v = -radius; v <= radius; v += 1) if (isTileBuildable(u, v, radius)) count += 1;
  }
  return count;
}

export function footprintTiles(u: number, v: number, footprint: readonly [number, number]): TileCoordinate[] {
  const tiles: TileCoordinate[] = [];
  for (let du = 0; du < footprint[0]; du += 1) {
    for (let dv = 0; dv < footprint[1]; dv += 1) tiles.push({ u: u + du, v: v + dv });
  }
  return tiles;
}

export function placementIsValid(
  candidate: Pick<PlacedDorpObject, "instanceId" | "objectId" | "u" | "v">,
  objects: readonly PlacedDorpObject[],
  radius: number,
  blockedTiles: ReadonlySet<string> = new Set(),
): boolean {
  const definition = DORP_OBJECT_BY_ID.get(candidate.objectId);
  if (!definition || !Number.isInteger(candidate.u) || !Number.isInteger(candidate.v)) return false;
  const candidateTiles = footprintTiles(candidate.u, candidate.v, definition.footprint);
  if (candidateTiles.some((tile) => !isTileBuildable(tile.u, tile.v, radius) || blockedTiles.has(`${tile.u},${tile.v}`))) return false;

  const occupied = new Set<string>();
  for (const object of objects) {
    if (object.instanceId === candidate.instanceId) continue;
    const otherDefinition = DORP_OBJECT_BY_ID.get(object.objectId);
    if (!otherDefinition) continue;
    for (const tile of footprintTiles(object.u, object.v, otherDefinition.footprint)) occupied.add(`${tile.u},${tile.v}`);
  }
  return candidateTiles.every((tile) => !occupied.has(`${tile.u},${tile.v}`));
}

export function suggestPlacement(
  objectId: string,
  objects: readonly PlacedDorpObject[],
  radius: number,
  origin: TileCoordinate = { u: 0, v: 0 },
  instanceId = "preview",
): TileCoordinate | null {
  for (let ring = 0; ring <= radius * 2; ring += 1) {
    for (let du = -ring; du <= ring; du += 1) {
      for (const dv of new Set([ring - Math.abs(du), -(ring - Math.abs(du))])) {
        const candidate = { instanceId, objectId, u: origin.u + du, v: origin.v + dv };
        if (placementIsValid(candidate, objects, radius)) return { u: candidate.u, v: candidate.v };
      }
    }
  }
  return null;
}

export function isoToWorld(u: number, v: number): { x: number; y: number } {
  return { x: (TILE_WIDTH / 2) * (u - v), y: (TILE_HEIGHT / 2) * (u + v) };
}

export function worldToIso(x: number, y: number): TileCoordinate {
  const u = x / TILE_WIDTH + y / TILE_HEIGHT;
  const v = y / TILE_HEIGHT - x / TILE_WIDTH;
  return { u: Math.round(u), v: Math.round(v) };
}

export type WorldBounds = { minX: number; minY: number; maxX: number; maxY: number };
const worldBoundsCache = new Map<number, WorldBounds>();

export function forestPlacements(radius: number): Array<TileCoordinate & { index: number }> {
  const forestRadius = radius + 4;
  const count = Math.max(20, Math.round(forestRadius * 2.3));
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return { index, u: Math.round(Math.cos(angle) * forestRadius), v: Math.round(Math.sin(angle) * forestRadius) };
  });
}

export function projectedWorldBounds(radius: number): WorldBounds {
  const cached = worldBoundsCache.get(radius);
  if (cached) return cached;
  let bounds: WorldBounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const include = (minX: number, minY: number, maxX: number, maxY: number) => {
    bounds = { minX: Math.min(bounds.minX, minX), minY: Math.min(bounds.minY, minY), maxX: Math.max(bounds.maxX, maxX), maxY: Math.max(bounds.maxY, maxY) };
  };
  for (let u = -radius; u <= radius; u += 1) {
    for (let v = -radius; v <= radius; v += 1) {
      if (!isTileBuildable(u, v, radius)) continue;
      const point = isoToWorld(u, v);
      include(point.x - TILE_WIDTH / 2, point.y - TILE_HEIGHT / 2, point.x + TILE_WIDTH / 2, point.y + TILE_HEIGHT / 2);
    }
  }
  for (const forest of forestPlacements(radius)) {
    const point = isoToWorld(forest.u, forest.v);
    const strip = forest.index % 4 === 0;
    const width = strip ? 360 : 260;
    const height = strip ? 180 : 260;
    include(point.x - width / 2, point.y - height * 0.82, point.x + width / 2, point.y + height * 0.18);
  }
  worldBoundsCache.set(radius, bounds);
  return bounds;
}
