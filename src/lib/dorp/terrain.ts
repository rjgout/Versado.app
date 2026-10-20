import { pathAssetIdForMask } from "./paths";

export type TerrainWorldBounds = { minX: number; minY: number; maxX: number; maxY: number };

/** Alleen weergave: bestaande opgeslagen paden en objecten blijven intact. */
export function terrainAssetId(u: number, v: number, pathMask?: number): string {
  void u; void v;
  return pathMask === undefined ? "terrain-grass" : pathAssetIdForMask(pathMask);
}

export function terrainBufferBounds(cameraX: number, cameraY: number, zoom: number, viewportWidth: number, viewportHeight: number, rasterScale = 1, padding = 192): TerrainWorldBounds {
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

// Eén herhaalbaar wereldpatroon; LOD schaalt pixels, nooit boomposities.
export const FOREST_PERIOD = 1536;
export function forestTexturePoints() {
  return Array.from({ length: 64 }, (_, i) => {
    const gx = i % 8, gy = Math.floor(i / 8);
    const hash = Math.abs((gx * 73856093) ^ (gy * 19349663));
    return { x: (gx + .05 + hash % 89 / 100) * 192, y: (gy + .05 + (hash >>> 6) % 89 / 100) * 192, variant: (hash >>> 7) % 2 };
  });
}

/** Begrens ook bij Wereld het offscreen-geheugen tot de echte grasomgeving. */
export function clippedTerrainBounds(view: TerrainWorldBounds, radius: number): TerrainWorldBounds | null {
  const x = (radius + 4) * 64 * Math.SQRT2, y = x / 2;
  const bounds = { minX: Math.max(-Math.ceil(x), view.minX), maxX: Math.min(Math.ceil(x), view.maxX), minY: Math.max(-Math.ceil(y), view.minY), maxY: Math.min(Math.ceil(y), view.maxY) };
  return bounds.minX < bounds.maxX && bounds.minY < bounds.maxY ? bounds : null;
}
export function containsTerrainBounds(outer: TerrainWorldBounds, inner: TerrainWorldBounds): boolean {
  return outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
}
export function clearingOpacity(distance: number, radius: number): number {
  return Math.max(0, Math.min(1, (radius + 3 - distance) / 2));
}
