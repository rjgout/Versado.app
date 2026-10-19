import type { DorpPathTile, TileCoordinate } from "./types";

export const PATH_DIRECTIONS = [
  { bit: 1, du: 0, dv: -1 },
  { bit: 2, du: 1, dv: 0 },
  { bit: 4, du: 0, dv: 1 },
  { bit: 8, du: -1, dv: 0 },
] as const;

export type PathVariant = "isolated" | "end" | "straight" | "corner" | "tee" | "cross";

export function pathKey(tile: TileCoordinate): string {
  return `${tile.u},${tile.v}`;
}

export function pathConnectivity(tile: TileCoordinate, paths: readonly DorpPathTile[]): number {
  const keys = new Set(paths.map(pathKey));
  return PATH_DIRECTIONS.reduce((mask, direction) => keys.has(`${tile.u + direction.du},${tile.v + direction.dv}`) ? mask | direction.bit : mask, 0);
}

export function pathVariantForMask(mask: number): PathVariant {
  const connections = PATH_DIRECTIONS.filter((direction) => (mask & direction.bit) !== 0).length;
  if (connections === 0) return "isolated";
  if (connections === 1) return "end";
  if (connections === 3) return "tee";
  if (connections === 4) return "cross";
  return mask === 5 || mask === 10 ? "straight" : "corner";
}

export function normalizePaths(paths: readonly DorpPathTile[], radius: number): DorpPathTile[] {
  const seen = new Set<string>();
  return paths.filter((tile) => {
    const key = pathKey(tile);
    if (!Number.isInteger(tile.u) || !Number.isInteger(tile.v) || tile.u * tile.u + tile.v * tile.v > radius * radius || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
