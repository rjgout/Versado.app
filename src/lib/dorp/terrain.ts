import { pathAssetIdForMask } from "./paths";
import { TILE_WIDTH, TILE_HEIGHT } from "./geometry";

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

/** Gras herhaalt zonder wereldgrens; alleen bosmasker en paden vragen een venstercache. */
export function grassTextureCenters() {
  return [{ x: 0, y: 0 }, { x: TILE_WIDTH, y: 0 },
    { x: TILE_WIDTH / 2, y: TILE_HEIGHT / 2 },
    { x: 0, y: TILE_HEIGHT }, { x: TILE_WIDTH, y: TILE_HEIGHT }];
}

export function forestWindowBounds(radius: number): TerrainWorldBounds {
  const x = Math.ceil((radius + 4) * 64 * Math.SQRT2), y = Math.ceil((radius + 4) * 32 * Math.SQRT2);
  return { minX: -x, maxX: x, minY: -y, maxY: y };
}

/** Begrens het offscreen-geheugen; de grasbasis zelf wordt nooit geclipt. */
export function clippedTerrainBounds(view: TerrainWorldBounds, radius: number): TerrainWorldBounds | null {
  const window = forestWindowBounds(radius);
  const bounds = { minX: Math.max(window.minX, view.minX), maxX: Math.min(window.maxX, view.maxX), minY: Math.max(window.minY, view.minY), maxY: Math.min(window.maxY, view.maxY) };
  return bounds.minX < bounds.maxX && bounds.minY < bounds.maxY ? bounds : null;
}
/** Een lege zichtbare uitsnede vereist geen dekking of nieuwe padding-cache. */
export function containsTerrainBounds(outer: TerrainWorldBounds, inner: TerrainWorldBounds | null): boolean {
  return inner === null || outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY;
}
export function forestOverlayOpacity(distance: number, radius: number): number {
  return Math.max(0, Math.min(1, (distance - radius - 1) / 2));
}
