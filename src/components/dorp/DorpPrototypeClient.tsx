"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ChevronDown, ChevronUp, Crosshair, Focus, Globe2, Home, Minus, Package, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import ImmersiveLayout from "@/components/versado/ImmersiveLayout";
import { useBackNavigation } from "@/lib/navigationHistory";
import { useImmersiveShell } from "@/lib/shellModeOverride";
import {
  DORP_ASSETS,
  DORP_ASSET_BY_ID,
  DORP_OBJECT_BY_ID,
  DORP_OBJECTS,
  DORP_RESIDENTS,
  DORP_TERRAIN_RUNTIME_BY_ID,
  DORP_TERRAIN_RUNTIME_PATHS,
  assetForObject,
  forestAssetFor,
} from "@/lib/dorp/catalog";
import {
  DETAIL_CAMERA_ZOOM,
  NORMAL_CAMERA_ZOOM,
  clampCameraZoom,
  createRenderScheduler,
  fitCameraToRadius,
  minimumCameraZoom,
  screenToWorld,
  zoomCameraAroundPoint,
  type CameraInsets,
  type DorpCamera,
} from "@/lib/dorp/camera";
import {
  MAX_RADIUS,
  PROTOTYPE_PHASES,
  TILE_HEIGHT,
  TILE_WIDTH,
  buildableTileCount,
  chapterThresholdForPhase,
  forestPlacements,
  footprintTiles,
  isoToWorld,
  placementIsValid,
  radiusForPhase,
  suggestPlacement,
  worldToIso,
} from "@/lib/dorp/geometry";
import { availableInstance, levelOwnedInstance, placeOwnedInstance, placedObjects, reconcileInstancesForRadius, storeOwnedInstance } from "@/lib/dorp/ownership";
import { normalizePaths, paintPathSegment, paintPathTiles, pathConnectivityFromKeys, pathKey } from "@/lib/dorp/paths";
import { DEFAULT_DORP_STATE, DORP_LEGACY_STORAGE_KEYS, DORP_STORAGE_KEY, parseDorpState, serializeDorpState } from "@/lib/dorp/storage";
import { boundsContainViewport, forestLodStep, terrainAssetId, terrainBufferBounds, type TerrainWorldBounds } from "@/lib/dorp/terrain";
import type { ReactNode, SetStateAction } from "react";
import type { DorpSnapshot } from "@/lib/dorp/service";
import type { DorpObjectDefinition, DorpWorldState, PlacedDorpObject, TileCoordinate } from "@/lib/dorp/types";

type Placement = { objectId: string; instanceId: string; u: number; v: number; moving: boolean };
type PointerRecord = { x: number; y: number; startX: number; startY: number };
type RenderImageMap = Map<string, HTMLImageElement>;
type TerrainCache = {
  scaledCanvas: HTMLCanvasElement;
  scaledZoom: number;
  dpr: number;
  bounds: TerrainWorldBounds;
  radius: number;
  pathsKey: string;
  assetRevision: number;
  rasterScale: number;
};

const MIN_PLAY_ZOOM = 0.22;
const POINTER_MOVE_THRESHOLD = 6;
const categories = ["Gebouwen", "Bijzondere gebouwen", "Decoraties", "Natuur", "Bewoners"] as const;

function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill?: string, stroke?: string) {
  ctx.beginPath();
  ctx.moveTo(x, y - height / 2);
  ctx.lineTo(x + width / 2, y);
  ctx.lineTo(x, y + height / 2);
  ctx.lineTo(x - width / 2, y);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
}

function imageAssetPaths(): string[] {
  return [...new Set([...DORP_ASSETS.map((asset) => asset.path), ...DORP_TERRAIN_RUNTIME_PATHS])];
}

function spriteRegistration(object: PlacedDorpObject) {
  return assetForObject(object.objectId, object.level);
}

function cssPixels(name: string): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name);
  return Number.parseFloat(value) || 0;
}

function cameraInsets(): CameraInsets {
  return {
    top: cssPixels("--vs-safe-area-top") + 84,
    right: cssPixels("--vs-safe-area-right") + 12,
    bottom: cssPixels("--vs-safe-area-bottom") + 132,
    left: cssPixels("--vs-safe-area-left") + 12,
  };
}

function nearestPrototypePhase(phase: number) {
  return PROTOTYPE_PHASES.reduce((best, item) => Math.abs(item.id - phase) < Math.abs(best.id - phase) ? item : best);
}

