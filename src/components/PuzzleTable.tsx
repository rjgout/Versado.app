"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import NextImage from "next/image";
import { RotateCw } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { createPuzzleGeometry } from "@/lib/puzzle/geometry";
import { renderPuzzle } from "@/lib/puzzle/render";
import { createNearSnapTracker, prefersReducedMotion } from "@/lib/puzzle/nearSnap";
import { createCompletionGate, createPuzzleMotion, frameTime, type RemotePlacement } from "@/lib/puzzle/motion";
import { boardSnapTarget, findSnapConnection, groupFor } from "@/lib/puzzle/engine";
import { clampGroupPosition, groupMemberAt, puzzleRenderOrder, puzzleWorktable } from "@/lib/puzzle/worktable";
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
export interface PuzzleTableHandle { /** Roept `done` aan zodra de laatste bevestigde snap getoond is (direct zonder animatie); alleen presentatie. */ settle: (done: () => void) => void; fit: () => void; zoom: (factor: number) => void; repaint: () => void; selected: () => number | null; select: (piece: number | null) => void; focusWorld: (point: Point) => void }

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
  const table = useMemo(() => puzzleWorktable(geometry), [geometry]); const motion = useMemo(() => createPuzzleMotion(geometry), [geometry]); const completion = useMemo(() => createCompletionGate(), []);
  const policy = puzzlePolicy(difficulty, rulesVersion);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const picture = useRef<HTMLImageElement | null>(null);
  const camera = useRef<PuzzleCamera>({ scale: 60, x: 0, y: 0 });
  const viewport = useRef<ViewportSize | null>(null);
  const frame = useRef<number | null>(null);
  const paths = useRef(new Map<string, Path2D>());
  const nearSnap = useRef(createNearSnapTracker());
  const remoteSpot = useRef<RemotePlacement>({ x: 0, y: 0 }); const lockedByOthers = useRef(new Set<string>());
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ pointer: number; groupId: string; offset: Point; grab: Promise<string | null>; token: string | null; released: boolean; local: Point | null } | null>(null);
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
    const complete = snapshot.completedAt !== null; const mine = drag.current?.groupId ?? null;
    const now = Date.now(); const stamp = frameTime(); const remoteAll = p.remoteDrags.current;
    // Verliest een andere speler zijn lock (verlopen of losgelaten), dan stopt het volgen van zijn sleepbeweging direct.
    let remote: ReadonlyMap<string, { x: number; y: number; until: number }> = remoteAll;
    for (const lock of p.locks) if (lock.userId !== p.meId && Date.parse(lock.expiresAt) > now) lockedByOthers.current.add(lock.groupId);
    if (lockedByOthers.current.size) {
      let dropped: Map<string, { x: number; y: number; until: number }> | null = null;
      for (const id of lockedByOthers.current) {
        if (p.locks.some((lock) => lock.groupId === id && lock.userId !== p.meId && Date.parse(lock.expiresAt) > now)) continue;
        lockedByOthers.current.delete(id); if (remoteAll.has(id)) (dropped ??= new Map(remoteAll)).delete(id);
      }
      if (dropped) remote = dropped;
    }
    // De bevestigde stand staat al in `snapshot`; remote bewegingen worden tussen de ontvangen punten gevolgd en bevestigde snaps glijden kort.
    motion.update({ snapshot, remote, now: stamp, wall: now, enabled: !prefersReducedMotion(), maxDistance: Math.max(policy.snap, policy.boardSnapDistance) + .1 });
    // Een actieve (eigen of andermans) groep ligt tijdens het slepen bovenop.
    const order = puzzleRenderOrder(snapshot.groups, mine);
    const topRemote = [...remote.keys()].filter((id) => (remote.get(id)?.until ?? 0) > now);
    const ordered = motion.groups(topRemote.length ? [...order.filter((g) => !topRemote.includes(g.id)), ...order.filter((g) => topRemote.includes(g.id))] : order, stamp);
    // Een voltooide puzzel toont zijn eindweergave pas als de laatste bevestigde snap klaar is.
    const settled = complete && !motion.gliding(stamp);
    completion.tick({ now: stamp, complete, animating: motion.gliding(stamp), reduced: prefersReducedMotion() });
    // Alleen de speler die sleept ziet dit, lokaal berekend: pas zodra de eigen greep is gelukt en zolang niemand anders de groep vasthoudt.
    const active = drag.current; const moving = active?.token && !active.released ? snapshot.groups.find((group) => group.id === active.groupId) : undefined;
    const taken = active ? p.locks.some((lock) => lock.groupId === active.groupId && lock.userId !== p.meId && Date.parse(lock.expiresAt) > now) : false;
    const glow = active && moving && !complete && !taken ? nearSnap.current.update({ snapshot, geometry, difficulty, rulesVersion, groupId: moving.id, x: active.local?.x ?? moving.x, y: active.local?.y ?? moving.y, now: stamp, reducedMotion: prefersReducedMotion() }) : nearSnap.current.reset();
    if (nearSnap.current.animating || motion.active(stamp) || completion.waiting) schedule();
    renderPuzzle(canvas, {
      geometry, table, camera: camera.current, image: picture.current, paths: paths.current, snapshot, groups: ordered,
      place: (group, out) => {
        const local = drag.current?.groupId === group.id && drag.current.local ? drag.current.local : null;
        const followed = local ? null : motion.remoteAt(group.id, stamp, remoteSpot.current);
        const far = remote.get(group.id); const remotePos = far && far.until > now ? far : null;
        out.x = local?.x ?? followed?.x ?? remotePos?.x ?? group.x; out.y = local?.y ?? followed?.y ?? remotePos?.y ?? group.y;
        out.lifted = group.id === mine || followed !== null || remotePos !== null;
        const lock = p.locks.find((candidate) => candidate.groupId === group.id && Date.parse(candidate.expiresAt) > now);
        out.lockColor = !settled && lock && lock.userId !== p.meId ? p.colorOf(lock.userId) : null;
      },
      selectedPiece: selectedRef.current, hint: p.hint?.target,
      backdrop: !settled && (policy.showOutline || policy.showGhost), ghost: !settled && policy.showGhost, outline: !settled && policy.showOutline,
      edges: !settled, anchoredStroke: "rgba(43, 103, 99, .35)", nearSnap: glow,
    });
  }

  useImperativeHandle(ref, () => ({
    settle: (done: () => void) => { completion.request(done, frameTime()); schedule(); },
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
  }), [table, schedule, setSelected, completion]); // eslint-disable-line react-hooks/exhaustive-deps

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
    return () => { mounted.current = false; img.onload = null; observer?.disconnect(); motion.clear(); completion.cancel(); if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
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
      const grab = props.onGrab(hit.group.id);
      const started = { pointer: event.pointerId, groupId: hit.group.id, offset: { x: world.x - hit.group.x, y: world.y - hit.group.y }, grab, token: null as string | null, released: false, local: null };
      drag.current = started;
      // Pas na een gelukte greep (de lock is van mij) toont het bord bijna-passend-feedback.
      grab.then((token) => { started.token = token; if (drag.current === started) schedule(); }, () => undefined);
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
    // Direct bij loslaten verdwijnt de feedback, ook al loopt de commit nog.
    if (active?.pointer === event.pointerId) { active.released = true; schedule(); void run(async () => { try { await finishDrag(active); } finally { if (drag.current === active) drag.current = null; schedule(); } }); }
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
