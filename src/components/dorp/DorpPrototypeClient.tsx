"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, ChevronDown, ChevronUp, Crosshair, Home, Map as MapIcon, Minus, Package, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import ImmersiveLayout from "@/components/versado/ImmersiveLayout";
import { useBackNavigation } from "@/lib/navigationHistory";
import { useImmersiveShell } from "@/lib/shellModeOverride";
import {
  DORP_ASSETS,
  DORP_ASSET_BY_ID,
  DORP_FOREST_ASSETS,
  DORP_OBJECT_BY_ID,
  DORP_OBJECTS,
  DORP_RESIDENTS,
  DORP_TERRAIN_ASSETS,
  assetForObject,
} from "@/lib/dorp/catalog";
import {
  FOREST_WIDTH,
  MAX_RADIUS,
  PROTOTYPE_PHASES,
  TILE_HEIGHT,
  TILE_WIDTH,
  buildableTileCount,
  footprintTiles,
  isoToWorld,
  placementIsValid,
  radiusForPhase,
  suggestPlacement,
  worldOverviewSize,
  worldToIso,
} from "@/lib/dorp/geometry";
import { DEFAULT_DORP_STATE, DORP_STORAGE_KEY, parseDorpState, serializeDorpState } from "@/lib/dorp/storage";
import type { DorpObjectDefinition, DorpWorldState, PlacedDorpObject, TileCoordinate } from "@/lib/dorp/types";

type Camera = { x: number; y: number; zoom: number };
type Placement = { objectId: string; instanceId: string; u: number; v: number; moving: boolean };
type PointerRecord = { x: number; y: number };
type RenderImageMap = Map<string, HTMLImageElement>;

const MIN_PLAY_ZOOM = 0.22;
const MAX_ZOOM = 1.4;
const NORMAL_ZOOM = 0.55;
const DETAIL_ZOOM = 1;
const categories = ["Gebouwen", "Bijzondere gebouwen", "Decoraties", "Natuur"] as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

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

function terrainKind(u: number, v: number): keyof typeof DORP_TERRAIN_ASSETS {
  // Een vaste technische testpatch rond het centrum: 3×3 basisgras, varianten, recht pad, bocht en gebouwaansluiting.
  if (v === 1 && u >= -6 && u <= 4) return "pathStraight";
  if (u === 5 && v === 1) return "pathCorner";
  if (u >= -4 && u <= -2 && v >= -4 && v <= -2) return "grass";
  if ((u === -1 && v === -3) || (u === 0 && v === -3)) return "dryGrass";
  if ((u === 1 && v === -3) || (u === 2 && v === -3)) return "flowerGrass";
  if ((u === 3 && v === -3) || (u === 4 && v === -3)) return "sand";
  return "grass";
}

function imageAssetPaths(): string[] {
  return [...new Set([
    ...DORP_ASSETS.map((asset) => asset.path),
    ...Object.values(DORP_TERRAIN_ASSETS),
    ...DORP_FOREST_ASSETS,
    ...DORP_RESIDENTS.map((resident) => resident.asset),
  ])];
}

function spriteRegistration(object: PlacedDorpObject) {
  return assetForObject(object.objectId, object.level);
}

function cameraFit(width: number, height: number, radius: number): number {
  const size = worldOverviewSize(radius + FOREST_WIDTH);
  return Math.min((width - 32) / size.width, (height - 32) / size.height);
}

function nearestPrototypePhase(phase: number) {
  return PROTOTYPE_PHASES.reduce((best, item) => Math.abs(item.id - phase) < Math.abs(best.id - phase) ? item : best);
}

