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

/** Bij het starten moeten minstens dit aantal losse stukken én het puzzelmidden zichtbaar zijn. */
export const MIN_START_VISIBLE_GROUPS = 4;
/** Kleinste startschaal (scherm-px per stuk) bij grote borden: bruikbaar, niet volledig uitgezoomd. */
export const MIN_START_SCALE = 30;
const START_SCALE_STEP = .92;

type Point = { x: number; y: number };

/** Staat dit punt (met een rand van `margin` px) binnen het scherm als de camera zo staat? */
function inView(camera: PuzzleCamera, viewport: ViewportSize, point: Point, margin: number) {
  const x = camera.x + point.x * camera.scale; const y = camera.y + point.y * camera.scale;
  return x >= margin && x <= viewport.width - margin && y >= margin && y <= viewport.height - margin;
}

/**
 * Begin met ongeveer zes bruikbare stukken over de korte schermzijde, niet
 * met de hele parkeerzone, mits dat een bruikbaar beeld geeft. Een bord met
 * voortgang (een samengestelde groep) opent op die groep, zoals altijd.
 *
 * Bij alleen losse stukken moet het startbeeld het puzzelmidden en minstens
 * vier losse stukken tonen. Bij grote borden liggen de dichtstbijzijnde
 * stukken verder weg dan een scherm op die schaal toont (bijv. 9 eenheden bij
 * 300 stukken tegen ≈ 3 zichtbaar); dan zoomt de camera in stappen uit tot
 * MIN_START_SCALE en kiest een midden dat het puzzelmidden en de dichtstbijzijnde stukken omvat.
 * Puur en deterministisch: afhankelijk van scherm, geometrie en snapshot; de gebruiker kan altijd pannen en zoomen.
 */
export function initialPuzzleCamera(viewport: ViewportSize, geometry: PuzzleGeometry, snapshot: PuzzleSnapshot): PuzzleCamera {
  const table = puzzleWorktable(geometry);
  const puzzleCenter = { x: table.puzzle.x + table.puzzle.width / 2, y: table.puzzle.y + table.puzzle.height / 2 };
  const groups = snapshot.groups.map((group) => { const bounds = groupBounds(geometry, group); return { group, center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } }; });
  const distance = (center: Point) => Math.hypot(center.x - puzzleCenter.x, center.y - puzzleCenter.y);
  groups.sort((a, b) => b.group.pieceIds.length - a.group.pieceIds.length || distance(a.center) - distance(b.center) || a.group.id.localeCompare(b.group.id));
  const focus = groups[0];
  const center = focus ? focus.group.pieceIds.length > 1 ? focus.center : { x: (focus.center.x + puzzleCenter.x) / 2, y: (focus.center.y + puzzleCenter.y) / 2 } : puzzleCenter;
  const baseScale = Math.max(40, Math.min(160, Math.min(viewport.width, viewport.height) / 6));
  const place = (scale: number, at: Point) => constrainCamera({ scale, x: viewport.width / 2 - at.x * scale, y: viewport.height / 2 - at.y * scale }, viewport, table.bounds);
  const base = place(baseScale, center);
  // Voortgang gaat voor: dan blijft het bestaande beeld gelden.
  if (!focus || focus.group.pieceIds.length > 1) return base;

  const loose = groups.filter(({ group }) => !group.anchored).sort((a, b) => distance(a.center) - distance(b.center) || a.group.id.localeCompare(b.group.id));
  const needed = Math.min(MIN_START_VISIBLE_GROUPS, loose.length);
  const visibleLoose = (camera: PuzzleCamera) => loose.reduce((count, item) => count + (inView(camera, viewport, item.center, .35 * camera.scale) ? 1 : 0), 0);
  const good = (camera: PuzzleCamera) => inView(camera, viewport, puzzleCenter, .5 * camera.scale) && visibleLoose(camera) >= needed;
  if (good(base)) return base;

  const near = loose.slice(0, Math.max(needed, 1));
  const centroid = near.length ? { x: near.reduce((sum, item) => sum + item.center.x, 0) / near.length, y: near.reduce((sum, item) => sum + item.center.y, 0) / near.length } : puzzleCenter;
  // Kandidaatmiddens van "dicht bij de stukken" naar "het puzzelmidden zelf".
  const centers: Point[] = [center, { x: (puzzleCenter.x + centroid.x) / 2, y: (puzzleCenter.y + centroid.y) / 2 }, puzzleCenter];
  let best: PuzzleCamera | null = null; let bestVisible = -1;
  for (let scale = baseScale; ; scale = Math.max(MIN_START_SCALE, scale * START_SCALE_STEP)) {
    const floor = scale <= MIN_START_SCALE + 1e-9;
    for (const at of centers) {
      const camera = place(scale, at);
      if (good(camera)) return camera;
      if (floor) { const count = visibleLoose(camera) + (inView(camera, viewport, puzzleCenter, .5 * camera.scale) ? 100 : 0); if (count > bestVisible) { best = camera; bestVisible = count; } }
    }
    if (floor) break;
  }
  return best ?? base;
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
