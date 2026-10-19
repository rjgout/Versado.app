import type { DorpPathTile, TileCoordinate } from "./types";

export const PATH_DIRECTIONS = [
  { bit: 1, du: 1, dv: 0 },
  { bit: 2, du: 0, dv: 1 },
  { bit: 4, du: -1, dv: 0 },
  { bit: 8, du: 0, dv: -1 },
] as const;

const PATH_ASSET_BY_MASK = [
  "terrain-path-end-se",
  "terrain-path-end-se",
  "terrain-path-end-sw",
  "terrain-path-corner",
  "terrain-path-end-nw",
  "terrain-path-straight",
  "terrain-path-corner-sw-nw",
  "terrain-path-t-se-sw-nw",
  "terrain-path-end-ne",
  "terrain-path-corner-se-ne",
  "terrain-path-straight-sw-ne",
  "terrain-path-t-se-sw-ne",
  "terrain-path-corner-nw-ne",
  "terrain-path-t-se-nw-ne",
  "terrain-path-t-sw-nw-ne",
  "terrain-path-cross-se-sw-nw-ne",
] as const;

export type PathVariant = "isolated" | "end" | "straight" | "corner" | "tee" | "cross";

export function pathKey(tile: TileCoordinate): string {
  return `${tile.u},${tile.v}`;
}

export function pathConnectivity(tile: TileCoordinate, paths: readonly DorpPathTile[]): number {
  return pathConnectivityFromKeys(tile, new Set(paths.map(pathKey)));
}

export function pathConnectivityFromKeys(tile: TileCoordinate, keys: ReadonlySet<string>): number {
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

export function pathAssetIdForMask(mask: number): string {
  return PATH_ASSET_BY_MASK[mask & 15];
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

/** Vierverbonden penseelstreek, ook als pointerevents tegels overslaan. Geen inventarislimiet. */
export function paintPathSegment(paths: readonly DorpPathTile[], from: TileCoordinate, to: TileCoordinate, radius: number, erase = false): DorpPathTile[] {
  if (![from.u, from.v, to.u, to.v].every(Number.isInteger) || Math.max(Math.abs(to.u-from.u),Math.abs(to.v-from.v))>256) return [...paths];
  const result = new Map(paths.map(tile => [pathKey(tile), tile]));
  const apply = (tile: TileCoordinate) => {
    if (tile.u*tile.u+tile.v*tile.v>radius*radius) return;
    if(erase) result.delete(pathKey(tile)); else result.set(pathKey(tile), tile);
  };
  const steps=Math.max(Math.abs(to.u-from.u),Math.abs(to.v-from.v),1);
  let previous=from; apply(from);
  for(let i=1;i<=steps;i++){
    const tile={u:Math.round(from.u+(to.u-from.u)*i/steps),v:Math.round(from.v+(to.v-from.v)*i/steps)};
    if(tile.u!==previous.u&&tile.v!==previous.v) apply({u:tile.u,v:previous.v});
    apply(tile); previous=tile;
  }
  return [...result.values()];
}

/** Eén index per streek; kosten lineair in bestaand padennet + penseeltegels. */
export function paintPathTiles(paths: readonly DorpPathTile[], tiles: readonly TileCoordinate[], radius: number, erase = false): DorpPathTile[] {
  const result = new Map(paths.map(tile => [pathKey(tile), tile]));
  for (const tile of normalizePaths(tiles, radius)) {
    if (erase) result.delete(pathKey(tile)); else result.set(pathKey(tile), tile);
  }
  return [...result.values()];
}
