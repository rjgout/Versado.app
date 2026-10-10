import type { PuzzleBounds } from "@/lib/puzzle/worktable";

export interface PuzzleCamera { scale: number; x: number; y: number; }
export interface ViewportSize { width: number; height: number; }

const PADDING = .65;

export function screenToWorld(camera: PuzzleCamera, point: { x: number; y: number }) { return { x: (point.x - camera.x) / camera.scale, y: (point.y - camera.y) / camera.scale }; }

/** Houdt altijd een rand van de eindige werktafel in beeld; dit voorkomt een
 * camera die naar lege, onbereikbare wereldruimte verdwijnt. */
export function constrainCamera(camera: PuzzleCamera, viewport: ViewportSize, bounds: PuzzleBounds): PuzzleCamera {
  const next = { ...camera }; const width = bounds.maxX - bounds.minX + PADDING * 2; const height = bounds.maxY - bounds.minY + PADDING * 2;
  if (width * next.scale <= viewport.width) next.x = (viewport.width - width * next.scale) / 2 - (bounds.minX - PADDING) * next.scale;
  else next.x = Math.min(-(bounds.minX - PADDING) * next.scale, Math.max(viewport.width - (bounds.maxX + PADDING) * next.scale, next.x));
  if (height * next.scale <= viewport.height) next.y = (viewport.height - height * next.scale) / 2 - (bounds.minY - PADDING) * next.scale;
  else next.y = Math.min(-(bounds.minY - PADDING) * next.scale, Math.max(viewport.height - (bounds.maxY + PADDING) * next.scale, next.y));
  return next;
}

export function fitCamera(viewport: ViewportSize, bounds: PuzzleBounds): PuzzleCamera {
  const scale = Math.max(8, Math.min(180, Math.min((viewport.width - 48) / (bounds.maxX - bounds.minX + 1.3), (viewport.height - 48) / (bounds.maxY - bounds.minY + 1.3))));
  return constrainCamera({ scale, x: (viewport.width - (bounds.maxX + bounds.minX) * scale) / 2, y: (viewport.height - (bounds.maxY + bounds.minY) * scale) / 2 }, viewport, bounds);
}

export function zoomCamera(camera: PuzzleCamera, viewport: ViewportSize, bounds: PuzzleBounds, factor: number, around: { x: number; y: number }) {
  const world = screenToWorld(camera, around); const scale = Math.max(12, Math.min(240, camera.scale * factor));
  return constrainCamera({ scale, x: around.x - world.x * scale, y: around.y - world.y * scale }, viewport, bounds);
}