export function DorpCanvas({
  world,
  markers = [],
  compact = false,
  editableIds,
  placement,
  selectedId,
  onPlacementMove,
  onSelectObject,
  pathMode, onPathStroke, onDragPreview, onDragEnd, onExplore,
  onCameraChange,
  cameraCommand,
}: {
  world: DorpWorldState;
  markers?: readonly {ownerId:string;label:string}[];
  compact?: boolean;
  editableIds?: ReadonlySet<string>;
  placement: Placement | null;
  selectedId: string | null;
  onPlacementMove: (tile: TileCoordinate) => void;
  onSelectObject: (instanceId: string | null) => void;
  pathMode: "paint" | "erase" | null;
  onPathStroke: (tiles: TileCoordinate[], erase: boolean) => void;
  onDragPreview: (instanceId: string, tile: TileCoordinate | null) => void;
  onDragEnd: (instanceId: string, tile: TileCoordinate | null) => void;
  onExplore: (hidden: boolean) => void;
  onCameraChange: (camera: DorpCamera) => void;
  cameraCommand: { id: number; kind: "detail" | "normal" | "current" | "full" | "in" | "out" | "center" };
}) {
  const markerRefs = useRef(new Map<string,HTMLAnchorElement>());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<RenderImageMap>(new Map());
  const terrainCacheRef = useRef<TerrainCache | null>(null);
  const spriteCacheRef = useRef(new Map<string, HTMLCanvasElement>());
  const cameraRef = useRef<DorpCamera>({ x: 0, y: 0, zoom: NORMAL_CAMERA_ZOOM });
  const pointersRef = useRef(new Map<number, PointerRecord>());
  const gestureRef = useRef({ moved: false, hadMultiplePointers: false, pinchDistance: 0, pinchZoom: NORMAL_CAMERA_ZOOM, pinchWorld: { x: 0, y: 0 } });
  const requestDrawRef = useRef<() => void>(() => undefined);
  const fitModeRef = useRef<"free" | "current" | "full">("free");
  const insetsRef = useRef<CameraInsets>({ top: 84, right: 12, bottom: 132, left: 12 });
  const dragRef = useRef<{ instanceId: string; offset: TileCoordinate; active: boolean } | null>(null);
  const strokeRef = useRef<TileCoordinate[]>([]);
  const [pathPreview, setPathPreview] = useState<TileCoordinate | null>(null);
  const [assetRevision, setAssetRevision] = useState(0);
  const measureInsets=useCallback(()=>compact?{top:4,right:4,bottom:4,left:4}:cameraInsets(),[compact]);
  const radius = radiusForPhase(world.phase);
  const objects = useMemo(() => placedObjects(world), [world]);

  useEffect(() => {
    let active = true;
    for (const path of imageAssetPaths()) {
      if (imagesRef.current.has(path)) continue;
      const image = new window.Image();
      image.decoding = "async";
      image.src = path;
      image.onload = () => { if (active) { imagesRef.current.set(path, image); setAssetRevision((value) => value + 1); } };
    }
    return () => { active = false; };
  }, []);

  const renderCamera = useCallback((notify = false) => {
    requestDrawRef.current();
    if (notify) onCameraChange({ ...cameraRef.current });
  }, [onCameraChange]);

  useEffect(() => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    const camera = cameraRef.current;
    const insets = measureInsets();
    insetsRef.current = insets;
    const minimum = minimumCameraZoom(box.width, box.height, insets);
    if (cameraCommand.kind === "detail") { camera.zoom = Math.max(DETAIL_CAMERA_ZOOM, minimum); fitModeRef.current = "free"; }
    if (cameraCommand.kind === "normal") { camera.zoom = Math.max(NORMAL_CAMERA_ZOOM, minimum); fitModeRef.current = "free"; }
    if (cameraCommand.kind === "in") { camera.zoom = clampCameraZoom(camera.zoom * 1.25, minimum); fitModeRef.current = "free"; }
    if (cameraCommand.kind === "out") { camera.zoom = clampCameraZoom(camera.zoom / 1.25, minimum); fitModeRef.current = "free"; }
    if (cameraCommand.kind === "current") { cameraRef.current = fitCameraToRadius(box.width, box.height, radius, insets); fitModeRef.current = "current"; }
    if (cameraCommand.kind === "full") { cameraRef.current = fitCameraToRadius(box.width, box.height, MAX_RADIUS+25, insets); fitModeRef.current = "full"; }
    if (cameraCommand.kind === "center") { camera.x = 0; camera.y = 0; fitModeRef.current = "free"; }
    renderCamera(true);
  }, [cameraCommand, radius, renderCamera, measureInsets]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const draw = () => {
      const bounds = container.getBoundingClientRect();
      // Op brede schermen is 1× voldoende voor deze geschilderde sprites en
      // voorkomt een viervoudig Canvas-oppervlak tijdens camerabeweging.
      const dpr = bounds.width >= 900 ? 1 : Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.round(bounds.width * dpr));
      const pixelHeight = Math.max(1, Math.round(bounds.height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      const width = bounds.width;
      const height = bounds.height;
      const camera = cameraRef.current;
      const zoom = camera.zoom;
      // Eén gedeeld, fysiek pixeluitgelijnd nulpunt voorkomt shimmer door
      // fractionele cameratranslatie zonder de tegels kunstmatig te overlappen.
      const originX = Math.round((width / 2 - camera.x * zoom) * dpr) / dpr;
      const originY = Math.round((height / 2 - camera.y * zoom) * dpr) / dpr;
      const screen = (x: number, y: number) => ({ x: originX + x * zoom, y: originY + y * zoom });
      const drawSprite = (image: HTMLImageElement, path: string, point: { x: number; y: number }, worldSize: readonly [number, number], anchor: readonly [number, number]) => {
        const drawWidth = worldSize[0] * zoom;
        const drawHeight = worldSize[1] * zoom;
        const pixelWidth = Math.max(1, Math.round(drawWidth * dpr));
        const pixelHeight = Math.max(1, Math.round(drawHeight * dpr));
        const key = `${path}:${pixelWidth}x${pixelHeight}`;
        let sprite = spriteCacheRef.current.get(key);
        if (!sprite) {
          sprite = document.createElement("canvas");
          sprite.width = pixelWidth;
          sprite.height = pixelHeight;
          const spriteContext = sprite.getContext("2d", { alpha: true })!;
          spriteContext.imageSmoothingEnabled = true;
          spriteContext.drawImage(image, 0, 0, pixelWidth, pixelHeight);
          if (spriteCacheRef.current.size > 160) spriteCacheRef.current.clear();
          spriteCacheRef.current.set(key, sprite);
        }
        ctx.drawImage(sprite, point.x - drawWidth * anchor[0], point.y - drawHeight * anchor[1], drawWidth, drawHeight);
      };
      const paths = new Map(world.paths.map((tile) => [pathKey(tile), tile]));
      const pathKeys = new Set(paths.keys());
      const pathsKey = world.paths.map(pathKey).sort().join(";");

      ctx.fillStyle = "#416438";
      ctx.fillRect(0, 0, width, height);
      // Wereldvast bos-LOD met begrensde schermdichtheid, ook buiten R62.
      // Dichte, overlappende assets gebruiken dezelfde bestaande spritecache.
      const step = forestLodStep(zoom);
      const forestSize = Math.max(360, step * 1.8);
      const minX = Math.floor((camera.x-width/2/zoom)/step)-1;
      const minY = Math.floor((camera.y-height/2/zoom)/step)-1;
      for(let gy=minY;gy<=minY+Math.ceil(height/zoom/step)+2;gy++) {
        for(let gx=minX;gx<=minX+Math.ceil(width/zoom/step)+2;gx++) {
          const hash=Math.abs((gx*73856093)^(gy*19349663));
          const x=(gx+.25+(hash%19)/100)*step,y=(gy+.25+((hash>>>6)%19)/100)*step;
          const tile=worldToIso(x,y);
          if(Math.hypot(tile.u,tile.v)<radius-forestSize/24)continue;
          const p=screen(x,y),asset=DORP_ASSET_BY_ID.get(hash%2?"forest-dense":"forest-dense-v2")!,image=imagesRef.current.get(asset.path);
          if(image) {
            drawSprite(image,asset.path,p,[forestSize,forestSize],asset.anchor);
          }
        }
      }

      const overview = zoom < 0.18 || width / zoom + 384 > 8192 || height / zoom + 384 > 8192;
      if (overview) {
        for(let u=-radius;u<=radius;u++) for(let v=-radius;v<=radius;v++) {
          if(u*u+v*v>radius*radius) continue;
          const point=isoToWorld(u,v), p=screen(point.x,point.y);
          const path=paths.has(`${u},${v}`);
          drawDiamond(ctx,p.x,p.y,TILE_WIDTH*zoom+.5,TILE_HEIGHT*zoom+.5,path?"#c5a56e":((u+v)%3===0?"#8eb65e":"#86ae57"));
        }
      } else {
        const rasterScale = zoom < 0.36 ? 0.25 : zoom < 0.76 ? 0.5 : 1;
        let terrainCache = terrainCacheRef.current;
        if (!terrainCache
          || terrainCache.radius !== radius
          || terrainCache.pathsKey !== pathsKey
          || terrainCache.assetRevision !== assetRevision
          || terrainCache.rasterScale !== rasterScale
          || terrainCache.dpr !== dpr
          || !boundsContainViewport(terrainCache.bounds, camera.x, camera.y, zoom, width, height)) {
          const terrainBounds = terrainBufferBounds(camera.x, camera.y, zoom, width, height, rasterScale);
          const terrainCanvas = document.createElement("canvas");
          terrainCanvas.width = (terrainBounds.maxX - terrainBounds.minX) * rasterScale;
          terrainCanvas.height = (terrainBounds.maxY - terrainBounds.minY) * rasterScale;
          const terrainContext = terrainCanvas.getContext("2d", { alpha: true })!;
          terrainContext.imageSmoothingEnabled = false;
          for (let sum = -radius * 2; sum <= radius * 2; sum += 1) {
            for (let u = -radius; u <= radius; u += 1) {
              const v = sum - u;
              if (v < -radius || v > radius || u * u + v * v > radius * radius) continue;
              const worldPoint = isoToWorld(u, v);
              if (worldPoint.x + TILE_WIDTH / 2 < terrainBounds.minX || worldPoint.x - TILE_WIDTH / 2 > terrainBounds.maxX
                || worldPoint.y + TILE_HEIGHT / 2 < terrainBounds.minY || worldPoint.y - TILE_HEIGHT / 2 > terrainBounds.maxY) continue;
              const pathTile = paths.get(`${u},${v}`);
              const assetId = terrainAssetId(u, v, pathTile ? pathConnectivityFromKeys(pathTile, pathKeys) : undefined);
              const runtime = DORP_TERRAIN_RUNTIME_BY_ID.get(assetId);
              const terrainPath = rasterScale === 1 ? runtime?.full : rasterScale === 0.5 ? runtime?.half : runtime?.quarter;
              const terrain = terrainPath ? imagesRef.current.get(terrainPath) : undefined;
              const x = (worldPoint.x - terrainBounds.minX) * rasterScale;
              const y = (worldPoint.y - terrainBounds.minY) * rasterScale;
              if (terrain) terrainContext.drawImage(terrain, x - TILE_WIDTH * rasterScale / 2, y - TILE_HEIGHT * rasterScale / 2);
              else drawDiamond(terrainContext, x, y, TILE_WIDTH * rasterScale, TILE_HEIGHT * rasterScale, (u + v) % 3 === 0 ? "#8eb65e" : "#86ae57");
            }
          }
          const scaledCanvas = document.createElement("canvas");
          scaledCanvas.width = Math.max(1, Math.round(terrainCanvas.width / rasterScale * zoom * dpr));
          scaledCanvas.height = Math.max(1, Math.round(terrainCanvas.height / rasterScale * zoom * dpr));
          const scaledContext = scaledCanvas.getContext("2d", { alpha: true })!;
          scaledContext.imageSmoothingEnabled = true;
          scaledContext.drawImage(terrainCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
          terrainCache = { scaledCanvas, scaledZoom: zoom, dpr, bounds: terrainBounds, radius, pathsKey, assetRevision, rasterScale };
          terrainCacheRef.current = terrainCache;
        }
        const cachedScale = zoom / terrainCache.scaledZoom;
        ctx.drawImage(
          terrainCache.scaledCanvas,
          originX + terrainCache.bounds.minX * zoom,
          originY + terrainCache.bounds.minY * zoom,
          terrainCache.scaledCanvas.width / terrainCache.dpr * cachedScale,
          terrainCache.scaledCanvas.height / terrainCache.dpr * cachedScale,
        );
      }

      // Deterministische, niet-geografische ring; geen volledige vriendendorpen.
      markers.forEach((marker,index)=>{
        const angle=index*Math.PI*2/Math.max(1,markers.length);
        const world=isoToWorld(Math.cos(angle)*(MAX_RADIUS+14),Math.sin(angle)*(MAX_RADIUS+14));
        const point=screen(world.x,world.y),link=markerRefs.current.get(marker.ownerId);
        if(link){link.style.left=`${point.x}px`;link.style.top=`${point.y}px`;link.hidden=!(cameraCommand.kind==="full"||zoom<.12)||point.x<32||point.x>width-32||point.y<48||point.y>height-48;}
      });
      type LayerItem = { depth: number; draw: () => void };
      const layers: LayerItem[] = [];
      {
        for (const { index, u, v } of forestPlacements(radius)) {
          const point = isoToWorld(u, v);
          const registration = forestAssetFor(index, u, v);
          const image = imagesRef.current.get(registration.path);
          if (!image) continue;
          const position = screen(point.x, point.y);
          const drawWidth = registration.worldSize[0] * zoom;
          const drawHeight = registration.worldSize[1] * zoom;
          if (position.x + drawWidth * (1 - registration.anchor[0]) < 0 || position.x - drawWidth * registration.anchor[0] > width
            || position.y + drawHeight * (1 - registration.anchor[1]) < 0 || position.y - drawHeight * registration.anchor[1] > height) continue;
          layers.push({ depth: u + v - 0.5, draw: () => {
            drawSprite(image, registration.path, position, registration.worldSize, registration.anchor);
          }});
        }
      }

      for (const object of objects) {
        const definition = DORP_OBJECT_BY_ID.get(object.objectId);
        const registration = spriteRegistration(object);
        const image = registration ? imagesRef.current.get(registration.path) : undefined;
        if (!definition || !registration) continue;
        const anchorTile = { u: object.u + definition.footprint[0] - 1, v: object.v + definition.footprint[1] - 1 };
        const worldPoint = isoToWorld(anchorTile.u, anchorTile.v);
        layers.push({ depth: anchorTile.u + anchorTile.v, draw: () => {
          const point = screen(worldPoint.x, worldPoint.y);
          if (object.instanceId === selectedId) {
            ctx.lineWidth = 1.5;
            for (const tile of footprintTiles(object.u, object.v, definition.footprint)) {
              const p = isoToWorld(tile.u, tile.v); const s = screen(p.x, p.y);
              drawDiamond(ctx, s.x, s.y, TILE_WIDTH * zoom, TILE_HEIGHT * zoom, "rgba(255,255,255,.17)", "rgba(255,255,255,.7)");
            }
          }
          if (image) drawSprite(image, registration.path, point, registration.worldSize, registration.anchor);
        }});
      }

      layers.sort((a, b) => a.depth - b.depth).forEach((layer) => layer.draw());

      if(pathMode && pathPreview) {
        for(const tile of (strokeRef.current.length ? strokeRef.current : [pathPreview])) {
          const p=isoToWorld(tile.u,tile.v), point=screen(p.x,p.y);
          const valid=tile.u*tile.u+tile.v*tile.v<=radius*radius;
          drawDiamond(ctx,point.x,point.y,TILE_WIDTH*zoom,TILE_HEIGHT*zoom,valid&&pathMode==="paint"?"rgba(202,159,83,.65)":"rgba(220,50,47,.45)","#fff");
        }
      }
      if (placement) {
        const definition = DORP_OBJECT_BY_ID.get(placement.objectId);
        if (definition) {
          const valid = placementIsValid(placement, objects, radius);
          ctx.lineWidth = 2;
          for (const tile of footprintTiles(placement.u, placement.v, definition.footprint)) {
            const p = isoToWorld(tile.u, tile.v); const s = screen(p.x, p.y);
            drawDiamond(ctx, s.x, s.y, TILE_WIDTH * zoom, TILE_HEIGHT * zoom, valid ? "rgba(37,176,98,.32)" : "rgba(220,50,47,.35)", valid ? "#18794e" : "#c32f27");
          }
          const registration = assetForObject(placement.objectId, world.instances.find((item) => item.instanceId === placement.instanceId)?.level ?? 1);
          const image = registration ? imagesRef.current.get(registration.path) : undefined;
          if (registration && image) {
            const anchor = { u: placement.u + definition.footprint[0] - 1, v: placement.v + definition.footprint[1] - 1 };
            const p = isoToWorld(anchor.u, anchor.v); const s = screen(p.x, p.y);
            ctx.globalAlpha = 0.72;
            drawSprite(image, registration.path, s, registration.worldSize, registration.anchor);
            ctx.globalAlpha = 1;
          }
        }
      }
    };

    const scheduler = createRenderScheduler(requestAnimationFrame, cancelAnimationFrame, draw);
    requestDrawRef.current = scheduler.request;
    // De eerste bruikbare render is synchroon: achtergrondtabs en sommige
    // WebViews kunnen requestAnimationFrame vóór de eerste paint uitstellen.
    scheduler.drawNow();
    const resize = new ResizeObserver(() => {
      const bounds = container.getBoundingClientRect();
      insetsRef.current = measureInsets();
      if (fitModeRef.current === "current") cameraRef.current = fitCameraToRadius(bounds.width, bounds.height, radius, insetsRef.current);
      if (fitModeRef.current === "full") cameraRef.current = fitCameraToRadius(bounds.width, bounds.height, MAX_RADIUS+25, insetsRef.current);
      scheduler.request();
      onCameraChange({ ...cameraRef.current });
    });
    resize.observe(container);
    return () => { resize.disconnect(); scheduler.cancel(); requestDrawRef.current = () => undefined; };
  }, [assetRevision, objects, onCameraChange, placement, radius, selectedId, world.instances, world.paths, pathMode, pathPreview, measureInsets, cameraCommand.kind, markers]);

  const eventToWorld = useCallback((clientX: number, clientY: number) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    const camera = cameraRef.current;
    return screenToWorld(camera, bounds.width, bounds.height, clientX - bounds.left, clientY - bounds.top);
  }, []);

  const handleTap = useCallback((x: number, y: number) => {
    const worldPoint = eventToWorld(x, y);
    const tile = worldToIso(worldPoint.x, worldPoint.y);
    if (placement) { onPlacementMove(tile); return; }
    const object = [...objects].reverse().find((item) => {
      const definition = DORP_OBJECT_BY_ID.get(item.objectId);
      return definition && tile.u >= item.u && tile.u < item.u + definition.footprint[0] && tile.v >= item.v && tile.v < item.v + definition.footprint[1];
    });
    onExplore(false);
    onSelectObject(object?.instanceId ?? null);
  }, [eventToWorld, objects, onPlacementMove, onSelectObject, onExplore, placement]);

  return (
    <div ref={containerRef} className="absolute inset-0 touch-none select-none overflow-hidden" data-dorp-canvas>
      {markers.map(marker=><Link key={marker.ownerId} ref={node=>{if(node)markerRefs.current.set(marker.ownerId,node);else markerRefs.current.delete(marker.ownerId);}} hidden href={`/dorp/visit/${encodeURIComponent(marker.ownerId)}`} data-dorp-friend-marker className="absolute z-[1] flex min-h-11 min-w-11 max-w-28 -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-xl border border-vs-line bg-vs-surface/95 p-2 text-xs font-bold shadow-lg" aria-label={marker.label} title={marker.label}><Home className="h-5 w-5 shrink-0" aria-hidden/><span className="sm:hidden" aria-hidden>{Array.from(marker.label).slice(0,2).join("")}</span><span className="hidden truncate sm:inline">{marker.label}</span></Link>)}
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab active:cursor-grabbing"
        aria-label="Interactieve isometrische dorpskaart"
        aria-busy={assetRevision < imageAssetPaths().length}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={(event) => {
          event.preventDefault();
          const bounds = canvasRef.current!.getBoundingClientRect();
          const minimum = minimumCameraZoom(bounds.width, bounds.height, insetsRef.current);
          const zoom = clampCameraZoom(cameraRef.current.zoom * Math.exp(-event.deltaY * 0.001), minimum);
          cameraRef.current = zoomCameraAroundPoint(cameraRef.current, bounds.width, bounds.height, event.clientX - bounds.left, event.clientY - bounds.top, zoom);
          fitModeRef.current = "free";
          renderCamera(true);
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          if (pointersRef.current.size === 0) gestureRef.current = { moved: false, hadMultiplePointers: false, pinchDistance: 0, pinchZoom: cameraRef.current.zoom, pinchWorld: { x: 0, y: 0 } };
          pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY });
          if(pointersRef.current.size===1) {
            const wp=eventToWorld(event.clientX,event.clientY), tile=worldToIso(wp.x,wp.y);
            const selected=objects.find(o=>o.instanceId===selectedId);
            const definition=selected?DORP_OBJECT_BY_ID.get(selected.objectId):null;
            dragRef.current=placement ? {instanceId:placement.instanceId,offset:{u:0,v:0},active:false} : selected&&(!editableIds||editableIds.has(selected.instanceId))&&definition&&tile.u>=selected.u&&tile.v>=selected.v&&tile.u<selected.u+definition.footprint[0]&&tile.v<selected.v+definition.footprint[1]
              ? {instanceId:selected.instanceId,offset:{u:tile.u-selected.u,v:tile.v-selected.v},active:false}:null;
            if(pathMode) {strokeRef.current=[tile];setPathPreview(tile);}
          }
          if (pointersRef.current.size === 2) {
            if(dragRef.current)onDragEnd(dragRef.current.instanceId,null);
            dragRef.current=null;strokeRef.current=[];setPathPreview(null);
            const points = [...pointersRef.current.values()];
            const bounds = canvasRef.current!.getBoundingClientRect();
            const midpoint = { x: (points[0].x + points[1].x) / 2 - bounds.left, y: (points[0].y + points[1].y) / 2 - bounds.top };
            gestureRef.current.hadMultiplePointers = true;
            gestureRef.current.pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            gestureRef.current.pinchZoom = cameraRef.current.zoom;
            gestureRef.current.pinchWorld = screenToWorld(cameraRef.current, bounds.width, bounds.height, midpoint.x, midpoint.y);
          }
        }}
        onPointerMove={(event) => {
          if (!pointersRef.current.has(event.pointerId)) return;
          const previous = pointersRef.current.get(event.pointerId)!;
          pointersRef.current.set(event.pointerId, { ...previous, x: event.clientX, y: event.clientY });
          const dx = event.clientX - previous.x; const dy = event.clientY - previous.y;
          const travel = Math.hypot(event.clientX - previous.startX, event.clientY - previous.startY);
          if (travel >= POINTER_MOVE_THRESHOLD) gestureRef.current.moved = true;
          const points = [...pointersRef.current.values()];
          const camera = cameraRef.current;
          if (points.length === 2) {
            const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const bounds = canvasRef.current!.getBoundingClientRect();
            const midpoint = { x: (points[0].x + points[1].x) / 2 - bounds.left, y: (points[0].y + points[1].y) / 2 - bounds.top };
            const minimum = minimumCameraZoom(bounds.width, bounds.height, insetsRef.current);
            const zoom = clampCameraZoom(gestureRef.current.pinchZoom * distance / Math.max(1, gestureRef.current.pinchDistance), minimum);
            camera.x = gestureRef.current.pinchWorld.x - (midpoint.x - bounds.width / 2) / zoom;
            camera.y = gestureRef.current.pinchWorld.y - (midpoint.y - bounds.height / 2) / zoom;
            camera.zoom = zoom;
          } else if (points.length === 1 && !gestureRef.current.hadMultiplePointers) {
            const wp=eventToWorld(event.clientX,event.clientY), tile=worldToIso(wp.x,wp.y);
            if(pathMode) {
              const last=strokeRef.current.at(-1)??tile;
              strokeRef.current=paintPathSegment(strokeRef.current,last,tile,radius);
              setPathPreview(tile);renderCamera();return;
            }
            if(dragRef.current && gestureRef.current.moved) {
              dragRef.current.active=true;
              onDragPreview(dragRef.current.instanceId,{u:tile.u-dragRef.current.offset.u,v:tile.v-dragRef.current.offset.v});return;
            }
            if(placement) { onPlacementMove(tile); return; }
            if(gestureRef.current.moved)onExplore(true);
            camera.x -= dx / camera.zoom; camera.y -= dy / camera.zoom;
          }
          fitModeRef.current = "free";
          renderCamera();
        }}
        onPointerUp={(event) => {
          const wasTap = !gestureRef.current.moved && !gestureRef.current.hadMultiplePointers && pointersRef.current.size === 1;
          pointersRef.current.delete(event.pointerId);
          if(!gestureRef.current.hadMultiplePointers && pointersRef.current.size===0) {
            if(pathMode && strokeRef.current.length)onPathStroke(strokeRef.current,pathMode==="erase");
            else if(dragRef.current?.active) {
              const wp=eventToWorld(event.clientX,event.clientY),tile=worldToIso(wp.x,wp.y);
              onDragEnd(dragRef.current.instanceId,{u:tile.u-dragRef.current.offset.u,v:tile.v-dragRef.current.offset.v});
            } else if(wasTap)handleTap(event.clientX,event.clientY);
          }
          dragRef.current=null;strokeRef.current=[];setPathPreview(null);
          renderCamera(true);
        }}
        onLostPointerCapture={(event) => { if(!pointersRef.current.has(event.pointerId))return; if(dragRef.current)onDragEnd(dragRef.current.instanceId,null);dragRef.current=null;strokeRef.current=[];setPathPreview(null);pointersRef.current.delete(event.pointerId);gestureRef.current.hadMultiplePointers=true;renderCamera(true); }}
        onPointerCancel={(event) => { if(dragRef.current)onDragEnd(dragRef.current.instanceId,null);dragRef.current=null;strokeRef.current=[];setPathPreview(null);pointersRef.current.delete(event.pointerId); gestureRef.current.hadMultiplePointers = true; renderCamera(true); }}
      />
    </div>
  );
}

