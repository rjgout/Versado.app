"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import NextImage from "next/image";
import { RotateCw } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { createPuzzleGeometry, tracePuzzleGroup } from "@/lib/puzzle/geometry";
import { boardSnapTarget, findSnapConnection, groupFor } from "@/lib/puzzle/engine";
import { clampGroupPosition, groupAnchor, groupMemberAt, puzzleRenderOrder, puzzleWorktable } from "@/lib/puzzle/worktable";
import { constrainCamera as constrainViewport, fitCamera, initialPuzzleCamera, resizeCamera, screenToWorld, zoomCamera, type PuzzleCamera, type ViewportSize } from "@/lib/puzzle/viewport";
import { puzzlePolicy, type PuzzleDifficulty, type PuzzleGroup, type PuzzleHint, type PuzzlePieceCount, type PuzzleSnapshot } from "@/lib/puzzle/types";

// De fullscreen werktafel voor Samen en Tegen elkaar. Dezelfde puzzelgeometrie,
// snapregels en tekenstijl als Solo (src/lib/puzzle/*), maar de definitieve
// acties lopen via callbacks van de ouder (server-authoritative). Camera,
// zoom, selectie en hintweergave zijn altijd persoonlijk en nooit onderdeel
// van de gedeelde puzzelstatus.

type Point = { x: number; y: number };
export interface TableLock { groupId: string; userId: string; expiresAt: string }
export interface TableOperation { kind: "move"; groupId: string; x: number; y: number }
export type TableCommit = { kind: "move"; groupId: string; x: number; y: number } | { kind: "rotate"; groupId: string } | { kind: "connect"; a: number; b: number } | { kind: "anchor"; groupId: string };
export interface PuzzleTableHandle { fit: () => void; zoom: (factor: number) => void; repaint: () => void; selected: () => number | null; select: (piece: number | null) => void; focusWorld: (point: Point) => void }

export interface PuzzleTableProps {
  image: string; seed: string; geometryVersion: number; pieceCount: PuzzlePieceCount; difficulty: PuzzleDifficulty; rulesVersion: number;
  /** De actuele canonieke puzzel; leest ook tijdens asynchrone gesprekken de nieuwste stand. */
  getSnapshot: () => PuzzleSnapshot;
  /** Verandert zodra de gedeelde stand of hint verandert, zodat het bord opnieuw tekent. */
  paintKey: number;
  readOnly?: boolean;
  hint: PuzzleHint | null;
  meId: string;
  locks: readonly TableLock[];
  colorOf: (userId: string) => string;
  /** Pak een groep op (lock). Geeft het token of null als iemand anders hem vasthoudt. */
  onGrab: (groupId: string) => Promise<string | null>;
  onRelease: (groupId: string, token: string) => void;
  /** Tijdelijke sleepbeweging; nooit opgeslagen. */
  onDrag?: (groupId: string, x: number, y: number) => void;
  /** Definitieve actie. Moet de nieuwe stand toepassen vóór hij resolve't en geeft terug of er iets veranderde. */
  onCommit: (operation: TableCommit, token: string) => Promise<boolean>;
  /** Tijdelijke posities van groepen die anderen verslepen (op groep-id). */
  remoteDrags: { current: Map<string, { x: number; y: number; until: number }> };
  onBusy?: (message: string) => void;
  onSelect?: (piece: number | null) => void;
  controls?: React.ReactNode;
}

const PreviewOverlay = ({ image, label }: { image: string; label: string }) => <div className="pointer-events-none absolute inset-3 rounded-xl bg-vs-surface/95 p-2"><NextImage src={image} alt={label} fill unoptimized className="object-contain p-2" /></div>;

