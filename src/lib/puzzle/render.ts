import { tracePuzzleGroup, tracePuzzleSide } from "@/lib/puzzle/geometry";
import { groupFor } from "@/lib/puzzle/engine";
import { groupAnchor, type PuzzleWorktable } from "@/lib/puzzle/worktable";
import type { PuzzleCamera } from "@/lib/puzzle/viewport";
import type { PuzzleGeometry, PuzzleGroup, PuzzleHintTarget, PuzzleSnapshot } from "@/lib/puzzle/types";

// Eén tekenmodule voor Solo, Tegen elkaar (zelfde component als Solo) en Samen.
// Dit bestand tekent alleen: het kent geen React, netwerk, sessie of gebruiker en
// leest uitsluitend de aangeleverde scène. Interactie, camera, animatieplanning en
// levenscyclus blijven bij de aanroepende componenten.

const BOARD_BACKGROUND = "#edf1f2";
const TABLE_FILL = "#dbe6e6";
const TABLE_BORDER = "rgba(42, 68, 74, .45)";
const BACKDROP_FILL = "rgba(255, 255, 255, .74)";
const OUTLINE_STROKE = "rgba(64, 87, 94, .46)";
const PIECE_FILL = "#b9d5d7";
const SHADOW = "rgba(29, 42, 60, .28)";
const LOOSE_STROKE = "rgba(29, 42, 60, .60)";
const SELECTED_STROKE = "#d97716";
const HINT_FILL = "rgba(217,119,22,.16)";
// Bijna-passend: een diep cyaan (cyan-700). Bewust geen kleur die al iets betekent op het bord: oranje is selectie en hint,
// donkergroen is verankerd en de spelerkleuren van Samen (blauw, roze, smaragd, paars) zijn locks. Daarnaast verschilt de vorm:
// alleen de aansluitende rand en de bordplek, nooit de hele contour van een groep.
const NEAR_SNAP_CORE = "14, 116, 144";
const NEAR_SNAP_BACKING = "255, 255, 255";

/** Waar en hoe één groep nu getekend wordt; `place` vult dit zonder per groep een object aan te maken. */
export interface GroupPlacement {
  x: number;
  y: number;
  /** Opgetild met schaduw (eigen of andermans sleepbeweging). */
  lifted: boolean;
  /** Kleur van de contour van een groep die een ander vasthoudt, anders null. */
  lockColor: string | null;
}

/** Eén rand tussen twee stukken, in het groepsframe van `piece` (anker en weergegeven positie van die groep). */
export interface GlowEdge { piece: number; neighbour: number; anchorPiece: number; x: number; y: number }

/**
 * Presentatiestatus voor "bijna passend". Alleen weergave: de aanroeper bepaalt met de engine of een verbinding geldig is
 * en levert hier alleen het resultaat; de renderer beslist niets en wijzigt niets.
 */
export interface NearSnapGlow {
  /** Aantal geldige randen in `edges` (0 of 2: het stilstaande en het gesleepte stuk). */
  edgeCount: number;
  edges: readonly [GlowEdge, GlowEdge];
  /** Geldige plaatsing op het bord: de groepscontour op zijn bordpositie. */
  slot: { active: boolean; pieceIds: readonly number[]; x: number; y: number };
  /** 0..1: korte overgang bij binnenkomst; 1 bij verminderde beweging. */
  strength: number;
}

export interface PuzzleScene {
  geometry: PuzzleGeometry;
  table: PuzzleWorktable;
  camera: PuzzleCamera;
  image: CanvasImageSource | null;
  /** Path2D-cache van de aanroeper; de sleutel is de lijst stukken van een groep (of `filter:...`). */
  paths: Map<string, Path2D>;
  /** Stand waarop hintmarkeringen zoeken naar hun groep (positie, niet de eventuele sleeppositie). */
  snapshot: PuzzleSnapshot;
  /** Groepen in tekenvolgorde: de laatste ligt bovenop. */
  groups: readonly PuzzleGroup[];
  /** Zonder `place` staat elke groep op de eigen positie, niet opgetild. */
  place?: (group: PuzzleGroup, out: GroupPlacement) => void;
  selectedPiece: number | null;
  hint: PuzzleHintTarget | undefined;
  /** Lichte vlakvulling onder de puzzelzone, het spookbeeld en de gestippelde rand. */
  backdrop: boolean;
  ghost: boolean;
  outline: boolean;
  /** Contouren van de groepen; uit zodra de afbeelding klaar is. */
  edges: boolean;
  /** Contourkleur van een verankerde groep; Solo en Samen kiezen hier bewust een andere dekking. */
  anchoredStroke: string;
  /** Alleen gevuld terwijl de speler zelf een groep sleept binnen de geldige snapafstand. */
  nearSnap?: NearSnapGlow | null;
}