export type DorpControlledProps = { snapshot: DorpSnapshot; backHref?: string; busy: boolean; onChange: (next:DorpWorldState)=>void; onRequest:(id:string)=>void; controls:ReactNode; markers?:readonly {ownerId:string;label:string}[] };
export default function DorpPrototypeClient({controlled}:{controlled?:DorpControlledProps}={}) {
  useImmersiveShell();
  const t=useT();
  const goBack = useBackNavigation(controlled ? controlled.backHref ?? "/dashboard" : "/adminbackend/spellen");
  const [localWorld, setLocalWorld] = useState<DorpWorldState>(DEFAULT_DORP_STATE);
  const world=controlled?.snapshot.world??localWorld;
  const setWorld=(action:SetStateAction<DorpWorldState>)=>{
    if(controlled){if(controlled.busy||controlled.snapshot.readOnly)return;controlled.onChange(typeof action==="function"?action(world):action);}
    else setLocalWorld(action);
  };
  const ownedIds=controlled?new Set(controlled.snapshot.ownedIds):undefined;
  const readOnly=controlled?.snapshot.readOnly??false;
  const [loaded, setLoaded] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pathMode,setPathMode]=useState<"paint"|"erase"|null>(null);
  const [controlsHidden,setControlsHidden]=useState(false);
  const [directDragging,setDirectDragging]=useState(false);
  const [phaseMessage, setPhaseMessage] = useState<string | null>(null);
  const [camera, setCamera] = useState<DorpCamera>({ x: 0, y: 0, zoom: NORMAL_CAMERA_ZOOM });
  const [cameraCommand, setCameraCommand] = useState<{ id: number; kind: "detail" | "normal" | "current" | "full" | "in" | "out" | "center" }>({ id: 0, kind: "normal" });
  const objects = useMemo(() => placedObjects(world), [world]);
  const selected = world.instances.find((instance) => instance.instanceId === selectedId && instance.position) ?? null;
  const selectedDefinition = selected ? DORP_OBJECT_BY_ID.get(selected.objectId) : null;
  const selectedResident = DORP_RESIDENTS.find((resident) => resident.objectId === selected?.objectId) ?? null;
  const radius = radiusForPhase(world.phase);
  const activePhase = nearestPrototypePhase(world.phase);

  useEffect(() => {
    if(controlled)return;
    // Na hydration lezen voorkomt dat een eerdere lokale kaart een ander server-HTML-resultaat geeft.
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem(DORP_STORAGE_KEY) ?? window.localStorage.getItem("versado-dorp-prototype-v2");
      const legacyPresent = stored === null && DORP_LEGACY_STORAGE_KEYS.some((key) => window.localStorage.getItem(key) !== null);
      setLocalWorld(parseDorpState(stored));
      if (legacyPresent) setPhaseMessage("Prototypeopslag v1 is niet overgenomen door het nieuwe R8-eigendomsmodel. Gebruik ‘Testdata herstellen’ om de oude testopslag te wissen.");
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [controlled]);

  useEffect(() => {
    if (loaded && !controlled) window.localStorage.setItem(DORP_STORAGE_KEY, serializeDorpState(world));
  }, [loaded, world, controlled]);

  const issueCameraCommand = (kind: typeof cameraCommand.kind) => setCameraCommand((value) => ({ id: value.id + 1, kind }));
  const placementValid = placement ? placementIsValid(placement, objects, radius) : false;

  const chooseObject = (definition: DorpObjectDefinition) => {
    const instance = availableInstance({instances:world.instances.filter(i=>!ownedIds||ownedIds.has(i.instanceId))}, definition.id);
    if (!instance) return;
    const proposed = suggestPlacement(definition.id, objects, radius, { u: 0, v: 0 }, instance.instanceId) ?? { u: 0, v: 0 };
    setPlacement({ objectId: definition.id, instanceId: instance.instanceId, ...proposed, moving: false });
    setSelectedId(null); setPathMode(null); setInventoryOpen(false);
    if (camera.zoom < MIN_PLAY_ZOOM) issueCameraCommand("normal");
  };

  const confirmPlacement = () => {
    if (!placement || !placementValid) return;
    setWorld((current) => {
      if (!current.instances.some((instance) => instance.instanceId === placement.instanceId && instance.objectId === placement.objectId)) return current;
      return { ...current, instances: placeOwnedInstance(current.instances, placement.instanceId, { u: placement.u, v: placement.v }) };
    });
    setSelectedId(placement.instanceId); setPlacement(null);
  };

  const propose = () => {
    if (!placement) return;
    const tile = suggestPlacement(placement.objectId, objects, radius, worldToIso(camera.x, camera.y), placement.instanceId);
    if (tile) setPlacement({ ...placement, ...tile });
  };

  const setLevel = (level: 1 | 2 | 3) => {
    if (!selected || !selectedDefinition || level > selectedDefinition.maxLevel) return;
    setWorld((current) => ({ ...current, instances: levelOwnedInstance(current.instances, selected.instanceId, level) }));
  };

  const storeSelected = () => {
    if (!selected) return;
    setWorld((current) => ({ ...current, instances: storeOwnedInstance(current.instances, selected.instanceId) }));
    setSelectedId(null);
  };

  const changePhase = (phase: number) => {
    setWorld((current) => {
      const reconciled = reconcileInstancesForRadius(current.instances, radiusForPhase(phase));
      setPhaseMessage(reconciled.storedCount > 0 ? `${reconciled.storedCount} object${reconciled.storedCount === 1 ? "" : "en"} veilig opgeborgen buiten het kleinere gebied.` : null);
      return { ...current, phase, instances: reconciled.instances, paths: normalizePaths(current.paths, radiusForPhase(phase)) };
    });
    setPlacement(null); setSelectedId(null);
    issueCameraCommand("current");
  };

  const reset = () => {
    if (!window.confirm("De lokale prototype-indeling wissen en de testopstelling herstellen?")) return;
    window.localStorage.removeItem(DORP_STORAGE_KEY);
    for (const key of DORP_LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
    setWorld(structuredClone(DEFAULT_DORP_STATE)); setPlacement(null); setSelectedId(null); setPathMode(null);
    setPhaseMessage(null);
    issueCameraCommand("normal");
  };

  const inventoryByCategory = useMemo(() => categories.map((category) => ({ category, objects: DORP_OBJECTS.filter((object) => object.category === category) })), []);

  return (
    <ImmersiveLayout className="relative overflow-hidden bg-vs-surface text-vs-fg-1" data-dorp-prototype>
      <div className="absolute inset-0" style={controlled?.busy?{pointerEvents:"none"}:undefined}>
      <DorpCanvas
        world={world}
        markers={controlled?.markers}
        editableIds={ownedIds}
        placement={placement}
        selectedId={selectedId}
        onPlacementMove={(tile) => placement && setPlacement({ ...placement, ...tile })}
        onSelectObject={setSelectedId}
        pathMode={pathMode}
        onExplore={setControlsHidden}
        onPathStroke={(tiles,erase)=>setWorld(current=>({ ...current, paths:paintPathTiles(current.paths,tiles,radiusForPhase(current.phase),erase) }))}
        onDragPreview={(id,tile)=>{setDirectDragging(true);const instance=world.instances.find(i=>i.instanceId===id);if(instance&&tile)setPlacement({objectId:instance.objectId,instanceId:id,...tile,moving:true});}}
        onDragEnd={(id,tile)=>{setDirectDragging(false);const item=world.instances.find(i=>i.instanceId===id);if(!tile||!item||!placementIsValid({...tile,instanceId:id,objectId:item.objectId},objects,radius)){if(item?.position)setPlacement(null);return;}if(tile)setWorld(current=>{const item=current.instances.find(i=>i.instanceId===id);return item&&placementIsValid({...tile,instanceId:id,objectId:item.objectId},placedObjects(current),radiusForPhase(current.phase))?{...current,instances:placeOwnedInstance(current.instances,id,tile)}:current;});setPlacement(null);}}
        onCameraChange={setCamera}
        cameraCommand={cameraCommand}
      />
      </div>

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-[max(.75rem,var(--vs-safe-area-top))_max(.75rem,var(--vs-safe-area-right))_max(.75rem,var(--vs-safe-area-bottom))_max(.75rem,var(--vs-safe-area-left))]">
        <header className="pointer-events-auto flex min-w-0 items-start justify-between gap-2">
          <button type="button" onClick={goBack} className="btn !h-[44px] !w-[44px] !min-w-[44px] shrink-0 !border-white/40 !bg-vs-surface/90 !p-0 shadow-lg backdrop-blur sm:!w-auto sm:!px-3" aria-label="Versado Dorp sluiten">
            <X className="h-[20px] w-[20px]" aria-hidden /> <span className="hidden sm:inline">Sluiten</span>
          </button>
          <div className="pointer-events-none min-w-0 flex-1 rounded-2xl border border-white/40 bg-vs-surface/90 px-3 py-2 text-center shadow-lg backdrop-blur">
            <p className="truncate text-sm font-bold">{controlled?"Versado Dorp":"Versado Dorp · technisch prototype"}</p>
            <p className="truncate text-xs text-vs-fg-3">{cameraCommand.kind === "full" ? `${t("dorp2.futureWorld")} R${MAX_RADIUS} · ${t("dorp2.fitMap")} R${radius}` : `${activePhase.label} · R${radius} · ${buildableTileCount(radius).toLocaleString("nl-NL")} tegels`}</p>
          </div>
          {!controlled && <button type="button" onClick={() => setDeveloperOpen((value) => !value)} className="btn !h-[44px] !w-[44px] !min-w-[44px] shrink-0 !border-white/40 !bg-vs-surface/90 !p-0 shadow-lg backdrop-blur sm:!w-auto sm:!px-3" aria-expanded={developerOpen} aria-label="Testmenu">
            <Box className="h-[20px] w-[20px]" aria-hidden /> <span className="hidden sm:inline">Testmenu</span>
          </button>}
        </header>

        {controlled && <div className="pointer-events-auto mt-2 max-h-[35dvh] overflow-y-auto rounded-2xl bg-vs-surface/95 p-2 shadow-lg">{controlled.controls}</div>}
        {developerOpen && !controlled && (
          <section className="pointer-events-auto mt-2 ml-auto max-h-[65dvh] w-[min(100%,22rem)] overflow-y-auto rounded-2xl border border-vs-line bg-vs-surface/95 p-3 shadow-xl backdrop-blur" aria-label="Ontwikkelmenu kaartuitbreiding">
            <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-bold">Kaartfase testen</h2><button type="button" onClick={() => setDeveloperOpen(false)} aria-label="Testmenu sluiten"><ChevronUp className="h-5 w-5" /></button></div>
            <div className="grid grid-cols-2 gap-2">
              {PROTOTYPE_PHASES.map((phase) => <button key={phase.id} type="button" onClick={() => changePhase(phase.id)} className={`btn min-h-11 break-normal text-xs ${world.phase === phase.id ? "!border-vs-accent !bg-vs-accent-soft" : "!bg-vs-surface"}`}>{phase.label}<br />R{phase.radius}</button>)}
            </div>
            <p className="mt-2 text-xs text-vs-fg-3">Volgende fixture: R{radiusForPhase(world.phase + 1)} · drempel {chapterThresholdForPhase(world.phase + 1)} hoofdstukken, nog niet gekoppeld aan leesvoortgang.</p>
            {phaseMessage && <p className="mt-2 rounded-xl bg-vs-accent-soft p-2 text-xs font-semibold text-vs-accent" role="status">{phaseMessage}</p>}
            <button type="button" onClick={reset} className="btn mt-3 min-h-11 w-full !border-red-300 !bg-red-50 text-red-800"><RotateCcw className="h-4 w-4" /> Testdata herstellen</button>
          </section>
        )}

        {controlsHidden && <button type="button" onClick={()=>setControlsHidden(false)} className="btn pointer-events-auto mt-auto self-end !bg-vs-surface/95">{t("dorp2.controls")}</button>}
        <div className={`${controlsHidden||pathMode?"hidden":"flex"} mt-auto w-full min-w-0 flex-wrap items-end gap-2`}>
          <div className="pointer-events-auto flex min-w-[132px] flex-1 flex-col gap-2">
            <div className="flex rounded-2xl border border-white/40 bg-vs-surface/90 p-1 shadow-lg backdrop-blur">
              <button type="button" onClick={() => issueCameraCommand("out")} className="min-h-[44px] min-w-[44px] flex-1 rounded-xl" aria-label="Uitzoomen"><Minus className="mx-auto h-5 w-5" /></button>
              <button type="button" onClick={() => issueCameraCommand("in")} className="min-h-[44px] min-w-[44px] flex-1 rounded-xl" aria-label="Inzoomen"><Plus className="mx-auto h-5 w-5" /></button>
              <button type="button" onClick={() => issueCameraCommand("center")} className="min-h-[44px] min-w-[44px] flex-1 rounded-xl" aria-label="Camera centreren"><Crosshair className="mx-auto h-5 w-5" /></button>
            </div>
            <details className="rounded-2xl border border-white/40 bg-vs-surface/90 p-1 text-xs shadow-lg backdrop-blur"><summary className="min-h-11 cursor-pointer p-2">{t("dorp2.views")}</summary><div className="grid grid-cols-2 gap-1 [overflow-wrap:normal]">
              <button type="button" onClick={() => issueCameraCommand("detail")} className="min-h-11 min-w-0 flex-1 rounded-xl px-1">{t("dorp2.detail")}</button>
              <button type="button" onClick={() => issueCameraCommand("normal")} className="min-h-11 min-w-0 flex-1 rounded-xl px-1">{t("dorp2.normal")}</button>
              <button type="button" onClick={() => issueCameraCommand("current")} className="min-h-11 min-w-0 flex-1 rounded-xl px-1" aria-label="Huidige kaart volledig tonen"><Focus className="mx-auto h-4 w-4" />{t("dorp2.fitMap")}</button>
              <button type="button" onClick={() => issueCameraCommand("full")} className="min-h-11 min-w-0 flex-1 rounded-xl px-1" aria-label="Maximale toekomstige wereld tonen"><Globe2 className="mx-auto h-4 w-4" />{t("dorp2.futureWorld")}</button>
            </div></details>
          </div>

          {!readOnly && <button type="button" onClick={() => setInventoryOpen(true)} className="btn pointer-events-auto min-h-12 max-w-full shrink-0 whitespace-normal !border-white/40 !bg-vs-surface/95 px-2 text-sm shadow-xl backdrop-blur sm:px-4"><Package className="h-5 w-5" /> Bouwen</button>}
        </div>
      </div>

      {pathMode && !readOnly && <div className="absolute inset-x-3 bottom-[max(.75rem,var(--vs-safe-area-bottom))] z-20 grid max-h-[45dvh] [grid-template-columns:repeat(auto-fit,minmax(min(100%,8rem),1fr))] gap-2 overflow-y-auto rounded-2xl bg-vs-surface/95 p-3 shadow-xl" data-dorp-path-mode>
        <details className="col-span-full min-w-0 text-sm"><summary className="min-h-11 cursor-pointer py-2 font-semibold">{t("dorp2.pathTitle")}</summary><p>{t("dorp2.pathHelp")}</p></details>
        <button className="btn min-h-[44px] !px-[12px] !py-[8px] break-normal [overflow-wrap:normal]" aria-pressed={pathMode==="paint"} onClick={()=>setPathMode("paint")}>{t("dorp2.paint")}</button>
        <button className="btn min-h-[44px] !px-[12px] !py-[8px] break-normal [overflow-wrap:normal]" aria-pressed={pathMode==="erase"} onClick={()=>setPathMode("erase")}>{t("dorp2.erase")}</button>
        <button className="btn min-h-[44px] !px-[12px] !py-[8px] break-normal [overflow-wrap:normal]" onClick={()=>setPathMode(null)}>{t("common.close")}</button>
      </div>}
      {placement && !directDragging && (
        <div className="absolute inset-x-0 bottom-[max(.75rem,var(--vs-safe-area-bottom))] z-20 mx-auto flex max-h-[45dvh] w-[min(calc(100%-1.5rem),32rem)] overflow-y-auto flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/40 bg-vs-surface/95 p-3 shadow-2xl backdrop-blur">
          <p className="w-full text-center text-sm font-semibold">{DORP_OBJECT_BY_ID.get(placement.objectId)?.name} · {placementValid ? "geldige plek" : "ongeldige plek"}</p>
          <button type="button" onClick={propose} className="btn min-h-11 !bg-vs-surface"><Sparkles className="h-4 w-4" /> Stel een plek voor</button>
          <button type="button" onClick={() => setPlacement(null)} className="btn min-h-11 !bg-vs-surface">Annuleren</button>
          <button type="button" disabled={!placementValid} onClick={confirmPlacement} className="btn-primary min-h-11 disabled:opacity-50">Plaatsen</button>
        </div>
      )}

      {inventoryOpen && !readOnly && (
        <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(92vw,27rem)] flex-col border-l border-vs-line bg-vs-surface shadow-2xl pt-[max(1rem,var(--vs-safe-area-top))] pr-[max(1rem,var(--vs-safe-area-right))] pb-[max(1rem,var(--vs-safe-area-bottom))] pl-4" aria-label="Bouwinventaris">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Bouwinventaris</h2><p className="text-xs text-vs-fg-3">{controlled?t("dorp2.pilot"):"Expliciete prototypefixtures · geen vrijspeelstatus"}</p></div><button type="button" onClick={() => setInventoryOpen(false)} className="min-h-11 min-w-11" aria-label="Inventaris sluiten"><X className="mx-auto h-5 w-5" /></button></div>
          <button type="button" className="btn-primary mt-3 min-h-14 w-full justify-start !whitespace-normal text-left" onClick={()=>{setPathMode("paint");setPlacement(null);setSelectedId(null);setInventoryOpen(false);}}>{t("dorp2.paths")}</button>
          <div className="mt-4 flex-1 space-y-5 overflow-y-auto overscroll-contain pr-1">
            {inventoryByCategory.map(({ category, objects: definitions }) => definitions.length > 0 && <section key={category}><h3 className="mb-2 text-sm font-bold text-vs-fg-2">{category==="Bewoners"?t("dorp2.residents"):category}</h3><div className="grid grid-cols-2 gap-2">{definitions.map((object) => {
              const asset = DORP_ASSET_BY_ID.get(object.assetIds[0]);
              const owned = world.instances.filter((instance) => instance.objectId === object.id && (!ownedIds || ownedIds.has(instance.instanceId)));
              const stored = owned.filter((instance) => instance.position === null).length;
              return <button key={object.id} type="button" disabled={stored === 0} onClick={() => chooseObject(object)} className="card min-w-0 !border-vs-line !bg-vs-surface-2 p-2 text-left disabled:opacity-55"><div className="relative aspect-square overflow-hidden rounded-xl bg-vs-surface-3">{asset && <Image src={asset.path} alt="" fill sizes="10rem" className="object-contain" />}</div><span className="mt-2 block text-sm font-semibold">{object.name}</span><span className="block text-xs text-vs-fg-3">{object.footprint[0]} × {object.footprint[1]} · {stored > 0 ? `${stored} opgeborgen` : "geplaatst"}</span></button>;
            })}</div></section>)}
          </div>
        </aside>
      )}

      {selected && selectedDefinition && !placement && (
        <section data-dorp-selection className="absolute inset-x-3 bottom-[max(.75rem,var(--vs-safe-area-bottom))] z-20 mx-auto max-h-[45dvh] overflow-y-auto w-[min(calc(100%-1.5rem),30rem)] rounded-2xl border border-vs-line bg-vs-surface/95 p-3 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">{selectedDefinition.name}</h2><p className="text-xs text-vs-fg-3">Vaste footprint {selectedDefinition.footprint[0]} × {selectedDefinition.footprint[1]} · positie {selected.position?.u},{selected.position?.v}</p></div><button type="button" onClick={() => setSelectedId(null)} className="min-h-10 min-w-10" aria-label="Selectie sluiten"><ChevronDown className="mx-auto h-5 w-5" /></button></div>
          {selectedResident && <p className="mt-2 text-sm text-vs-fg-2">{selectedResident.description}</p>}
          {!readOnly && <p className="mt-2 text-xs text-vs-fg-3">{t(ownedIds&&!ownedIds.has(selected.instanceId)?"dorp2.ownOnly":"dorp2.dragHelp")}</p>}
          {!readOnly && (!ownedIds||ownedIds.has(selected.instanceId)) && selectedDefinition.maxLevel > 1 && <div className="mt-3 flex gap-2" aria-label="Visueel gebouwniveau">{([1, 2, 3] as const).map((level) => <button key={level} type="button" disabled={level > selectedDefinition.maxLevel || Boolean(controlled && level !== selected.level+1)} onClick={() => setLevel(level)} className={`btn min-h-11 flex-1 ${selected.level === level ? "!border-vs-accent !bg-vs-accent-soft" : "!bg-vs-surface"}`}>Niveau {level}</button>)}</div>}
          {!readOnly && (!ownedIds||ownedIds.has(selected.instanceId)) && <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { if (!selected.position) return; setPlacement({ objectId: selected.objectId, instanceId: selected.instanceId, u: selected.position.u, v: selected.position.v, moving: true }); setSelectedId(null); }} className="btn min-h-11 flex-1 !bg-vs-surface"><Home className="h-4 w-4" /> Verplaatsen</button><button type="button" onClick={storeSelected} className="btn min-h-11 flex-1 !bg-vs-surface"><Package className="h-4 w-4" /> Terugnemen</button></div>}
          {!readOnly && ownedIds && !ownedIds.has(selected.instanceId) && <button className="btn mt-2 min-h-11" onClick={()=>controlled?.onRequest(selected.instanceId)}>{t("dorp2.request")}</button>}
        </section>
      )}

    </ImmersiveLayout>
  );
}
