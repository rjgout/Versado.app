"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import NextImage from "next/image";
import { Ellipsis, RotateCw } from "lucide-react";
import FocusLayout from "@/components/versado/FocusLayout";
import { useT } from "@/components/I18nProvider";
import { createPuzzleGeometry, tracePuzzleGroup } from "@/lib/puzzle/geometry";
import { connectedPieces, findSnapConnection, groupFor, worldOf } from "@/lib/puzzle/engine";
import { clampGroupPosition, groupAnchor, groupMemberAt, puzzleWorktable } from "@/lib/puzzle/worktable";
import { constrainCamera as constrainViewport, fitCamera, initialPuzzleCamera, resizeCamera, screenToWorld, zoomCamera, type PuzzleCamera, type ViewportSize } from "@/lib/puzzle/viewport";
import { PUZZLE_DIFFICULTIES, type PuzzleDifficulty, type PuzzlePieceCount, type PuzzleSnapshot } from "@/lib/puzzle/types";
import { filterPuzzleCatalog, puzzleCatalogPage } from "@/lib/puzzle/catalog";
import type { JigsawAnswerResult } from "@/lib/jigsaw";
import { useSetBackTarget } from "@/lib/backTarget";

type State = { id: string; version: number; status: string; image: string; seed: string; geometryVersion: number; pieceCount: PuzzlePieceCount; difficulty: PuzzleDifficulty; snapshot: PuzzleSnapshot; question?: { text: string; options: string[] }; answer?: Answer };
type Answer = JigsawAnswerResult | { alreadyAnswered: true };
type Point = { x: number; y: number };
type Drag = { pointer: number; groupId: string; offset: Point };
type Pan = { pointer: number; point: Point; camera: PuzzleCamera };
type Pinch = { distance: number; world: Point; scale: number };
type Stage = "BOARD" | "COMPLETE" | "QUESTION" | "RESULT";

const KEY = "versado:jigsaw-v2-session";
const PAGE_SIZE = 24;
const difficulties: PuzzleDifficulty[] = ["DISCOVERER", "ADVENTURER", "EXPERT", "MASTER"];
const levelKeys = { DISCOVERER: "jigsaw.discoverer", ADVENTURER: "jigsaw.adventurer", EXPERT: "jigsaw.expert", MASTER: "jigsaw.master" } as const;

class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request(body: object) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch("/api/jigsaw-v2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok || !data) throw new RequestError(typeof data === "object" && data && "error" in data && typeof data.error === "string" ? data.error : "", response.status);
      return data;
    } catch (cause) {
      // Dezelfde body/actionId opnieuw: verloren responses zijn veilig herhaalbaar.
      if (attempt === 0 && (!(cause instanceof RequestError) || cause.status >= 500)) continue;
      throw cause;
    }
  }
}

function remember(id: string | null) { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* opslag kan bewust uitstaan */ } }
function distance(one: Point, two: Point) { return Math.hypot(one.x - two.x, one.y - two.y); }

