import { groupBounds, puzzleWorktable, type PuzzleBounds } from "@/lib/puzzle/worktable";
import type { PuzzleGeometry, PuzzleSnapshot } from "@/lib/puzzle/types";

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

/** Begin met ongeveer zes bruikbare stukken over de korte schermzijde, niet
 * met de hele parkeerzone. Toon voortgang of losse stukken naast de puzzel. */
export function initialPuzzleCamera(viewport: ViewportSize, geometry: PuzzleGeometry, snapshot: PuzzleSnapshot): PuzzleCamera {
  const table = puzzleWorktable(geometry);
  const puzzleCenter = { x: table.puzzle.x + table.puzzle.width / 2, y: table.puzzle.y + table.puzzle.height / 2 };
  const groups = snapshot.groups.map((group) => { const bounds = groupBounds(geometry, group); return { group, center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } }; });
  const distance = (center: { x: number; y: number }) => Math.hypot(center.x - puzzleCenter.x, center.y - puzzleCenter.y);
  groups.sort((a, b) => b.group.pieceIds.length - a.group.pieceIds.length || distance(a.center) - distance(b.center) || a.group.id.localeCompare(b.group.id));
  const focus = groups[0];
  const center = focus ? focus.group.pieceIds.length > 1 ? focus.center : { x: (focus.center.x + puzzleCenter.x) / 2, y: (focus.center.y + puzzleCenter.y) / 2 } : puzzleCenter;
  const scale = Math.max(40, Math.min(160, Math.min(viewport.width, viewport.height) / 6));
  return constrainCamera({ scale, x: viewport.width / 2 - center.x * scale, y: viewport.height / 2 - center.y * scale }, viewport, table.bounds);
}

/** Een viewportwijziging verplaatst het schermmidden, niet de puzzel of zoom. */
export function resizeCamera(camera: PuzzleCamera, previous: ViewportSize, next: ViewportSize, bounds: PuzzleBounds): PuzzleCamera {
  const center = screenToWorld(camera, { x: previous.width / 2, y: previous.height / 2 });
  return constrainCamera({ scale: camera.scale, x: next.width / 2 - center.x * camera.scale, y: next.height / 2 - center.y * camera.scale }, next, bounds);
}

export function zoomCamera(camera: PuzzleCamera, viewport: ViewportSize, bounds: PuzzleBounds, factor: number, around: { x: number; y: number }) {
  const world = screenToWorld(camera, around); const scale = Math.max(8, Math.min(240, camera.scale * factor));
  return constrainCamera({ scale, x: around.x - world.x * scale, y: around.y - world.y * scale }, viewport, bounds);
}
