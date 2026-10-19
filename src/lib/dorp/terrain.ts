import { pathAssetIdForMask } from "./paths";

export type TerrainWorldBounds = { minX: number; minY: number; maxX: number; maxY: number };

export function sandCornerLabel(u: number, v: number): boolean {
  const x = (u - 4.5) / 2.5;
  const y = (v + 2.5) / 2.5;
  return x * x + y * y <= 1;
}

export function sandTransitionMask(u: number, v: number): number {
  return (sandCornerLabel(u, v) ? 1 : 0)
    | (sandCornerLabel(u + 1, v) ? 2 : 0)
    | (sandCornerLabel(u + 1, v + 1) ? 4 : 0)
    | (sandCornerLabel(u, v + 1) ? 8 : 0);
}

export function terrainAssetId(u: number, v: number, pathMask?: number): string {
  if (pathMask !== undefined) return pathAssetIdForMask(pathMask);
  const sandMask = sandTransitionMask(u, v);
  if (sandMask === 15) return "terrain-sand";
  if (sandMask > 0) return `terrain-sand-transition-m${sandMask.toString().padStart(2, "0")}`;
  if ((u === -1 && v === -3) || (u === 0 && v === -3)) return "terrain-dry-grass";
  if ((u === 1 && v === -3) || (u === 2 && v === -3)) return "terrain-flower-grass";
  return "terrain-grass";
}

export function terrainBufferBounds(cameraX: number, cameraY: number, zoom: number, viewportWidth: number, viewportHeight: number, rasterScale = 1): TerrainWorldBounds {
  const padding = 192;
  const unit = 1 / rasterScale;
  return {
    minX: Math.floor((cameraX - viewportWidth / (2 * zoom) - padding) / unit) * unit,
    minY: Math.floor((cameraY - viewportHeight / (2 * zoom) - padding) / unit) * unit,
    maxX: Math.ceil((cameraX + viewportWidth / (2 * zoom) + padding) / unit) * unit,
    maxY: Math.ceil((cameraY + viewportHeight / (2 * zoom) + padding) / unit) * unit,
  };
}

export function boundsContainViewport(bounds: TerrainWorldBounds, cameraX: number, cameraY: number, zoom: number, viewportWidth: number, viewportHeight: number): boolean {
  const halfWidth = viewportWidth / (2 * zoom);
  const halfHeight = viewportHeight / (2 * zoom);
  return cameraX - halfWidth >= bounds.minX
    && cameraX + halfWidth <= bounds.maxX
    && cameraY - halfHeight >= bounds.minY
    && cameraY + halfHeight <= bounds.maxY;
}