export default function JigsawV2Client({ images }: { images: Array<{ url: string; story: number }> }) {
  const t = useT();
  const [state, setState] = useState<State | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [pieceCount, setPieceCount] = useState<PuzzlePieceCount>(24);
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>("ADVENTURER");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const starting = useRef(false);
  const chooseAnother = useCallback(() => { remember(null); setState(null); }, []);

  useEffect(() => {
    let gone = false; let id: string | null = null;
    try { id = localStorage.getItem(KEY); } catch { /* zie remember */ }
    if (id) request({ action: "resume", sessionId: id }).then((value) => {
      if (gone || !value) return;
      const next = value as State;
      if (next.status === "ANSWERED" || next.status === "ABANDONED") { remember(null); setImageId(next.image); setPieceCount(next.pieceCount); setDifficulty(next.difficulty); }
      else setState(next);
    }).catch((cause) => {
      if (gone) return;
      if (cause instanceof RequestError && (cause.status === 404 || cause.status === 401)) remember(null);
      setError(cause instanceof Error && cause.message ? cause.message : t("jigsaw.failed"));
    }).finally(() => { if (!gone) setLoading(false); });
    else queueMicrotask(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [t]);

  const catalog = useMemo(() => images.map((image, index) => ({ src: image.url, index, label: t("jigsaw.image", { n: index + 1 }), category: t("jigsaw.story", { n: image.story }) })), [images, t]);
  const filtered = useMemo(() => filterPuzzleCatalog(catalog, query, (image) => `${image.label} ${image.category} ${image.index + 1}`), [catalog, query]);
  const { pages, currentPage: activePage, items: visible } = puzzleCatalogPage(filtered, page, PAGE_SIZE);
  const selectedImage = visible.find((image) => image.src === imageId);

  async function start(previous?: State) {
    if (starting.current || (!previous && !selectedImage)) return;
    starting.current = true; setLoading(true); setError("");
    try { const next = await request({ action: "start", imageId: previous?.image ?? selectedImage!.src, pieceCount: previous?.pieceCount ?? pieceCount, difficulty: previous?.difficulty ?? difficulty }) as State; remember(next.id); setState(next); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("jigsaw.failed")); }
    finally { starting.current = false; setLoading(false); }
  }

  if (state) return <Puzzle key={state.id} initial={state} setOuter={(next) => setState((current) => current?.id === next.id ? next : current)} onReplay={() => { const previous = state; setState(null); void start(previous); }} onChooseAnother={chooseAnother} />;
  if (loading) return <FocusLayout><p role="status">{t("common.loading")}</p></FocusLayout>;
  return <FocusLayout className="max-w-5xl gap-5">
    <header><h1 className="text-2xl font-extrabold text-vs-fg">{t("jigsaw.title")}</h1><p className="mt-2 text-vs-fg-2">{t("jigsaw.intro")}</p></header>
    <section aria-labelledby="jigsaw-image-choice"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="jigsaw-image-choice" className="font-bold">{t("jigsaw.chooseImage")}</h2><p className="text-sm text-vs-fg-2">{t("jigsaw.catalogCount", { n: images.length })}</p></div><label className="min-w-[min(100%,16rem)] text-sm font-semibold">{t("jigsaw.searchImages")}<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} className="input mt-1 w-full" /></label></div>
      {visible.length ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">{visible.map(({ src, label, category }) => <button key={src} type="button" onClick={() => setImageId(src)} aria-pressed={imageId === src} className={`min-w-0 overflow-hidden rounded-xl border-2 text-left ${imageId === src ? "border-vs-xp" : "border-vs-line"}`}><NextImage src={src} alt="" width={240} height={180} unoptimized loading="lazy" className="aspect-[4/3] w-full object-cover" /><span className="block vs-wrap px-2 pt-2 text-sm font-semibold">{label}</span><span className="block vs-wrap px-2 pb-2 text-xs text-vs-fg-2">{category}</span></button>)}</div> : <p className="mt-3 text-vs-fg-2">{t("jigsaw.noImages")}</p>}
      {pages > 1 && <nav className="mt-3 flex flex-wrap items-center justify-between gap-2" aria-label={t("jigsaw.imagePages")}><button type="button" className="btn-secondary min-h-11" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>{t("jigsaw.previous")}</button><span className="text-sm font-semibold">{t("jigsaw.page", { n: activePage + 1, total: pages })}</span><button type="button" className="btn-secondary min-h-11" disabled={activePage + 1 >= pages} onClick={() => setPage(activePage + 1)}>{t("jigsaw.next")}</button></nav>}
    </section>
    <section><h2 className="font-bold">{t("jigsaw.pieces", { n: pieceCount })}</h2><div className="mt-3 flex flex-wrap gap-2">{[6, 12, 24, 48, 96].map((count) => <button type="button" className={`btn-secondary min-h-11 ${count === pieceCount ? "!border-vs-xp !bg-vs-xp/15" : ""}`} onClick={() => setPieceCount(count as PuzzlePieceCount)} key={count}>{count}</button>)}</div></section>
    <section><h2 className="font-bold">{t("jigsaw.difficulty")}</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{difficulties.map((level) => <button type="button" className={`btn-secondary min-h-11 ${difficulty === level ? "!border-vs-xp !bg-vs-xp/15" : ""}`} aria-pressed={difficulty === level} onClick={() => setDifficulty(level)} key={level}>{t(levelKeys[level])}</button>)}</div></section>
    <p role="status">{selectedImage ? selectedImage.label : t("jigsaw.chooseImage")}</p><button type="button" className="btn-primary min-h-12 self-start" disabled={!selectedImage || loading} onClick={() => void start()}>{t("jigsaw.start")}</button>{error && <p role="alert">{error}</p>}
  </FocusLayout>;
}

function Puzzle({ initial, setOuter, onChooseAnother, onReplay }: { initial: State; setOuter: (state: State) => void; onChooseAnother: () => void; onReplay: () => void }) {
  const t = useT(); const [state, setState] = useState(initial); const [stage, setStage] = useState<Stage>(() => { if (initial.status === "ANSWERED") return "RESULT"; if (initial.status !== "COMPLETED") return "BOARD"; try { if (localStorage.getItem(`${KEY}:question`) === initial.id) return "QUESTION"; } catch {} return "COMPLETE"; });
  const shown = useRef(initial); const saved = useRef(initial); const [selected, setSelected] = useState<number | null>(null); const [message, setMessage] = useState(""); const [answer, setAnswer] = useState<Answer | null>(initial.answer ?? null); const [menuOpen, setMenuOpen] = useState(false);
  const pending = useRef(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null); const image = useRef<HTMLImageElement | null>(null); const camera = useRef<PuzzleCamera>({ scale: 60, x: 0, y: 0 }); const frame = useRef<number | null>(null);
  const mounted = useRef(true); const stopAnimation = useRef<(() => void) | null>(null);
  const viewport = useRef<ViewportSize | null>(null); const paths = useRef(new Map<string, Path2D>());
  const pointers = useRef(new Map<number, Point>()); const drag = useRef<Drag | null>(null); const pan = useRef<Pan | null>(null); const pinch = useRef<Pinch | null>(null);
  const geometry = useMemo(() => createPuzzleGeometry(initial.pieceCount, initial.seed, initial.geometryVersion), [initial.pieceCount, initial.seed, initial.geometryVersion]); const table = useMemo(() => puzzleWorktable(geometry), [geometry]); const policy = PUZZLE_DIFFICULTIES[state.difficulty];

  const back = useCallback(() => {
    if (stage === "QUESTION") { try { localStorage.removeItem(`${KEY}:question`); } catch {} setStage("COMPLETE"); }
    else onChooseAnother();
  }, [stage, onChooseAnother]);
  useSetBackTarget("/jigsaw", "/jigsaw", "", back);

  function schedulePaint() { if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; paint(); }); }
  function constrainCamera() { const canvas = canvasRef.current; if (canvas) camera.current = constrainViewport(camera.current, { width: canvas.clientWidth, height: canvas.clientHeight }, table.bounds); }
  function paint() {
    const canvas = canvasRef.current; if (!canvas) return; const rect = canvas.getBoundingClientRect(); const ratio = Math.min(window.devicePixelRatio || 1, 2); const width = Math.max(1, Math.round(rect.width * ratio)); const height = Math.max(1, Math.round(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const context = canvas.getContext("2d"); if (!context) return; context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, rect.width, rect.height); context.fillStyle = "#edf1f2"; context.fillRect(0, 0, rect.width, rect.height);
    context.save(); context.translate(camera.current.x, camera.current.y); context.scale(camera.current.scale, camera.current.scale);
    context.fillStyle = "#dbe6e6"; context.fillRect(table.bounds.minX, table.bounds.minY, table.bounds.maxX - table.bounds.minX, table.bounds.maxY - table.bounds.minY); context.strokeStyle = "rgba(42, 68, 74, .45)"; context.lineWidth = 2 / camera.current.scale; context.strokeRect(table.bounds.minX, table.bounds.minY, table.bounds.maxX - table.bounds.minX, table.bounds.maxY - table.bounds.minY);
    context.fillStyle = "rgba(255, 255, 255, .74)"; context.fillRect(table.puzzle.x, table.puzzle.y, table.puzzle.width, table.puzzle.height); if (policy.showGhost && image.current) { context.globalAlpha = .18; context.drawImage(image.current, table.puzzle.x, table.puzzle.y, table.puzzle.width, table.puzzle.height); context.globalAlpha = 1; }
    if (policy.showOutline) { context.strokeStyle = "rgba(64, 87, 94, .46)"; context.setLineDash([.12, .1]); context.strokeRect(table.puzzle.x, table.puzzle.y, table.puzzle.width, table.puzzle.height); context.setLineDash([]); }
    for (const group of shown.current.snapshot.groups) {
      const anchor = groupAnchor(geometry, group); const key = group.pieceIds.join(",");
      let path = paths.current.get(key);
      if (!path) { path = new Path2D(); tracePuzzleGroup(path, geometry, group.pieceIds); paths.current.set(key, path); }
      context.save(); context.translate(group.x + .5, group.y + .5); context.rotate(group.rotation * Math.PI / 180); context.translate(-.5, -.5);
      // Eén echte groepscontour en één beelduitsnede: geen afzonderlijke clips
      // met antialias-kieren of dubbel gestrokte interne aansluitingen.
      context.save(); context.clip(path);
      if (image.current) context.drawImage(image.current, -anchor.column, -anchor.row, geometry.grid.columns, geometry.grid.rows);
      else { context.fillStyle = "#b9d5d7"; context.fill(path); }
      context.restore();
      const active = selected !== null && group.pieceIds.includes(selected);
      context.strokeStyle = active ? "#d97716" : "rgba(29, 42, 60, .60)"; context.lineWidth = (active ? 3 : 1) / camera.current.scale;
      context.stroke(path); context.restore();
    }
    context.restore();
  }
  function update(next: State) { saved.current = next; if (!mounted.current) return; shown.current = next; setState(next); setOuter(next); remember(next.id); if (next.status === "COMPLETED") setStage("COMPLETE"); if (next.status === "ANSWERED") setStage("RESULT"); schedulePaint(); }
  async function animateSnap(before: State, next: State, groupId: string) {
    const moving = before.snapshot.groups.find((group) => group.id === groupId);
    const target = moving && groupFor(next.snapshot, moving.pieceIds[0]);
    if (!moving || !target || next.version === before.version || !mounted.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const to = worldOf(geometry, target, moving.pieceIds[0]);
    if (Math.hypot(to.x - moving.x, to.y - moving.y) < 1e-9) return;
    await new Promise<void>((resolve) => {
      const start = performance.now(); let animation = 0;
      const finish = () => { cancelAnimationFrame(animation); stopAnimation.current = null; resolve(); };
      stopAnimation.current = finish;
      const step = (now: number) => {
        if (!mounted.current) { finish(); return; }
        const progress = Math.min(1, (now - start) / 140); const eased = 1 - (1 - progress) ** 3;
        shown.current = { ...before, snapshot: { ...before.snapshot, groups: before.snapshot.groups.map((group) => group.id === groupId ? { ...group, x: moving.x + (to.x - moving.x) * eased, y: moving.y + (to.y - moving.y) * eased } : group) } };
        paint();
        if (progress < 1) animation = requestAnimationFrame(step); else finish();
      };
      animation = requestAnimationFrame(step);
    });
  }
  async function action(operation: object, movedGroupId?: string) { const current = saved.current; const next = await request({ action: "act", sessionId: current.id, version: current.version, actionId: crypto.randomUUID(), operation }) as State; if (movedGroupId) await animateSnap(current, next, movedGroupId); update(next); return next; }
  async function runBoard(work: () => Promise<void>) {
    if (!mounted.current || pending.current || saved.current.status !== "ACTIVE") return;
    pending.current = true; setBusy(true); setError("");
    try { await work(); }
    catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof Error && cause.message ? cause.message : t("jigsaw.failed"));
      // Ook na een verloren completion-response de autoritatieve fase herstellen.
      try { update(await request({ action: "resume", sessionId: saved.current.id }) as State); }
      catch { shown.current = saved.current; setState(saved.current); schedulePaint(); }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  function fit() { const canvas = canvasRef.current; if (!canvas) return; camera.current = fitCamera({ width: canvas.clientWidth, height: canvas.clientHeight }, table.bounds); schedulePaint(); }
  function screenPoint(event: { clientX: number; clientY: number }) { const rect = canvasRef.current?.getBoundingClientRect(); return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 0, y: 0 }; }
  function worldPoint(point: Point) { return screenToWorld(camera.current, point); }
  function picked(point: Point) { for (const group of [...shown.current.snapshot.groups].reverse()) { const id = groupMemberAt(geometry, group, point); if (id !== null) return { group, id }; } return null; }
  function transientMove(groupId: string, x: number, y: number) { const base = saved.current; const group = base.snapshot.groups.find((candidate) => candidate.id === groupId); if (!group) return; const position = clampGroupPosition(geometry, group, x, y); const next = { ...base, snapshot: { ...base.snapshot, groups: base.snapshot.groups.map((candidate) => candidate.id === groupId ? { ...candidate, ...position } : candidate) } }; shown.current = next; setState(next); schedulePaint(); }
  function beginPinch() { const fingers = [...pointers.current.values()]; if (fingers.length < 2) return; if (drag.current) { drag.current = null; shown.current = saved.current; setState(saved.current); } pan.current = null; const center = { x: (fingers[0].x + fingers[1].x) / 2, y: (fingers[0].y + fingers[1].y) / 2 }; pinch.current = { distance: Math.max(1, distance(fingers[0], fingers[1])), world: worldPoint(center), scale: camera.current.scale }; }
  function updatePinch() { const active = pinch.current; const fingers = [...pointers.current.values()]; if (!active || fingers.length < 2) return; const center = { x: (fingers[0].x + fingers[1].x) / 2, y: (fingers[0].y + fingers[1].y) / 2 }; camera.current.scale = Math.max(8, Math.min(240, active.scale * distance(fingers[0], fingers[1]) / active.distance)); camera.current.x = center.x - active.world.x * camera.current.scale; camera.current.y = center.y - active.world.y * camera.current.scale; constrainCamera(); schedulePaint(); }
  async function snapAfterMove(next: State, groupId: string) {
    let current = next; const piece = next.snapshot.groups.find((group) => group.id === groupId)?.pieceIds[0];
    if (piece === undefined) return;
    for (let count = 0; count < state.pieceCount && mounted.current; count++) {
      const moved = groupFor(current.snapshot, piece); if (!moved) break;
      const connection = findSnapConnection(current.snapshot, geometry, current.difficulty, moved.id); if (!connection) break;
      // Na de eerste snap staat het nieuwe geheel vast: volgende buren worden
      // naar dit anker getrokken, niet andersom.
      const a = count === 0 ? connection.a : connection.b;
      const b = count === 0 ? connection.b : connection.a;
      const joined = await action({ kind: "connect", a, b }, groupFor(current.snapshot, b)?.id);
      if (joined.version === current.version) break;
      current = joined; if (mounted.current) setMessage(t("jigsaw.piecesConnected"));
    }
  }
  async function finishDrag(active: Drag, point: Point) { const next = await action({ kind: "move", groupId: active.groupId, x: point.x - active.offset.x, y: point.y - active.offset.y }); await snapAfterMove(next, active.groupId); }
  function boardDown(event: ReactPointerEvent<HTMLCanvasElement>) { if (pending.current) return; const point = screenPoint(event); pointers.current.set(event.pointerId, point); event.currentTarget.setPointerCapture(event.pointerId); if (pointers.current.size >= 2) { beginPinch(); return; } const hit = picked(worldPoint(point)); if (hit) { setSelected(hit.id); drag.current = { pointer: event.pointerId, groupId: hit.group.id, offset: { x: worldPoint(point).x - hit.group.x, y: worldPoint(point).y - hit.group.y } }; } else { setSelected(null); pan.current = { pointer: event.pointerId, point, camera: { ...camera.current } }; } }
  function boardMove(event: ReactPointerEvent<HTMLCanvasElement>) { if (!pointers.current.has(event.pointerId)) return; const point = screenPoint(event); pointers.current.set(event.pointerId, point); if (pointers.current.size >= 2) { updatePinch(); return; } if (drag.current?.pointer === event.pointerId) { const world = worldPoint(point); transientMove(drag.current.groupId, world.x - drag.current.offset.x, world.y - drag.current.offset.y); } else if (pan.current?.pointer === event.pointerId) { camera.current.x = pan.current.camera.x + point.x - pan.current.point.x; camera.current.y = pan.current.camera.y + point.y - pan.current.point.y; constrainCamera(); schedulePaint(); } }
  async function boardUp(event: ReactPointerEvent<HTMLCanvasElement>) { const point = screenPoint(event); const activeDrag = drag.current; pointers.current.delete(event.pointerId); if (pointers.current.size >= 2) { beginPinch(); return; } if (pinch.current) { pinch.current = null; const remaining = [...pointers.current.entries()][0]; if (remaining) pan.current = { pointer: remaining[0], point: remaining[1], camera: { ...camera.current } }; return; } if (activeDrag?.pointer === event.pointerId) { drag.current = null; await runBoard(() => finishDrag(activeDrag, worldPoint(point))); } if (pan.current?.pointer === event.pointerId) pan.current = null; }
  function boardCancel(event: ReactPointerEvent<HTMLCanvasElement>) { pointers.current.delete(event.pointerId); drag.current = null; pan.current = null; pinch.current = null; shown.current = saved.current; setState(saved.current); schedulePaint(); }
  function zoom(factor: number, around?: Point) { const canvas = canvasRef.current; if (!canvas) return; const center = around ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }; camera.current = zoomCamera(camera.current, { width: canvas.clientWidth, height: canvas.clientHeight }, table.bounds, factor, center); schedulePaint(); }
  async function rotateSelected() { if (selected === null || state.difficulty !== "MASTER") return; await runBoard(async () => { const group = groupFor(saved.current.snapshot, selected); if (group) await action({ kind: "rotate", groupId: group.id }); }); }
  async function moveSelectedBy(dx: number, dy: number) { if (selected === null) return; await runBoard(async () => { const group = groupFor(saved.current.snapshot, selected); if (group) { const next = await action({ kind: "move", groupId: group.id, x: group.x + dx, y: group.y + dy }); await snapAfterMove(next, group.id); } }); }
  async function submit(choice: number) { const result = await request({ action: "answer", sessionId: saved.current.id, choice }) as Answer; if (!mounted.current) return; setAnswer(result); const next = { ...saved.current, status: "ANSWERED", answer: result }; saved.current = next; setState(next); setOuter(next); remember(null); setStage("RESULT"); }
  function continueToQuestion() { try { localStorage.setItem(`${KEY}:question`, state.id); } catch {} setStage("QUESTION"); }

  useEffect(() => {
    mounted.current = true;
    const picture = new Image(); picture.onload = () => { image.current = picture; schedulePaint(); }; picture.src = initial.image;
    const canvas = canvasRef.current;
    const resize = () => {
      if (!canvas || canvas.clientWidth <= 0 || canvas.clientHeight <= 0) return;
      const next = { width: canvas.clientWidth, height: canvas.clientHeight };
      const previous = viewport.current;
      if (previous && next.width === previous.width && next.height === previous.height) return;
      camera.current = previous ? resizeCamera(camera.current, previous, next, table.bounds) : initialPuzzleCamera(next, geometry, saved.current.snapshot);
      viewport.current = next; schedulePaint();
    };
    const observer = canvas ? new ResizeObserver(resize) : null; if (canvas) { observer?.observe(canvas); resize(); }
    return () => { mounted.current = false; picture.onload = null; observer?.disconnect(); stopAnimation.current?.(); if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
    // De camera hoort bij deze ge-keyde sessie; een actie reset hem nooit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { schedulePaint(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selected]);

  if (stage === "COMPLETE") return <Completion image={state.image} onContinue={continueToQuestion} t={t} />;
  if (stage === "QUESTION") return <Question state={state} onSubmit={submit} t={t} />;
  if (stage === "RESULT") return <Result answer={answer} question={state.question} onChooseAnother={onChooseAnother} onReplay={onReplay} t={t} />;
  const selectedGroup = selected === null ? null : groupFor(state.snapshot, selected);
  return <FocusLayout className="puzzle-workspace gap-0"><section aria-busy={busy} className="relative min-h-0 flex-1 overflow-hidden bg-vs-surface"><canvas ref={canvasRef} aria-label={t("jigsaw.board")} aria-describedby="jigsaw-board-help" tabIndex={0} className="block h-full w-full touch-none outline-none focus-visible:ring-4 focus-visible:ring-vs-xp" onPointerDown={boardDown} onPointerMove={boardMove} onPointerUp={boardUp} onPointerCancel={boardCancel} onWheel={(event) => { event.preventDefault(); zoom(event.deltaY > 0 ? .9 : 1.1, screenPoint(event)); }} onKeyDown={async (event) => { if (event.key === "0") { event.preventDefault(); fit(); } if ((event.key === "r" || event.key === "R") && state.difficulty === "MASTER") { event.preventDefault(); await rotateSelected(); } if (event.key === "ArrowLeft") { event.preventDefault(); await moveSelectedBy(-.2, 0); } if (event.key === "ArrowRight") { event.preventDefault(); await moveSelectedBy(.2, 0); } if (event.key === "ArrowUp") { event.preventDefault(); await moveSelectedBy(0, -.2); } if (event.key === "ArrowDown") { event.preventDefault(); await moveSelectedBy(0, .2); } }} /><p id="jigsaw-board-help" className="sr-only">{t("jigsaw.boardHelp")}</p>{state.difficulty === "MASTER" && selectedGroup && <button type="button" aria-label={t("jigsaw.rotate")} title={t("jigsaw.rotate")} className="btn-primary absolute bottom-3 left-3 min-h-11 min-w-11 !px-2 shadow-lg" disabled={busy} onClick={rotateSelected}><RotateCw size={18} /></button>}<div className="absolute bottom-3 right-3"><button type="button" className="btn-secondary min-h-11 min-w-11 !px-2 shadow-sm" aria-label={t("jigsaw.boardMenu")} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><Ellipsis size={18} /></button>{menuOpen && <div className="absolute bottom-12 right-0 z-10 w-52 max-w-[calc(100vw-1.5rem-var(--vs-safe-area-left)-var(--vs-safe-area-right))] max-h-[calc(100dvh-var(--header-height,var(--header-default))-4.5rem-var(--vs-safe-area-bottom))] overflow-y-auto rounded-xl border border-vs-line !bg-vs-surface p-1 shadow-lg"><button type="button" className="btn-secondary w-full min-h-11 justify-start text-left" onClick={() => { fit(); setMenuOpen(false); }}>{t("jigsaw.fitBoard")}</button><button type="button" className="btn-secondary mt-1 w-full min-h-11 justify-start text-left" disabled={busy} onClick={onChooseAnother}>{t("jigsaw.chooseAnother")}</button></div>}</div><p aria-live="polite" className="sr-only">{message || t("jigsaw.connected", { n: connectedPieces(state.snapshot), total: state.pieceCount })}</p>{error && <p role="alert" className="absolute inset-x-3 top-3 rounded-xl bg-vs-surface p-3 text-vs-fg">{error}</p>}</section></FocusLayout>;
}

function Completion({ image, onContinue, t }: { image: string; onContinue: () => void; t: ReturnType<typeof useT> }) { return <FocusLayout className="page-fill max-w-none items-center justify-center gap-5 py-4 text-center"><div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-vs-surface shadow-lg"><NextImage src={image} alt={t("jigsaw.completedImage")} width={1440} height={960} unoptimized priority className="h-auto max-h-[68dvh] w-full object-contain" /></div><div><h1 className="text-2xl font-extrabold text-vs-fg">{t("jigsaw.complete")}</h1><p className="mt-2 text-vs-fg-2">{t("jigsaw.completeHint")}</p></div><button type="button" className="btn-primary min-h-12" onClick={onContinue}>{t("jigsaw.continue")}</button></FocusLayout>; }

function Question({ state, onSubmit, t }: { state: State; onSubmit: (choice: number) => Promise<void>; t: ReturnType<typeof useT> }) { const [choice, setChoice] = useState<number | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); async function submit() { if (choice === null || busy) return; setBusy(true); setError(""); try { await onSubmit(choice); } catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("jigsaw.failed")); } finally { setBusy(false); } } return <FocusLayout className="page-fill mx-auto max-w-2xl justify-center gap-5 py-4"><header><h1 className="text-2xl font-extrabold text-vs-fg">{t("jigsaw.questionIntro")}</h1><p className="mt-2 text-vs-fg-2">{t("jigsaw.questionHint")}</p></header><section className="card"><p className="font-semibold">{state.question?.text}</p><div className="mt-4 grid gap-2">{state.question?.options.map((option, index) => <button key={option} type="button" className={`btn-secondary min-h-12 justify-start text-left ${choice === index ? "!border-vs-xp !bg-vs-xp/15" : ""}`} aria-pressed={choice === index} disabled={busy} onClick={() => setChoice(index)}>{option}</button>)}</div></section><button type="button" className="btn-primary min-h-12 self-start" disabled={choice === null || busy} onClick={submit}>{busy ? t("jigsaw.answering") : t("jigsaw.confirmAnswer")}</button>{error && <p role="alert">{error}</p>}</FocusLayout>; }

function Result({ answer, question, onChooseAnother, onReplay, t }: { answer: Answer | null; question: State["question"]; onChooseAnother: () => void; onReplay: () => void; t: ReturnType<typeof useT> }) {
  const result = answer && "correct" in answer ? answer : null;
  const text = result ? result.correct ? t("jigsaw.correct") : t("jigsaw.incorrect") : t("jigsaw.answerRecorded");
  return <FocusLayout className="page-fill mx-auto max-w-2xl items-center justify-center gap-5 py-4 text-center">
    <h1 className="text-2xl font-extrabold text-vs-fg">{t("jigsaw.complete")}</h1>
    <p role="status" className="text-vs-fg-2">{text}</p>
    {result && !result.correct && question && <p>{t("jigsaw.correctWas", { answer: question.options[result.correctChoice] })}</p>}
    <button type="button" className="btn-primary min-h-12" onClick={onChooseAnother}>{t("jigsaw.another")}</button>
    <button type="button" className="btn-secondary min-h-12" onClick={onReplay}>{t("jigsaw.replay")}</button>
  </FocusLayout>;
}