/** De gedeelde rand van `piece` met zijn buur, in de celruimte van `piece` (0..1). Zelfde pad voor beide kanten van de aansluiting. */
function traceSharedSide(path: Path2D, geometry: PuzzleGeometry, piece: number, neighbour: number) {
  const a = geometry.pieces[piece]; const b = geometry.pieces[neighbour];
  if (b.column === a.column + 1) { path.moveTo(1, 0); tracePuzzleSide(path, 1, 0, 1, 1, a.right, false); }
  else if (b.column === a.column - 1) { path.moveTo(0, 1); tracePuzzleSide(path, 0, 1, 0, 0, a.left, true); }
  else if (b.row === a.row - 1) { path.moveTo(0, 0); tracePuzzleSide(path, 0, 0, 1, 0, a.top, true); }
  else { path.moveTo(1, 1); tracePuzzleSide(path, 1, 1, 0, 1, a.bottom, false); }
}

/** Zachte halo, witte onderlaag voor contrast op donkere beeldstukken en een heldere kern; vaste breedtes in schermpixels. */
function strokeGlow(context: CanvasRenderingContext2D, path: Path2D, scale: number, strength: number, width: number) {
  context.lineCap = "round"; context.lineJoin = "round";
  context.strokeStyle = `rgba(${NEAR_SNAP_CORE}, ${.26 * strength})`; context.lineWidth = (width + 6) / scale; context.stroke(path);
  context.strokeStyle = `rgba(${NEAR_SNAP_BACKING}, ${.7 * strength})`; context.lineWidth = (width + 2) / scale; context.stroke(path);
  context.strokeStyle = `rgba(${NEAR_SNAP_CORE}, ${.95 * strength})`; context.lineWidth = width / scale; context.stroke(path);
}