const PuzzleTable = forwardRef<PuzzleTableHandle, PuzzleTableProps>(function PuzzleTable(props, ref) {
  const t = useT();
  const { image, seed, geometryVersion, pieceCount, difficulty, rulesVersion } = props;
  const geometry = useMemo(() => createPuzzleGeometry(pieceCount, seed, geometryVersion), [pieceCount, seed, geometryVersion]);
  const table = useMemo(() => puzzleWorktable(geometry), [geometry]);
  const policy = puzzlePolicy(difficulty, rulesVersion);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const picture = useRef<HTMLImageElement | null>(null);
  const camera = useRef<PuzzleCamera>({ scale: 60, x: 0, y: 0 });
  const viewport = useRef<ViewportSize | null>(null);
  const frame = useRef<number | null>(null);
  const paths = useRef(new Map<string, Path2D>());
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ pointer: number; groupId: string; offset: Point; grab: Promise<string | null>; local: Point | null } | null>(null);
  const pan = useRef<{ pointer: number; point: Point; camera: PuzzleCamera } | null>(null);
  const pinch = useRef<{ distance: number; world: Point; scale: number } | null>(null);
  const [selected, setSelectedState] = useState<number | null>(null);
  const selectedRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const propsRef = useRef(props);
  useEffect(() => { propsRef.current = props; });
  const mounted = useRef(true);

  const setSelected = useCallback((piece: number | null) => { selectedRef.current = piece; setSelectedState(piece); propsRef.current.onSelect?.(piece); }, []);

  // paint is een functiedeclaratie verderop en dus al beschikbaar zodra het frame draait.
  // eslint-disable-next-line react-hooks/immutability
  const schedule = useCallback(() => { if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; paint(); }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function constrain() { const canvas = canvasRef.current; if (canvas) camera.current = constrainViewport(camera.current, { width: canvas.clientWidth, height: canvas.clientHeight }, table.bounds); }
  function screenPoint(event: { clientX: number; clientY: number }): Point { const rect = canvasRef.current?.getBoundingClientRect(); return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 0, y: 0 }; }
  const worldPoint = (point: Point) => screenToWorld(camera.current, point);
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

  function paint() {
    const canvas = canvasRef.current; if (!canvas) return;
    const p = propsRef.current; const snapshot = p.getSnapshot();
    const rect = canvas.getBoundingClientRect(); const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width * ratio)); const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d"); if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, rect.width, rect.height); context.fillStyle = "#edf1f2"; context.fillRect(0, 0, rect.width, rect.height);
    context.save(); context.translate(camera.current.x, camera.current.y); context.scale(camera.current.scale, camera.current.scale);
    const scale = camera.current.scale;
    context.fillStyle = "#dbe6e6"; context.fillRect(table.bounds.minX, table.bounds.minY, table.bounds.maxX - table.bounds.minX, table.bounds.maxY - table.bounds.minY);
    context.strokeStyle = "rgba(42, 68, 74, .45)"; context.lineWidth = 2 / scale; context.strokeRect(table.bounds.minX, table.bounds.minY, table.bounds.maxX - table.bounds.minX, table.bounds.maxY - table.bounds.minY);
    const complete = snapshot.completedAt !== null;
    if (!complete && (policy.showOutline || policy.showGhost)) { context.fillStyle = "rgba(255, 255, 255, .74)"; context.fillRect(table.puzzle.x, table.puzzle.y, table.puzzle.width, table.puzzle.height); }
    if (!complete && policy.showGhost && picture.current) { context.globalAlpha = .18; context.drawImage(picture.current, table.puzzle.x, table.puzzle.y, table.puzzle.width, table.puzzle.height); context.globalAlpha = 1; }
    if (!complete && policy.showOutline) { context.strokeStyle = "rgba(64, 87, 94, .46)"; context.setLineDash([.12, .1]); context.strokeRect(table.puzzle.x, table.puzzle.y, table.puzzle.width, table.puzzle.height); context.setLineDash([]); }
    const target = p.hint?.target;
    const mine = drag.current?.groupId ?? null;
    const now = Date.now();
    const remote = p.remoteDrags.current;
    // Een actieve (eigen of andermans) groep ligt tijdens het slepen bovenop.
    const order = puzzleRenderOrder(snapshot.groups, mine);
    const topRemote = [...remote.keys()].filter((id) => (remote.get(id)?.until ?? 0) > now);
    const ordered = topRemote.length ? [...order.filter((g) => !topRemote.includes(g.id)), ...order.filter((g) => topRemote.includes(g.id))] : order;
    for (const group of ordered) {
      const local = drag.current?.groupId === group.id && drag.current.local ? drag.current.local : null;
      const far = remote.get(group.id); const remotePos = far && far.until > now ? far : null;
      const x = local?.x ?? remotePos?.x ?? group.x; const y = local?.y ?? remotePos?.y ?? group.y;
      const dragging = group.id === mine || remotePos !== null;
      const lock = p.locks.find((candidate) => candidate.groupId === group.id && Date.parse(candidate.expiresAt) > now);
      const anchor = groupAnchor(geometry, group); const key = group.pieceIds.join(",");
      let path = paths.current.get(key);
      if (!path) { path = new Path2D(); tracePuzzleGroup(path, geometry, group.pieceIds); paths.current.set(key, path); }
      context.save(); if (target?.type === "FILTER") context.globalAlpha = .2;
      context.translate(x + .5, y + .5 - (dragging ? 2 / scale : 0)); context.rotate(group.rotation * Math.PI / 180); context.translate(-.5, -.5);
      if (dragging) { context.save(); context.shadowColor = "rgba(29, 42, 60, .28)"; context.shadowBlur = 10 * ratio; context.shadowOffsetY = 5 * ratio; context.fillStyle = "#b9d5d7"; context.fill(path); context.restore(); }
      context.save(); context.clip(path);
      if (picture.current) context.drawImage(picture.current, -anchor.column, -anchor.row, geometry.grid.columns, geometry.grid.rows); else { context.fillStyle = "#b9d5d7"; context.fill(path); }
      context.restore();
      if (target?.type === "FILTER" && picture.current) {
        const members = group.pieceIds.filter((id) => target.pieceIds.includes(id));
        if (members.length) {
          const first = geometry.pieces[members[0]]; const filterKey = `filter:${members.join(",")}`;
          let highlight = paths.current.get(filterKey); if (!highlight) { highlight = new Path2D(); tracePuzzleGroup(highlight, geometry, members); paths.current.set(filterKey, highlight); }
          context.save(); context.globalAlpha = 1; context.translate(first.column - anchor.column, first.row - anchor.row); context.clip(highlight); context.drawImage(picture.current, -first.column, -first.row, geometry.grid.columns, geometry.grid.rows); context.restore();
        }
      }
      const active = selectedRef.current !== null && group.pieceIds.includes(selectedRef.current);
      // Rustige contour in de kleur van de speler die de groep vasthoudt; de eigen selectie blijft oranje.
      if (!complete && lock && lock.userId !== p.meId) { context.strokeStyle = p.colorOf(lock.userId); context.lineWidth = 4 / scale; context.stroke(path); }
      context.strokeStyle = active ? "#d97716" : group.anchored || complete ? "rgba(43, 103, 99, .35)" : "rgba(29, 42, 60, .60)"; context.lineWidth = (active ? 3 : 1) / scale;
      if (!complete) context.stroke(path);
      context.restore();
    }
    if (target?.type === "LOCATION") { const path = new Path2D(); tracePuzzleGroup(path, geometry, target.pieceIds); context.save(); context.translate(target.x, target.y); context.fillStyle = "rgba(217,119,22,.16)"; context.fill(path); context.strokeStyle = "#d97716"; context.lineWidth = 3 / scale; context.stroke(path); context.restore(); }
    const marked = target?.type === "CONNECTION" ? [target.pieceId, target.neighborId] : target?.type === "FILTER" ? target.pieceIds : [];
    for (const id of marked) {
      const group = groupFor(snapshot, id); if (!group) continue; const anchor = groupAnchor(geometry, group); const piece = geometry.pieces[id]; const path = new Path2D(); tracePuzzleGroup(path, geometry, [id]);
      context.save(); context.translate(group.x + .5, group.y + .5); context.rotate(group.rotation * Math.PI / 180); context.translate(piece.column - anchor.column - .5, piece.row - anchor.row - .5); context.strokeStyle = "#d97716"; context.lineWidth = 4 / scale; context.stroke(path); context.restore();
    }
    context.restore();
  }

  useImperativeHandle(ref, () => ({
    fit: () => { const canvas = canvasRef.current; if (!canvas) return; camera.current = fitCamera({ width: canvas.clientWidth, height: canvas.clientHeight }, table.bounds); schedule(); },
    zoom: (factor: number) => { const canvas = canvasRef.current; if (!canvas) return; camera.current = zoomCamera(camera.current, { width: canvas.clientWidth, height: canvas.clientHeight }, table.bounds, factor, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }); schedule(); },
    repaint: schedule,
    selected: () => selectedRef.current,
    select: setSelected,
    focusWorld: (point: Point) => {
      const canvas = canvasRef.current; if (!canvas) return; const margin = 32;
      const screen = { x: camera.current.x + point.x * camera.current.scale, y: camera.current.y + point.y * camera.current.scale };
      camera.current.x += Math.max(margin, Math.min(canvas.clientWidth - margin, screen.x)) - screen.x;
      camera.current.y += Math.max(margin, Math.min(canvas.clientHeight - margin, screen.y)) - screen.y;
      constrain(); schedule();
    },
  }), [table, schedule, setSelected]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { schedule(); }, [props.paintKey, props.hint, props.locks, schedule]);

  useEffect(() => {
    mounted.current = true;
    const img = new Image(); img.onload = () => { picture.current = img; schedule(); }; img.src = image;
    const canvas = canvasRef.current;
    const resize = () => {
      if (!canvas || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
      const next = { width: canvas.clientWidth, height: canvas.clientHeight }; const previous = viewport.current;
      if (previous && next.width === previous.width && next.height === previous.height) return;
      camera.current = previous ? resizeCamera(camera.current, previous, next, table.bounds) : initialPuzzleCamera(next, geometry, propsRef.current.getSnapshot());
      viewport.current = next; schedule();
    };
    const observer = canvas ? new ResizeObserver(resize) : null; if (canvas) { observer?.observe(canvas); resize(); }
    return () => { mounted.current = false; img.onload = null; observer?.disconnect(); if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
    // De camera hoort bij dit scherm; een gedeelde update reset hem nooit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, geometry, table]);

  function picked(point: Point) { for (const group of [...propsRef.current.getSnapshot().groups].reverse()) { const id = groupMemberAt(geometry, group, point); if (id !== null) return { group, id }; } return null; }

  function beginPinch() {
    const fingers = [...pointers.current.values()]; if (fingers.length < 2) return;
    if (drag.current) { const active = drag.current; drag.current = null; void active.grab.then((token) => { if (token) propsRef.current.onRelease(active.groupId, token); }); }
    pan.current = null; const center = { x: (fingers[0].x + fingers[1].x) / 2, y: (fingers[0].y + fingers[1].y) / 2 };
    pinch.current = { distance: Math.max(1, distance(fingers[0], fingers[1])), world: worldPoint(center), scale: camera.current.scale }; schedule();
  }
  function updatePinch() {
    const active = pinch.current; const fingers = [...pointers.current.values()]; if (!active || fingers.length < 2) return;
    const center = { x: (fingers[0].x + fingers[1].x) / 2, y: (fingers[0].y + fingers[1].y) / 2 };
    camera.current.scale = Math.max(8, Math.min(240, active.scale * distance(fingers[0], fingers[1]) / active.distance));
    camera.current.x = center.x - active.world.x * camera.current.scale; camera.current.y = center.y - active.world.y * camera.current.scale; constrain(); schedule();
  }

  async function snapAfterMove(groupId: string, token: string) {
    const p = propsRef.current; let snapshot = p.getSnapshot();
    const piece = snapshot.groups.find((group) => group.id === groupId)?.pieceIds[0]; if (piece === undefined) return;
    for (let count = 0; count < pieceCount && mounted.current; count++) {
      snapshot = p.getSnapshot(); const moved = groupFor(snapshot, piece); if (!moved || snapshot.completedAt) break;
      const connection = findSnapConnection(snapshot, geometry, difficulty, moved.id, rulesVersion); if (!connection) break;
      // Na de eerste snap staat het nieuwe geheel vast: volgende buren worden naar dit anker getrokken.
      const a = count === 0 ? connection.a : connection.b; const b = count === 0 ? connection.b : connection.a;
      const changed = await p.onCommit({ kind: "connect", a, b }, token); if (!changed) break;
    }
    snapshot = p.getSnapshot(); const moved = groupFor(snapshot, piece);
    if (moved && !snapshot.completedAt && boardSnapTarget(snapshot, geometry, difficulty, moved.id, rulesVersion)) await p.onCommit({ kind: "anchor", groupId: moved.id }, token);
  }

  async function finishDrag(active: NonNullable<typeof drag.current>) {
    const p = propsRef.current; const token = await active.grab;
    if (!token) { p.onBusy?.(t("puzzleTogether.coop.busy")); schedule(); return; }
    try {
      const to = active.local; if (to) {
        const changed = await p.onCommit({ kind: "move", groupId: active.groupId, x: to.x, y: to.y }, token);
        if (changed) await snapAfterMove(active.groupId, token);
      }
    } finally { p.onRelease(active.groupId, token); }
  }

  async function run(work: () => Promise<void>) {
    if (!mounted.current || pending.current) return;
    pending.current = true; setBusy(true);
    try { await work(); } catch { /* de ouder toont de fout en herstelt de stand */ }
    finally { pending.current = false; if (mounted.current) setBusy(false); schedule(); }
  }

  function down(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (props.readOnly) return;
    const point = screenPoint(event); pointers.current.set(event.pointerId, point); event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size >= 2) { beginPinch(); return; }
    if (pending.current) return;
    const hit = picked(worldPoint(point));
    if (hit) {
      setSelected(hit.id); if (hit.group.anchored) { schedule(); return; }
      const locked = props.locks.find((lock) => lock.groupId === hit.group.id && lock.userId !== props.meId && Date.parse(lock.expiresAt) > Date.now());
      if (locked) { props.onBusy?.(t("puzzleTogether.coop.busy")); pan.current = { pointer: event.pointerId, point, camera: { ...camera.current } }; schedule(); return; }
      const world = worldPoint(point);
      drag.current = { pointer: event.pointerId, groupId: hit.group.id, offset: { x: world.x - hit.group.x, y: world.y - hit.group.y }, grab: props.onGrab(hit.group.id), local: null };
    } else { setSelected(null); pan.current = { pointer: event.pointerId, point, camera: { ...camera.current } }; }
    schedule();
  }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!pointers.current.has(event.pointerId)) return; const point = screenPoint(event); pointers.current.set(event.pointerId, point);
    if (pointers.current.size >= 2) { updatePinch(); return; }
    const active = drag.current;
    if (active?.pointer === event.pointerId) {
      const world = worldPoint(point); const group = propsRef.current.getSnapshot().groups.find((candidate) => candidate.id === active.groupId); if (!group) return;
      const position = clampGroupPosition(geometry, group as PuzzleGroup, world.x - active.offset.x, world.y - active.offset.y);
      active.local = position; propsRef.current.onDrag?.(active.groupId, position.x, position.y); schedule();
    } else if (pan.current?.pointer === event.pointerId) {
      camera.current.x = pan.current.camera.x + point.x - pan.current.point.x; camera.current.y = pan.current.camera.y + point.y - pan.current.point.y; constrain(); schedule();
    }
  }
  function up(event: ReactPointerEvent<HTMLCanvasElement>) {
    const active = drag.current; pointers.current.delete(event.pointerId);
    if (pointers.current.size >= 2) { beginPinch(); return; }
    if (pinch.current) { pinch.current = null; const remaining = [...pointers.current.entries()][0]; if (remaining) pan.current = { pointer: remaining[0], point: remaining[1], camera: { ...camera.current } }; return; }
    if (active?.pointer === event.pointerId) { void run(async () => { try { await finishDrag(active); } finally { if (drag.current === active) drag.current = null; schedule(); } }); }
    if (pan.current?.pointer === event.pointerId) pan.current = null;
  }
  function cancel(event: ReactPointerEvent<HTMLCanvasElement>) {
    pointers.current.delete(event.pointerId); const active = drag.current; drag.current = null; pan.current = null; pinch.current = null;
    if (active) void active.grab.then((token) => { if (token) propsRef.current.onRelease(active.groupId, token); });
    schedule();
  }
  async function rotateSelected() {
    const piece = selectedRef.current; if (piece === null || difficulty !== "MASTER") return;
    await run(async () => { const group = groupFor(propsRef.current.getSnapshot(), piece); if (!group || group.anchored) return; const token = await propsRef.current.onGrab(group.id); if (!token) { propsRef.current.onBusy?.(t("puzzleTogether.coop.busy")); return; } try { await propsRef.current.onCommit({ kind: "rotate", groupId: group.id }, token); } finally { propsRef.current.onRelease(group.id, token); } });
  }
  async function nudge(dx: number, dy: number) {
    const piece = selectedRef.current; if (piece === null) return;
    await run(async () => { const group = groupFor(propsRef.current.getSnapshot(), piece); if (!group || group.anchored) return; const token = await propsRef.current.onGrab(group.id); if (!token) { propsRef.current.onBusy?.(t("puzzleTogether.coop.busy")); return; } try { const changed = await propsRef.current.onCommit({ kind: "move", groupId: group.id, x: group.x + dx, y: group.y + dy }, token); if (changed) await snapAfterMove(group.id, token); } finally { propsRef.current.onRelease(group.id, token); } });
  }

  const selectedGroup = selected === null ? null : groupFor(props.getSnapshot(), selected);
  const complete = props.getSnapshot().completedAt !== null;

  return (
    <section aria-busy={busy} className="relative min-h-0 flex-1 overflow-hidden bg-vs-surface">
      <canvas ref={canvasRef} data-active-hint={props.hint?.type ?? ""} aria-label={t("jigsaw.board")} aria-describedby="jigsaw-board-help" tabIndex={0} className="block h-full w-full touch-none outline-none focus-visible:ring-4 focus-visible:ring-vs-xp"
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel}
        onWheel={(event) => { event.preventDefault(); const canvas = canvasRef.current; if (!canvas) return; camera.current = zoomCamera(camera.current, { width: canvas.clientWidth, height: canvas.clientHeight }, table.bounds, event.deltaY > 0 ? .9 : 1.1, screenPoint(event)); schedule(); }}
        onKeyDown={async (event) => {
          const pieces = props.getSnapshot().groups.flatMap((group) => group.pieceIds);
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelected(pieces[(pieces.indexOf(selectedRef.current ?? -1) + 1) % pieces.length]); schedule(); }
          if (event.key === "0") { event.preventDefault(); const canvas = canvasRef.current; if (canvas) { camera.current = fitCamera({ width: canvas.clientWidth, height: canvas.clientHeight }, table.bounds); schedule(); } }
          if ((event.key === "r" || event.key === "R") && difficulty === "MASTER") { event.preventDefault(); await rotateSelected(); }
          if (props.readOnly) return;
          if (event.key === "ArrowLeft") { event.preventDefault(); await nudge(-.2, 0); }
          if (event.key === "ArrowRight") { event.preventDefault(); await nudge(.2, 0); }
          if (event.key === "ArrowUp") { event.preventDefault(); await nudge(0, -.2); }
          if (event.key === "ArrowDown") { event.preventDefault(); await nudge(0, .2); }
        }} />
      {props.hint?.type === "PREVIEW" && <PreviewOverlay image={image} label={t("jigsaw.hintPreview")} />}
      <p id="jigsaw-board-help" className="sr-only">{t("jigsaw.boardHelp")}</p>
      {!props.readOnly && !complete && difficulty === "MASTER" && selectedGroup && !selectedGroup.anchored && <button type="button" aria-label={t("jigsaw.rotate")} title={t("jigsaw.rotate")} className="btn-primary absolute bottom-3 left-3 min-h-[60px] min-w-[60px] rounded-2xl !p-[12px] shadow-md" disabled={busy} onClick={rotateSelected}><RotateCw size={26} /></button>}
      {props.controls}
    </section>
  );
});

export default PuzzleTable;