function DorpCanvas({
  world,
  placement,
  selectedId,
  onPlacementMove,
  onSelectObject,
  onSelectResident,
  onCameraChange,
  cameraCommand,
}: {
  world: DorpWorldState;
  placement: Placement | null;
  selectedId: string | null;
  onPlacementMove: (tile: TileCoordinate) => void;
  onSelectObject: (instanceId: string | null) => void;
  onSelectResident: (objectId: string | null) => void;
  onCameraChange: (camera: Camera) => void;
  cameraCommand: { id: number; kind: "detail" | "normal" | "current" | "full" | "in" | "out" | "center" };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef<RenderImageMap>(new Map());
  const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: NORMAL_ZOOM });
  const pointersRef = useRef(new Map<number, PointerRecord>());
  const gestureRef = useRef({ moved: false, lastX: 0, lastY: 0, pinchDistance: 0, pinchZoom: NORMAL_ZOOM });
  const frameRef = useRef<number | null>(null);
  const [assetRevision, setAssetRevision] = useState(0);
  const radius = radiusForPhase(world.phase);

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

  const emitCamera = useCallback(() => onCameraChange({ ...cameraRef.current }), [onCameraChange]);

  useEffect(() => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    const camera = cameraRef.current;
    if (cameraCommand.kind === "detail") camera.zoom = DETAIL_ZOOM;
    if (cameraCommand.kind === "normal") camera.zoom = NORMAL_ZOOM;
    if (cameraCommand.kind === "in") camera.zoom = clamp(camera.zoom * 1.25, cameraFit(box.width, box.height, MAX_RADIUS), MAX_ZOOM);
    if (cameraCommand.kind === "out") camera.zoom = clamp(camera.zoom / 1.25, cameraFit(box.width, box.height, MAX_RADIUS), MAX_ZOOM);
    if (cameraCommand.kind === "current") { camera.x = 0; camera.y = 0; camera.zoom = cameraFit(box.width, box.height, radius); }
    if (cameraCommand.kind === "full") { camera.x = 0; camera.y = 0; camera.zoom = cameraFit(box.width, box.height, MAX_RADIUS); }
    if (cameraCommand.kind === "center") { camera.x = 0; camera.y = 0; }
    emitCamera();
  }, [cameraCommand, emitCamera, radius]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const draw = () => {
      frameRef.current = null;
      const bounds = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pixelWidth = Math.max(1, Math.round(bounds.width * dpr));
      const pixelHeight = Math.max(1, Math.round(bounds.height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;
      const width = bounds.width;
      const height = bounds.height;
      const camera = cameraRef.current;
      const zoom = camera.zoom;
      const originX = width / 2 - camera.x * zoom;
      const originY = height / 2 - camera.y * zoom;
      const screen = (x: number, y: number) => ({ x: originX + x * zoom, y: originY + y * zoom });

      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "#b9d9dc");
      gradient.addColorStop(0.55, "#dce8cf");
      gradient.addColorStop(1, "#b6c999");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const overview = zoom < 0.18;
      if (overview) {
        const center = screen(0, 0);
        ctx.save();
        ctx.translate(center.x, center.y);
        ctx.scale(1, 0.5);
        ctx.beginPath();
        ctx.arc(0, 0, (radius + FOREST_WIDTH) * TILE_WIDTH * zoom, 0, Math.PI * 2);
        ctx.fillStyle = "#315b38"; ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, radius * TILE_WIDTH * zoom, 0, Math.PI * 2);
        ctx.fillStyle = "#7eaa58"; ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.45)"; ctx.lineWidth = Math.max(1, 2 / zoom); ctx.stroke();
        ctx.restore();
      } else {
        const margin = TILE_WIDTH * zoom;
        for (let sum = -radius * 2; sum <= radius * 2; sum += 1) {
          for (let u = -radius; u <= radius; u += 1) {
            const v = sum - u;
            if (v < -radius || v > radius || u * u + v * v > radius * radius) continue;
            const worldPoint = isoToWorld(u, v);
            const point = screen(worldPoint.x, worldPoint.y);
            if (point.x < -margin || point.x > width + margin || point.y < -margin || point.y > height + margin) continue;
            const kind = terrainKind(u, v);
            const terrain = imagesRef.current.get(DORP_TERRAIN_ASSETS[kind]);
            if (terrain) ctx.drawImage(terrain, point.x - TILE_WIDTH * zoom / 2, point.y - TILE_HEIGHT * zoom / 2, TILE_WIDTH * zoom, TILE_HEIGHT * zoom);
            else drawDiamond(ctx, point.x, point.y, TILE_WIDTH * zoom, TILE_HEIGHT * zoom, (u + v) % 3 === 0 ? "#8eb65e" : "#86ae57");
          }
        }
      }

      type LayerItem = { depth: number; draw: () => void };
      const layers: LayerItem[] = [];
      if (!overview) {
        const forestRadius = radius + 4;
        const count = Math.max(20, Math.round(forestRadius * 2.3));
        for (let index = 0; index < count; index += 1) {
          const angle = (index / count) * Math.PI * 2;
          const u = Math.round(Math.cos(angle) * forestRadius);
          const v = Math.round(Math.sin(angle) * forestRadius);
          const point = isoToWorld(u, v);
          const path = DORP_FOREST_ASSETS[index % DORP_FOREST_ASSETS.length];
          const image = imagesRef.current.get(path);
          if (!image) continue;
          const worldWidth = path.includes("strip") ? 360 : 260;
          const worldHeight = path.includes("strip") ? 180 : 260;
          layers.push({ depth: u + v - 0.5, draw: () => {
            const position = screen(point.x, point.y);
            ctx.drawImage(image, position.x - worldWidth * zoom / 2, position.y - worldHeight * zoom * 0.82, worldWidth * zoom, worldHeight * zoom);
          }});
        }
      }

      for (const object of world.objects) {
        const definition = DORP_OBJECT_BY_ID.get(object.objectId);
        const registration = spriteRegistration(object);
        const image = registration ? imagesRef.current.get(registration.path) : undefined;
        if (!definition || !registration) continue;
        const anchorTile = { u: object.u + definition.footprint[0] - 1, v: object.v + definition.footprint[1] - 1 };
        const worldPoint = isoToWorld(anchorTile.u, anchorTile.v);
        layers.push({ depth: anchorTile.u + anchorTile.v, draw: () => {
          const point = screen(worldPoint.x, worldPoint.y);
          if (overview) {
            const size = definition.kind === "landmark" ? 8 : 5;
            ctx.fillStyle = definition.kind === "landmark" ? "#f8730c" : "#f9dcc8";
            ctx.beginPath(); ctx.arc(point.x, point.y, size, 0, Math.PI * 2); ctx.fill();
            return;
          }
          if (image) {
            const drawWidth = registration.worldSize[0] * zoom;
            const drawHeight = registration.worldSize[1] * zoom;
            ctx.drawImage(image, point.x - drawWidth * registration.anchor[0], point.y - drawHeight * registration.anchor[1], drawWidth, drawHeight);
          }
          if (object.instanceId === selectedId) {
            ctx.lineWidth = 3;
            for (const tile of footprintTiles(object.u, object.v, definition.footprint)) {
              const p = isoToWorld(tile.u, tile.v); const s = screen(p.x, p.y);
              drawDiamond(ctx, s.x, s.y, TILE_WIDTH * zoom, TILE_HEIGHT * zoom, "rgba(19,54,119,.13)", "#133677");
            }
          }
        }});
      }

      if (!overview) {
        for (const resident of DORP_RESIDENTS) {
          const worldPoint = isoToWorld(resident.u, resident.v);
          const image = imagesRef.current.get(resident.asset);
          layers.push({ depth: resident.u + resident.v + 0.25, draw: () => {
            const point = screen(worldPoint.x, worldPoint.y);
            if (image) ctx.drawImage(image, point.x - 48 * zoom, point.y - 92 * zoom, 96 * zoom, 96 * zoom);
          }});
        }
      }
      layers.sort((a, b) => a.depth - b.depth).forEach((layer) => layer.draw());

      if (placement && !overview) {
        const definition = DORP_OBJECT_BY_ID.get(placement.objectId);
        if (definition) {
          const valid = placementIsValid(placement, world.objects, radius);
          ctx.lineWidth = 2;
          for (const tile of footprintTiles(placement.u, placement.v, definition.footprint)) {
            const p = isoToWorld(tile.u, tile.v); const s = screen(p.x, p.y);
            drawDiamond(ctx, s.x, s.y, TILE_WIDTH * zoom, TILE_HEIGHT * zoom, valid ? "rgba(37,176,98,.32)" : "rgba(220,50,47,.35)", valid ? "#18794e" : "#c32f27");
          }
          const registration = assetForObject(placement.objectId, world.objects.find((item) => item.instanceId === placement.instanceId)?.level ?? 1);
          const image = registration ? imagesRef.current.get(registration.path) : undefined;
          if (registration && image) {
            const anchor = { u: placement.u + definition.footprint[0] - 1, v: placement.v + definition.footprint[1] - 1 };
            const p = isoToWorld(anchor.u, anchor.v); const s = screen(p.x, p.y);
            ctx.globalAlpha = 0.72;
            ctx.drawImage(image, s.x - registration.worldSize[0] * zoom * registration.anchor[0], s.y - registration.worldSize[1] * zoom * registration.anchor[1], registration.worldSize[0] * zoom, registration.worldSize[1] * zoom);
            ctx.globalAlpha = 1;
          }
        }
      }
    };

    const requestDraw = () => { if (frameRef.current === null) frameRef.current = requestAnimationFrame(draw); };
    // De eerste bruikbare render is synchroon: achtergrondtabs en sommige
    // WebViews kunnen requestAnimationFrame vóór de eerste paint uitstellen.
    draw();
    const resize = new ResizeObserver(requestDraw);
    resize.observe(container);
    const interval = window.setInterval(requestDraw, 250);
    return () => { resize.disconnect(); window.clearInterval(interval); if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); };
  }, [assetRevision, placement, radius, selectedId, world]);

  const eventToWorld = useCallback((clientX: number, clientY: number) => {
    const bounds = canvasRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    const camera = cameraRef.current;
    return {
      x: (clientX - bounds.left - bounds.width / 2) / camera.zoom + camera.x,
      y: (clientY - bounds.top - bounds.height / 2) / camera.zoom + camera.y,
    };
  }, []);

  const handleTap = useCallback((x: number, y: number) => {
    const worldPoint = eventToWorld(x, y);
    const tile = worldToIso(worldPoint.x, worldPoint.y);
    if (placement) { onPlacementMove(tile); return; }
    const resident = DORP_RESIDENTS.find((item) => item.u === tile.u && item.v === tile.v);
    if (resident) { onSelectResident(resident.objectId); onSelectObject(null); return; }
    const object = [...world.objects].reverse().find((item) => {
      const definition = DORP_OBJECT_BY_ID.get(item.objectId);
      return definition && tile.u >= item.u && tile.u < item.u + definition.footprint[0] && tile.v >= item.v && tile.v < item.v + definition.footprint[1];
    });
    onSelectResident(null);
    onSelectObject(object?.instanceId ?? null);
  }, [eventToWorld, onPlacementMove, onSelectObject, onSelectResident, placement, world.objects]);

  return (
    <div ref={containerRef} className="absolute inset-0 touch-none select-none overflow-hidden" data-dorp-canvas>
      <canvas
        ref={canvasRef}
        className="block h-full w-full cursor-grab active:cursor-grabbing"
        aria-label="Interactieve isometrische dorpskaart"
        onContextMenu={(event) => event.preventDefault()}
        onWheel={(event) => {
          event.preventDefault();
          const camera = cameraRef.current;
          const before = eventToWorld(event.clientX, event.clientY);
          const bounds = canvasRef.current!.getBoundingClientRect();
          const fit = cameraFit(bounds.width, bounds.height, MAX_RADIUS);
          camera.zoom = clamp(camera.zoom * Math.exp(-event.deltaY * 0.001), fit, MAX_ZOOM);
          const after = eventToWorld(event.clientX, event.clientY);
          camera.x += before.x - after.x; camera.y += before.y - after.y;
          emitCamera();
        }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          gestureRef.current = { ...gestureRef.current, moved: false, lastX: event.clientX, lastY: event.clientY };
          if (pointersRef.current.size === 2) {
            const points = [...pointersRef.current.values()];
            gestureRef.current.pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            gestureRef.current.pinchZoom = cameraRef.current.zoom;
          }
        }}
        onPointerMove={(event) => {
          if (!pointersRef.current.has(event.pointerId)) return;
          const previous = pointersRef.current.get(event.pointerId)!;
          pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          const dx = event.clientX - previous.x; const dy = event.clientY - previous.y;
          if (Math.abs(dx) + Math.abs(dy) > 2) gestureRef.current.moved = true;
          const points = [...pointersRef.current.values()];
          const camera = cameraRef.current;
          if (points.length === 2) {
            const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const bounds = canvasRef.current!.getBoundingClientRect();
            camera.zoom = clamp(gestureRef.current.pinchZoom * distance / Math.max(1, gestureRef.current.pinchDistance), cameraFit(bounds.width, bounds.height, MAX_RADIUS), MAX_ZOOM);
          } else if (points.length === 1) {
            camera.x -= dx / camera.zoom; camera.y -= dy / camera.zoom;
          }
          emitCamera();
        }}
        onPointerUp={(event) => {
          const wasTap = !gestureRef.current.moved && pointersRef.current.size === 1;
          pointersRef.current.delete(event.pointerId);
          if (wasTap) handleTap(event.clientX, event.clientY);
        }}
        onPointerCancel={(event) => pointersRef.current.delete(event.pointerId)}
      />
    </div>
  );
}