export function renderPuzzle(canvas: HTMLCanvasElement, scene: PuzzleScene): void {
  const { geometry, table, camera, image, paths, snapshot, hint: target } = scene;
  const rect = canvas.getBoundingClientRect(); const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * ratio)); const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const context = canvas.getContext("2d"); if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, rect.width, rect.height); context.fillStyle = BOARD_BACKGROUND; context.fillRect(0, 0, rect.width, rect.height);
  context.save(); context.translate(camera.x, camera.y); context.scale(camera.scale, camera.scale);
  const scale = camera.scale; const { bounds, puzzle } = table;
  context.fillStyle = TABLE_FILL; context.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  context.strokeStyle = TABLE_BORDER; context.lineWidth = 2 / scale; context.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  if (scene.backdrop) { context.fillStyle = BACKDROP_FILL; context.fillRect(puzzle.x, puzzle.y, puzzle.width, puzzle.height); }
  if (scene.ghost && image) { context.globalAlpha = .18; context.drawImage(image, puzzle.x, puzzle.y, puzzle.width, puzzle.height); context.globalAlpha = 1; }
  if (scene.outline) { context.strokeStyle = OUTLINE_STROKE; context.setLineDash([.12, .1]); context.strokeRect(puzzle.x, puzzle.y, puzzle.width, puzzle.height); context.setLineDash([]); }
  const dim = target?.type === "FILTER"; const placement: GroupPlacement = { x: 0, y: 0, lifted: false, lockColor: null };
  for (const group of scene.groups) {
    placement.x = group.x; placement.y = group.y; placement.lifted = false; placement.lockColor = null; scene.place?.(group, placement);
    const anchor = groupAnchor(geometry, group); const key = group.pieceIds.join(",");
    let path = paths.get(key);
    if (!path) { path = new Path2D(); tracePuzzleGroup(path, geometry, group.pieceIds); paths.set(key, path); }
    // Twee schermpixels lift, ook bij zoom/rotatie. Wereldpositie en snap blijven exact.
    context.save(); if (dim) context.globalAlpha = .2; context.translate(placement.x + .5, placement.y + .5 - (placement.lifted ? 2 / scale : 0)); context.rotate(group.rotation * Math.PI / 180); context.translate(-.5, -.5);
    if (placement.lifted) {
      // De echte groepscontour werpt schaduw, buiten de beeldclip en zonder interne randen.
      context.save(); context.shadowColor = SHADOW; context.shadowBlur = 10 * ratio; context.shadowOffsetY = 5 * ratio;
      context.fillStyle = PIECE_FILL; context.fill(path); context.restore();
    }
    // Eén echte groepscontour en één beelduitsnede: geen afzonderlijke clips
    // met antialias-kieren of dubbel gestrokte interne aansluitingen.
    context.save(); context.clip(path);
    if (image) context.drawImage(image, -anchor.column, -anchor.row, geometry.grid.columns, geometry.grid.rows);
    else { context.fillStyle = PIECE_FILL; context.fill(path); }
    context.restore();
    if (target?.type === "FILTER" && image) {
      const members = group.pieceIds.filter((id) => target.pieceIds.includes(id));
      if (members.length) {
        const first = geometry.pieces[members[0]]; const filterKey = `filter:${members.join(",")}`;
        let highlight = paths.get(filterKey);
        if (!highlight) { highlight = new Path2D(); tracePuzzleGroup(highlight, geometry, members); paths.set(filterKey, highlight); }
        context.save(); context.globalAlpha = 1; context.translate(first.column - anchor.column, first.row - anchor.row); context.clip(highlight);
        context.drawImage(image, -first.column, -first.row, geometry.grid.columns, geometry.grid.rows); context.restore();
      }
    }
    const active = scene.selectedPiece !== null && group.pieceIds.includes(scene.selectedPiece);
    // Rustige contour in de kleur van de speler die de groep vasthoudt; de eigen selectie blijft oranje.
    if (placement.lockColor) { context.strokeStyle = placement.lockColor; context.lineWidth = 4 / scale; context.stroke(path); }
    context.strokeStyle = active ? SELECTED_STROKE : group.anchored ? scene.anchoredStroke : LOOSE_STROKE; context.lineWidth = (active ? 3 : 1) / scale;
    if (scene.edges) context.stroke(path);
    context.restore();
  }
  const glow = scene.nearSnap;
  if (glow && glow.strength > 0) {
    if (glow.slot.active) {
      const key = glow.slot.pieceIds.join(","); let path = paths.get(key);
      if (!path) { path = new Path2D(); tracePuzzleGroup(path, geometry, glow.slot.pieceIds as number[]); paths.set(key, path); }
      context.save(); context.translate(glow.slot.x, glow.slot.y); strokeGlow(context, path, scale, glow.strength * .85, 2.5); context.restore();
    }
    for (let index = 0; index < glow.edgeCount; index++) {
      const edge = glow.edges[index]; const key = `edge:${edge.piece}>${edge.neighbour}`; let path = paths.get(key);
      if (!path) { path = new Path2D(); traceSharedSide(path, geometry, edge.piece, edge.neighbour); paths.set(key, path); }
      const piece = geometry.pieces[edge.piece]; const anchor = geometry.pieces[edge.anchorPiece];
      context.save(); context.translate(edge.x + piece.column - anchor.column, edge.y + piece.row - anchor.row); strokeGlow(context, path, scale, glow.strength, 3); context.restore();
    }
  }
  // Tijdelijke markers gebruiken de echte canonieke paden. Geen statusmutatie.
  if (target?.type === "LOCATION") {
    const path = new Path2D(); tracePuzzleGroup(path, geometry, target.pieceIds);
    context.save(); context.translate(target.x, target.y); context.fillStyle = HINT_FILL; context.fill(path); context.strokeStyle = SELECTED_STROKE; context.lineWidth = 3 / scale; context.stroke(path); context.restore();
  }
  const marked = target?.type === "CONNECTION" ? [target.pieceId, target.neighborId] : target?.type === "FILTER" ? target.pieceIds : [];
  for (const id of marked) {
    const group = groupFor(snapshot, id); if (!group) continue;
    const anchor = groupAnchor(geometry, group); const piece = geometry.pieces[id]; const path = new Path2D(); tracePuzzleGroup(path, geometry, [id]);
    context.save(); context.translate(group.x + .5, group.y + .5); context.rotate(group.rotation * Math.PI / 180); context.translate(piece.column - anchor.column - .5, piece.row - anchor.row - .5); context.strokeStyle = SELECTED_STROKE; context.lineWidth = 4 / scale; context.stroke(path); context.restore();
  }
  context.restore();
}
