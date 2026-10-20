import { pathAssetIdForMask } from "./paths";

export type TerrainWorldBounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Alleen weergave: bestaande opgeslagen paden en objecten blijven intact. */
export function terrainAssetId(u: number, v: number, pathMask?: number): string {
  void u; void v;
  return pathMask === undefined ? "terrain-grass" : pathAssetIdForMask(pathMask);
}

/** Vaste wereldrasterstappen per LOD-band: bomen verschuiven niet tijdens pinch. */
export function forestLodStep(zoom: number): number {
  return 256 * 2 ** Math.max(0, Math.ceil(Math.log2(76 / (256 * zoom))));
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