export default function DorpPrototypeClient() {
  useImmersiveShell();
  const goBack = useBackNavigation("/adminbackend/spellen");
  const [world, setWorld] = useState<DorpWorldState>(DEFAULT_DORP_STATE);
  const [loaded, setLoaded] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [residentId, setResidentId] = useState<string | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: NORMAL_ZOOM });
  const [cameraCommand, setCameraCommand] = useState<{ id: number; kind: "detail" | "normal" | "current" | "full" | "in" | "out" | "center" }>({ id: 0, kind: "normal" });
  const selected = world.objects.find((object) => object.instanceId === selectedId) ?? null;
  const selectedDefinition = selected ? DORP_OBJECT_BY_ID.get(selected.objectId) : null;
  const selectedResident = DORP_RESIDENTS.find((resident) => resident.objectId === residentId) ?? null;
  const radius = radiusForPhase(world.phase);
  const activePhase = nearestPrototypePhase(world.phase);

  useEffect(() => {
    // Na hydration lezen voorkomt dat een eerdere lokale kaart een ander server-HTML-resultaat geeft.
    const timer = window.setTimeout(() => {
      setWorld(parseDorpState(window.localStorage.getItem(DORP_STORAGE_KEY)));
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (loaded) window.localStorage.setItem(DORP_STORAGE_KEY, serializeDorpState(world));
  }, [loaded, world]);

  const issueCameraCommand = (kind: typeof cameraCommand.kind) => setCameraCommand((value) => ({ id: value.id + 1, kind }));
  const placementValid = placement ? placementIsValid(placement, world.objects, radius) : false;

  const chooseObject = (definition: DorpObjectDefinition) => {
    const proposed = suggestPlacement(definition.id, world.objects, radius) ?? { u: 0, v: 0 };
    setPlacement({ objectId: definition.id, instanceId: `prototype-${crypto.randomUUID()}`, ...proposed, moving: false });
    setSelectedId(null); setResidentId(null); setInventoryOpen(false);
    if (camera.zoom < MIN_PLAY_ZOOM) issueCameraCommand("normal");
  };

  const confirmPlacement = () => {
    if (!placement || !placementValid) return;
    setWorld((current) => {
      const existing = current.objects.find((object) => object.instanceId === placement.instanceId);
      const next: PlacedDorpObject = { instanceId: placement.instanceId, objectId: placement.objectId, level: existing?.level ?? 1, u: placement.u, v: placement.v };
      return { ...current, objects: existing ? current.objects.map((object) => object.instanceId === next.instanceId ? next : object) : [...current.objects, next] };
    });
    setSelectedId(placement.instanceId); setPlacement(null);
  };

  const propose = () => {
    if (!placement) return;
    const tile = suggestPlacement(placement.objectId, world.objects, radius, worldToIso(camera.x, camera.y), placement.instanceId);
    if (tile) setPlacement({ ...placement, ...tile });
  };

  const setLevel = (level: 1 | 2 | 3) => {
    if (!selected || !selectedDefinition || level > selectedDefinition.maxLevel) return;
    setWorld((current) => ({ ...current, objects: current.objects.map((object) => object.instanceId === selected.instanceId ? { ...object, level } : object) }));
  };

  const storeSelected = () => {
    if (!selected) return;
    setWorld((current) => ({ ...current, objects: current.objects.filter((object) => object.instanceId !== selected.instanceId) }));
    setSelectedId(null);
  };

  const changePhase = (phase: number) => {
    setWorld((current) => ({ ...current, phase }));
    setPlacement(null); setSelectedId(null);
    issueCameraCommand("current");
  };

  const reset = () => {
    if (!window.confirm("De lokale prototype-indeling wissen en de testopstelling herstellen?")) return;
    window.localStorage.removeItem(DORP_STORAGE_KEY);
    setWorld(structuredClone(DEFAULT_DORP_STATE)); setPlacement(null); setSelectedId(null); setResidentId(null);
    issueCameraCommand("normal");
  };

  const inventoryByCategory = useMemo(() => categories.map((category) => ({ category, objects: DORP_OBJECTS.filter((object) => object.category === category) })), []);

  return (
    <ImmersiveLayout className="relative overflow-hidden bg-vs-surface text-vs-fg-1" data-dorp-prototype>
      <DorpCanvas
        world={world}
        placement={placement}
        selectedId={selectedId}
        onPlacementMove={(tile) => placement && setPlacement({ ...placement, ...tile })}
        onSelectObject={setSelectedId}
        onSelectResident={setResidentId}
        onCameraChange={setCamera}
        cameraCommand={cameraCommand}
      />

      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-[max(.75rem,var(--vs-safe-area-top))_max(.75rem,var(--vs-safe-area-right))_max(.75rem,var(--vs-safe-area-bottom))_max(.75rem,var(--vs-safe-area-left))]">
        <header className="pointer-events-auto flex min-w-0 items-start justify-between gap-2">
          <button type="button" onClick={goBack} className="btn min-h-11 !border-white/40 !bg-vs-surface/90 px-3 shadow-lg backdrop-blur" aria-label="Versado Dorp sluiten">
            <X className="h-5 w-5" aria-hidden /> <span className="hidden sm:inline">Sluiten</span>
          </button>
          <div className="min-w-0 rounded-2xl border border-white/40 bg-vs-surface/90 px-3 py-2 text-center shadow-lg backdrop-blur">
            <p className="truncate text-sm font-bold">Versado Dorp · technisch prototype</p>
            <p className="text-xs text-vs-fg-3">{activePhase.label} · R{radius} · {buildableTileCount(radius).toLocaleString("nl-NL")} tegels</p>
          </div>
          <button type="button" onClick={() => setDeveloperOpen((value) => !value)} className="btn min-h-11 !border-white/40 !bg-vs-surface/90 px-3 shadow-lg backdrop-blur" aria-expanded={developerOpen} aria-label="Testmenu">
            <Box className="h-5 w-5" aria-hidden /> <span className="hidden sm:inline">Testmenu</span>
          </button>
        </header>

        {developerOpen && (
          <section className="pointer-events-auto mt-2 ml-auto w-[min(100%,22rem)] rounded-2xl border border-vs-line bg-vs-surface/95 p-3 shadow-xl backdrop-blur" aria-label="Ontwikkelmenu kaartuitbreiding">
            <div className="mb-2 flex items-center justify-between gap-2"><h2 className="font-bold">Kaartfase testen</h2><button type="button" onClick={() => setDeveloperOpen(false)} aria-label="Testmenu sluiten"><ChevronUp className="h-5 w-5" /></button></div>
            <div className="grid grid-cols-2 gap-2">
              {PROTOTYPE_PHASES.map((phase) => <button key={phase.id} type="button" onClick={() => changePhase(phase.id)} className={`btn min-h-11 break-normal text-xs ${world.phase === phase.id ? "!border-vs-accent !bg-vs-accent-soft" : "!bg-vs-surface"}`}>{phase.label}<br />R{phase.radius}</button>)}
            </div>
            <p className="mt-2 text-xs text-vs-fg-3">Volgende echte stap: R{Math.min(MAX_RADIUS, radius + 3)} · prototypefixture, geen lees- of hoofdstukvoortgang.</p>
            <button type="button" onClick={reset} className="btn mt-3 min-h-11 w-full !border-red-300 !bg-red-50 text-red-800"><RotateCcw className="h-4 w-4" /> Testdata herstellen</button>
          </section>
        )}

        <div className="mt-auto grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <div className="pointer-events-auto flex min-w-0 flex-col gap-2">
            <div className="flex rounded-2xl border border-white/40 bg-vs-surface/90 p-1 shadow-lg backdrop-blur">
              <button type="button" onClick={() => issueCameraCommand("out")} className="min-h-11 min-w-11 flex-1 rounded-xl" aria-label="Uitzoomen"><Minus className="mx-auto h-5 w-5" /></button>
              <button type="button" onClick={() => issueCameraCommand("in")} className="min-h-11 min-w-11 flex-1 rounded-xl" aria-label="Inzoomen"><Plus className="mx-auto h-5 w-5" /></button>
              <button type="button" onClick={() => issueCameraCommand("center")} className="min-h-11 min-w-11 flex-1 rounded-xl" aria-label="Camera centreren"><Crosshair className="mx-auto h-5 w-5" /></button>
            </div>
            <div className="flex rounded-2xl border border-white/40 bg-vs-surface/90 p-1 text-[.6875rem] shadow-lg backdrop-blur sm:text-xs">
              <button type="button" onClick={() => issueCameraCommand("detail")} className="min-h-11 min-w-0 flex-1 rounded-xl px-1">Detail</button>
              <button type="button" onClick={() => issueCameraCommand("normal")} className="min-h-11 min-w-0 flex-1 rounded-xl px-1">Normaal</button>
              <button type="button" onClick={() => issueCameraCommand("full")} className="min-h-11 min-w-0 flex-1 rounded-xl px-1"><MapIcon className="mx-auto h-4 w-4" />Wereld</button>
            </div>
          </div>

          <button type="button" onClick={() => setInventoryOpen(true)} className="btn pointer-events-auto min-h-12 shrink-0 whitespace-nowrap !border-white/40 !bg-vs-surface/95 px-2 text-sm shadow-xl backdrop-blur sm:px-4"><Package className="h-5 w-5" /> Bouwen</button>
        </div>
      </div>

      {placement && (
        <div className="absolute inset-x-0 bottom-[max(.75rem,var(--vs-safe-area-bottom))] z-20 mx-auto flex w-[min(calc(100%-1.5rem),32rem)] flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/40 bg-vs-surface/95 p-3 shadow-2xl backdrop-blur">
          <p className="w-full text-center text-sm font-semibold">{DORP_OBJECT_BY_ID.get(placement.objectId)?.name} · {placementValid ? "geldige plek" : "ongeldige plek"}</p>
          <button type="button" onClick={propose} className="btn min-h-11 !bg-vs-surface"><Sparkles className="h-4 w-4" /> Stel een plek voor</button>
          <button type="button" onClick={() => setPlacement(null)} className="btn min-h-11 !bg-vs-surface">Annuleren</button>
          <button type="button" disabled={!placementValid} onClick={confirmPlacement} className="btn-primary min-h-11 disabled:opacity-50">Plaatsen</button>
        </div>
      )}

      {inventoryOpen && (
        <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(92vw,27rem)] flex-col border-l border-vs-line bg-vs-surface shadow-2xl pt-[max(1rem,var(--vs-safe-area-top))] pr-[max(1rem,var(--vs-safe-area-right))] pb-[max(1rem,var(--vs-safe-area-bottom))] pl-4" aria-label="Bouwinventaris">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Bouwinventaris</h2><p className="text-xs text-vs-fg-3">Expliciete prototypefixtures · geen vrijspeelstatus</p></div><button type="button" onClick={() => setInventoryOpen(false)} className="min-h-11 min-w-11" aria-label="Inventaris sluiten"><X className="mx-auto h-5 w-5" /></button></div>
          <div className="mt-4 flex-1 space-y-5 overflow-y-auto overscroll-contain pr-1">
            {inventoryByCategory.map(({ category, objects }) => objects.length > 0 && <section key={category}><h3 className="mb-2 text-sm font-bold text-vs-fg-2">{category}</h3><div className="grid grid-cols-2 gap-2">{objects.map((object) => {
              const asset = DORP_ASSET_BY_ID.get(object.assetIds[0]);
              return <button key={object.id} type="button" onClick={() => chooseObject(object)} className="card min-w-0 !border-vs-line !bg-vs-surface-2 p-2 text-left"><div className="relative aspect-square overflow-hidden rounded-xl bg-vs-surface-3">{asset && <Image src={asset.path} alt="" fill sizes="10rem" className="object-contain" />}</div><span className="mt-2 block text-sm font-semibold">{object.name}</span><span className="block text-xs text-vs-fg-3">{object.footprint[0]} × {object.footprint[1]} tegels</span></button>;
            })}</div></section>)}
          </div>
        </aside>
      )}

      {selected && selectedDefinition && !placement && (
        <section className="absolute inset-x-3 bottom-[max(.75rem,var(--vs-safe-area-bottom))] z-20 mx-auto w-[min(calc(100%-1.5rem),30rem)] rounded-2xl border border-vs-line bg-vs-surface/95 p-3 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold">{selectedDefinition.name}</h2><p className="text-xs text-vs-fg-3">Vaste footprint {selectedDefinition.footprint[0]} × {selectedDefinition.footprint[1]} · positie {selected.u},{selected.v}</p></div><button type="button" onClick={() => setSelectedId(null)} className="min-h-10 min-w-10" aria-label="Selectie sluiten"><ChevronDown className="mx-auto h-5 w-5" /></button></div>
          {selectedDefinition.maxLevel > 1 && <div className="mt-3 flex gap-2" aria-label="Visueel gebouwniveau">{([1, 2, 3] as const).map((level) => <button key={level} type="button" disabled={level > selectedDefinition.maxLevel} onClick={() => setLevel(level)} className={`btn min-h-11 flex-1 ${selected.level === level ? "!border-vs-accent !bg-vs-accent-soft" : "!bg-vs-surface"}`}>Niveau {level}</button>)}</div>}
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => { setPlacement({ objectId: selected.objectId, instanceId: selected.instanceId, u: selected.u, v: selected.v, moving: true }); setSelectedId(null); }} className="btn min-h-11 flex-1 !bg-vs-surface"><Home className="h-4 w-4" /> Verplaatsen</button><button type="button" onClick={storeSelected} className="btn min-h-11 flex-1 !bg-vs-surface"><Package className="h-4 w-4" /> Terugnemen</button></div>
        </section>
      )}

      {selectedResident && (
        <section className="absolute inset-x-3 bottom-[max(.75rem,var(--vs-safe-area-bottom))] z-20 mx-auto flex w-[min(calc(100%-1.5rem),28rem)] items-center gap-3 rounded-2xl border border-vs-line bg-vs-surface/95 p-3 shadow-2xl backdrop-blur">
          <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-xl bg-vs-surface-3"><Image src={selectedResident.asset} alt="" fill sizes="6rem" className="object-contain" /></div>
          <div className="min-w-0 flex-1"><h2 className="font-bold">{selectedResident.name}</h2><p className="mt-1 text-sm text-vs-fg-2">{selectedResident.description}</p><p className="mt-1 text-xs text-vs-fg-3">Canonieke ID: {selectedResident.characterId}</p></div>
          <button type="button" onClick={() => setResidentId(null)} className="min-h-10 min-w-10 self-start" aria-label="Bewoner sluiten"><X className="mx-auto h-5 w-5" /></button>
        </section>
      )}
    </ImmersiveLayout>
  );
}
