"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import Image from "next/image";
import { Maximize, Minus, Plus, RotateCw, Sparkles } from "lucide-react";
import FocusLayout from "@/components/versado/FocusLayout";
import { useT } from "@/components/I18nProvider";
import { createPuzzleGeometry, pieceKind, tracePuzzlePiece } from "@/lib/puzzle/geometry";
import { PUZZLE_DIFFICULTIES, type PuzzleDifficulty, type PuzzleFilter, type PuzzlePieceCount, type PuzzleSnapshot } from "@/lib/puzzle/types";
import type { JigsawAnswerResult } from "@/lib/jigsaw";

type State = {
  id: string; version: number; status: string; image: string; seed: string;
  geometryVersion: number; pieceCount: PuzzlePieceCount; difficulty: PuzzleDifficulty;
  snapshot: PuzzleSnapshot; question?: { text: string; options: string[] };
};
type Answer = JigsawAnswerResult | { alreadyAnswered: true };
type Point = { x: number; y: number };
type Drag = { pointer: number; groupId: string; offsetX: number; offsetY: number };
type Pan = { pointer: number; clientX: number; clientY: number; x: number; y: number };
type Pinch = { distance: number; center: Point; world: Point; scale: number };

const KEY = "versado:jigsaw-v2-session";
const difficulties: PuzzleDifficulty[] = ["DISCOVERER", "ADVENTURER", "EXPERT", "MASTER"];
const labels: Record<PuzzleDifficulty, string> = { DISCOVERER: "Ontdekker", ADVENTURER: "Avonturier", EXPERT: "Expert", MASTER: "Meester" };

async function request(body: object) {
  const response = await fetch("/api/jigsaw-v2", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data === "object" && data && "error" in data && typeof data.error === "string" ? data.error : "Dat lukte niet.");
  return data;
}
function remember(id: string | null) { try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* opslag kan geblokkeerd zijn */ } }
function distance(a: Point, b: Point) { return Math.hypot(a.x - b.x, a.y - b.y); }

export default function JigsawV2Client({ images }: { images: string[] }) {
  const t = useT();
  const [state, setState] = useState<State | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [pieceCount, setPieceCount] = useState<PuzzlePieceCount>(24);
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>("ADVENTURER");
  const [error, setError] = useState("");

  useEffect(() => {
    let gone = false;
    let id: string | null = null;
    try { id = localStorage.getItem(KEY); } catch { /* opslag kan geblokkeerd zijn */ }
    if (id) request({ action: "resume", sessionId: id }).then((value) => { if (!gone && value) setState(value as State); }).catch(() => remember(null));
    return () => { gone = true; };
  }, []);
  async function start() {
    setError("");
    try { const next = await request({ action: "start", imageIndex, pieceCount, difficulty }) as State; remember(next.id); setState(next); }
    catch (err) { setError(err instanceof Error ? err.message : "Dat lukte niet."); }
  }
  if (state) return <Puzzle initial={state} setOuterState={setState} onExit={() => { remember(null); setState(null); }} />;
  return <FocusLayout className="max-w-5xl gap-5"><header><h1 className="text-2xl font-extrabold text-vs-fg">{t("jigsaw.title")}</h1><p className="mt-2 text-vs-fg-2">{t("jigsaw.intro")}</p></header><section><h2 className="font-bold">{t("jigsaw.chooseImage")}</h2><div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">{images.slice(0, 20).map((src, index) => <button key={src} type="button" onClick={() => setImageIndex(index)} aria-pressed={imageIndex === index} className={`min-w-0 overflow-hidden rounded-xl border-2 ${imageIndex === index ? "border-vs-xp" : "border-vs-line"}`}><Image src={src} alt="" width={160} height={120} unoptimized className="aspect-[4/3] w-full object-cover" /><span className="block vs-wrap p-2 text-sm">{t("jigsaw.image", { n: index + 1 })}</span></button>)}</div></section><section><h2 className="font-bold">{t("jigsaw.pieces", { n: pieceCount })}</h2><div className="mt-3 flex flex-wrap gap-2">{[6, 12, 24, 48, 96].map((count) => <button className={`btn-secondary min-h-11 ${count === pieceCount ? "!border-vs-xp !bg-vs-xp/15" : ""}`} onClick={() => setPieceCount(count as PuzzlePieceCount)} key={count}>{count}</button>)}</div></section><section><h2 className="font-bold">Moeilijkheid</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{difficulties.map((level) => <button className={`btn-secondary min-h-11 ${difficulty === level ? "!border-vs-xp !bg-vs-xp/15" : ""}`} aria-pressed={difficulty === level} onClick={() => setDifficulty(level)} key={level}>{labels[level]}</button>)}</div></section><button type="button" className="btn-primary min-h-12 self-start" onClick={start}>{t("jigsaw.start")}</button>{error && <p role="alert">{error}</p>}</FocusLayout>;
}

function Puzzle({ initial, setOuterState, onExit }: { initial: State; setOuterState: (state: State | null) => void; onExit: () => void }) {
  const t = useT();
  const [state, localSet] = useState(initial);
  const saved = useRef(initial);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const world = useRef({ scale: 72, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<Drag | null>(null);
  const pan = useRef<Pan | null>(null);
  const pinch = useRef<Pinch | null>(null);
  const geometry = createPuzzleGeometry(state.pieceCount, state.seed, state.geometryVersion);
  const policy = PUZZLE_DIFFICULTIES[state.difficulty];

  function update(next: State) { saved.current = next; localSet(next); setOuterState(next); remember(next.id); }
  async function action(operation: object) {
    const current = saved.current;
    const next = await request({ action: "act", sessionId: current.id, version: current.version, actionId: crypto.randomUUID(), operation }) as State;
    update(next);
    return next;
  }
  function render() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(bounds.width * ratio)); canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio); ctx.fillStyle = "#f8f7f4"; ctx.fillRect(0, 0, bounds.width, bounds.height);
    ctx.save(); ctx.translate(world.current.x, world.current.y); ctx.scale(world.current.scale, world.current.scale);
    if (policy.showGhost && image.current) { ctx.globalAlpha = 0.2; ctx.drawImage(image.current, 0, 0, geometry.grid.columns, geometry.grid.rows); ctx.globalAlpha = 1; }
    if (policy.showOutline) { ctx.strokeStyle = "rgba(70, 82, 100, .38)"; ctx.lineWidth = 2 / world.current.scale; ctx.strokeRect(0, 0, geometry.grid.columns, geometry.grid.rows); }
    for (const group of state.snapshot.groups) for (const id of group.pieceIds) {
      const piece = geometry.pieces[id]; const first = geometry.pieces[group.pieceIds[0]];
      const x = group.x + piece.column - first.column; const y = group.y + piece.row - first.row;
      ctx.save(); ctx.translate(x + .5, y + .5); ctx.rotate(group.rotation * Math.PI / 180); ctx.translate(-.5, -.5); ctx.beginPath(); tracePuzzlePiece(ctx, piece); ctx.save(); ctx.clip();
      if (image.current) ctx.drawImage(image.current, -piece.column, -piece.row, geometry.grid.columns, geometry.grid.rows); else { ctx.fillStyle = "#d7e5ef"; ctx.fillRect(0, 0, 1, 1); }
      ctx.restore(); ctx.strokeStyle = selected === id ? "#db7415" : "rgba(29, 42, 60, .52)"; ctx.lineWidth = (selected === id ? 3 : 1) / world.current.scale; ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }
  function fit() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const padding = 1.3;
    world.current.scale = Math.max(38, Math.min(180, Math.min(canvas.clientWidth / (geometry.grid.columns + padding * 2), canvas.clientHeight / (geometry.grid.rows + padding * 2))));
    world.current.x = (canvas.clientWidth - geometry.grid.columns * world.current.scale) / 2;
    world.current.y = (canvas.clientHeight - geometry.grid.rows * world.current.scale) / 2;
    render();
  }
  function screenPoint(event: { clientX: number; clientY: number }, canvas = canvasRef.current) {
    const rect = canvas?.getBoundingClientRect();
    return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 0, y: 0 };
  }
  function worldPoint(point: Point) { return { x: (point.x - world.current.x) / world.current.scale, y: (point.y - world.current.y) / world.current.scale }; }
  function groupAt(point: Point) {
    for (const group of [...state.snapshot.groups].reverse()) for (const id of group.pieceIds) {
      const piece = geometry.pieces[id]; const first = geometry.pieces[group.pieceIds[0]];
      const x = group.x + piece.column - first.column; const y = group.y + piece.row - first.row;
      if (point.x >= x && point.x <= x + 1 && point.y >= y && point.y <= y + 1) return group;
    }
    return null;
  }
  function startPinch() {
    const entries = [...pointers.current.values()];
    if (entries.length < 2) return;
    const [one, two] = entries;
    const center = { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2 };
    drag.current = null; pan.current = null;
    pinch.current = { distance: Math.max(1, distance(one, two)), center, world: worldPoint(center), scale: world.current.scale };
  }
  function updatePinch() {
    const active = pinch.current; const entries = [...pointers.current.values()];
    if (!active || entries.length < 2) return;
    const [one, two] = entries; const center = { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2 };
    world.current.scale = Math.max(28, Math.min(240, active.scale * distance(one, two) / active.distance));
    world.current.x = center.x - active.world.x * world.current.scale;
    world.current.y = center.y - active.world.y * world.current.scale;
    render();
  }
  function transientMove(groupId: string, x: number, y: number) {
    const base = saved.current;
    localSet({ ...base, snapshot: { ...base.snapshot, groups: base.snapshot.groups.map((group) => group.id === groupId ? { ...group, x, y } : group) } });
  }
  async function trySnap(next: State) {
    for (const piece of geometry.pieces) for (const neighbour of geometry.pieces) {
      if (piece.id >= neighbour.id || Math.abs(piece.column - neighbour.column) + Math.abs(piece.row - neighbour.row) !== 1) continue;
      const a = next.snapshot.groups.find((group) => group.pieceIds.includes(piece.id)); const b = next.snapshot.groups.find((group) => group.pieceIds.includes(neighbour.id));
      if (a && b && a.id !== b.id) {
        const joined = await action({ kind: "connect", a: piece.id, b: neighbour.id });
        if (joined.version !== next.version) { setMessage("Stukken verbonden."); return; }
      }
    }
  }
  async function finishDrag(active: Drag, point: Point) {
    const moved = await action({ kind: "move", groupId: active.groupId, x: point.x - active.offsetX, y: point.y - active.offsetY });
    await trySnap(moved);
  }
  function boardDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = screenPoint(event); pointers.current.set(event.pointerId, point); event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size >= 2) { startPinch(); return; }
    const worldAtPointer = worldPoint(point); const group = groupAt(worldAtPointer);
    if (group) { const id = group.pieceIds[0]; setSelected(id); drag.current = { pointer: event.pointerId, groupId: group.id, offsetX: worldAtPointer.x - group.x, offsetY: worldAtPointer.y - group.y }; }
    else pan.current = { pointer: event.pointerId, clientX: point.x, clientY: point.y, x: world.current.x, y: world.current.y };
  }
  function boardMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = screenPoint(event); if (!pointers.current.has(event.pointerId)) return; pointers.current.set(event.pointerId, point);
    if (pointers.current.size >= 2) { updatePinch(); return; }
    const activeDrag = drag.current;
    if (activeDrag?.pointer === event.pointerId) { const destination = worldPoint(point); transientMove(activeDrag.groupId, destination.x - activeDrag.offsetX, destination.y - activeDrag.offsetY); return; }
    const activePan = pan.current;
    if (activePan?.pointer === event.pointerId) { world.current.x = activePan.x + point.x - activePan.clientX; world.current.y = activePan.y + point.y - activePan.clientY; render(); }
  }
  async function boardUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const point = screenPoint(event); const activeDrag = drag.current; pointers.current.delete(event.pointerId);
    if (pointers.current.size >= 2) { startPinch(); return; }
    if (pinch.current) { pinch.current = null; const remaining = [...pointers.current.entries()][0]; if (remaining) pan.current = { pointer: remaining[0], clientX: remaining[1].x, clientY: remaining[1].y, x: world.current.x, y: world.current.y }; return; }
    if (activeDrag?.pointer === event.pointerId) { drag.current = null; await finishDrag(activeDrag, worldPoint(point)); }
    if (pan.current?.pointer === event.pointerId) pan.current = null;
  }
  function boardCancel(event: ReactPointerEvent<HTMLCanvasElement>) { pointers.current.delete(event.pointerId); drag.current = null; pan.current = null; pinch.current = null; localSet(saved.current); }
  function zoom(factor: number, point?: Point) {
    const canvas = canvasRef.current; if (!canvas) return;
    const target = point ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }; const before = worldPoint(target);
    world.current.scale = Math.max(28, Math.min(240, world.current.scale * factor)); world.current.x = target.x - before.x * world.current.scale; world.current.y = target.y - before.y * world.current.scale; render();
  }
  useEffect(() => {
    const picture = new Image(); picture.onload = () => { image.current = picture; fit(); }; picture.src = state.image;
    const canvas = canvasRef.current; const observer = canvas ? new ResizeObserver(fit) : null; if (canvas) observer?.observe(canvas);
    return () => observer?.disconnect();
  // De afbeelding en grootte bepalen de eerste camera; spelacties mogen hem niet resetten.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // De renderer leest de actuele canvas-, camera- en geometrie-references.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { render(); }, [state, selected]);
  async function hint(hintType: "PREVIEW" | "LOCATION" | "CONNECTION" | "FILTER", filter?: PuzzleFilter | null) {
    try { await action({ kind: "hint", hint: hintType, ...(selected === null ? {} : { pieceId: selected }), ...(filter === undefined ? {} : { filter }) }); if (hintType === "PREVIEW") { setPreview(true); window.setTimeout(() => setPreview(false), 5000); } setMessage("Hint gebruikt."); }
    catch (err) { setMessage(err instanceof Error ? err.message : "Hint niet beschikbaar."); }
  }
  async function submit(choice: number) { const result = await request({ action: "answer", sessionId: saved.current.id, choice }) as Answer; setAnswer(result); remember(null); }
  function beginTrayDrag(event: ReactPointerEvent<HTMLButtonElement>, pieceId: number) {
    const group = saved.current.snapshot.groups.find((candidate) => candidate.pieceIds.includes(pieceId));
    if (!group) return;
    setSelected(pieceId); const button = event.currentTarget; button.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) => {
      const canvas = canvasRef.current; if (!canvas) return; const rect = canvas.getBoundingClientRect();
      if (moveEvent.clientX < rect.left || moveEvent.clientX > rect.right || moveEvent.clientY < rect.top || moveEvent.clientY > rect.bottom) return;
      const at = worldPoint({ x: moveEvent.clientX - rect.left, y: moveEvent.clientY - rect.top }); transientMove(group.id, at.x - .5, at.y - .5);
    };
    const end = async (endEvent: PointerEvent) => {
      button.removeEventListener("pointermove", move); button.removeEventListener("pointerup", end); button.removeEventListener("pointercancel", cancel);
      const canvas = canvasRef.current; const rect = canvas?.getBoundingClientRect();
      if (rect && endEvent.clientX >= rect.left && endEvent.clientX <= rect.right && endEvent.clientY >= rect.top && endEvent.clientY <= rect.bottom) {
        const at = worldPoint({ x: endEvent.clientX - rect.left, y: endEvent.clientY - rect.top }); const moved = await action({ kind: "move", groupId: group.id, x: at.x - .5, y: at.y - .5 }); await trySnap(moved);
      } else localSet(saved.current);
    };
    const cancel = () => { button.removeEventListener("pointermove", move); button.removeEventListener("pointerup", end); button.removeEventListener("pointercancel", cancel); localSet(saved.current); };
    button.addEventListener("pointermove", move); button.addEventListener("pointerup", end); button.addEventListener("pointercancel", cancel);
  }
  const connected = state.snapshot.connections.length + (state.snapshot.connections.length ? 1 : 0);
  const loosePieces = state.snapshot.groups.filter((group) => group.pieceIds.length === 1).flatMap((group) => group.pieceIds).filter((id) => !state.snapshot.filter || pieceKind(geometry.pieces[id]) === state.snapshot.filter);
  const backgroundSize = `${geometry.grid.columns * 100}% ${geometry.grid.rows * 100}%`;
  return <FocusLayout className="max-w-none gap-3 overflow-x-hidden"><header className="flex min-w-0 items-center justify-between gap-2"><button className="btn-secondary min-h-11 shrink-0" onClick={onExit}>{t("jigsaw.chooseAnother")}</button><div className="min-w-0 text-right"><h1 className="truncate text-base font-bold text-vs-fg">{t("jigsaw.title")}</h1><p className="text-sm text-vs-fg-2">{connected} / {state.pieceCount} verbonden</p></div><button className="btn-secondary min-h-11 shrink-0" onClick={() => hint("PREVIEW")} aria-label="Voorbeeld tonen" title="Voorbeeld tonen"><Sparkles size={18} /></button></header><section className="flex min-h-0 flex-1 flex-col gap-2"><div className="relative min-h-[48svh] flex-1 overflow-hidden rounded-2xl border border-vs-line bg-vs-surface shadow-sm lg:min-h-[min(66svh,48rem)]"><canvas ref={canvasRef} aria-label={t("jigsaw.board")} tabIndex={0} className="h-full min-h-[48svh] w-full touch-none outline-none focus-visible:ring-4 focus-visible:ring-vs-xp lg:min-h-[min(66svh,48rem)]" onPointerDown={boardDown} onPointerMove={boardMove} onPointerUp={boardUp} onPointerCancel={boardCancel} onWheel={(event) => { event.preventDefault(); zoom(event.deltaY > 0 ? .9 : 1.1, screenPoint(event)); }} onKeyDown={async (event) => { if (selected === null) return; const group = saved.current.snapshot.groups.find((item) => item.pieceIds.includes(selected)); if (!group) return; if (event.key === "r" || event.key === "R") { event.preventDefault(); await action({ kind: "rotate", groupId: group.id }); } }} /></div><div className="flex items-center justify-between gap-2 px-1"><div className="flex shrink-0 rounded-xl border border-vs-line bg-vs-surface p-1 shadow-sm"><button className="btn-secondary min-h-10 min-w-10 px-2" onClick={() => zoom(1.2)} aria-label="Inzoomen" title="Inzoomen"><Plus size={18} /></button><button className="btn-secondary min-h-10 min-w-10 px-2" onClick={() => zoom(1 / 1.2)} aria-label="Uitzoomen" title="Uitzoomen"><Minus size={18} /></button><button className="btn-secondary min-h-10 min-w-10 px-2" onClick={fit} aria-label="Puzzel passend tonen" title="Puzzel passend tonen"><Maximize size={18} /></button></div><div className="flex min-w-0 gap-1 overflow-x-auto py-1"><button className={`btn-secondary min-h-10 shrink-0 px-3 text-sm ${!state.snapshot.filter ? "!border-vs-xp !bg-vs-xp/15" : ""}`} onClick={() => hint("FILTER", null)}>Alles</button><button className={`btn-secondary min-h-10 shrink-0 px-3 text-sm ${state.snapshot.filter === "EDGES" ? "!border-vs-xp !bg-vs-xp/15" : ""}`} onClick={() => hint("FILTER", "EDGES")}>Rand</button><button className={`btn-secondary min-h-10 shrink-0 px-3 text-sm ${state.snapshot.filter === "CORNERS" ? "!border-vs-xp !bg-vs-xp/15" : ""}`} onClick={() => hint("FILTER", "CORNERS")}>Hoeken</button>{state.difficulty === "MASTER" && <button className="btn-secondary min-h-10 min-w-10 shrink-0 px-2" disabled={selected === null} onClick={async () => { const group = selected === null ? null : saved.current.snapshot.groups.find((item) => item.pieceIds.includes(selected)); if (group) await action({ kind: "rotate", groupId: group.id }); }} aria-label="Geselecteerd stuk draaien" title="Draaien"><RotateCw size={18} /></button>}</div></div><section aria-label="Stukjesbak" className="rounded-2xl border border-vs-line bg-vs-surface p-2 shadow-sm"><div className="mb-2 flex items-center justify-between gap-2 px-1"><h2 className="font-bold text-vs-fg">Stukjesbak</h2><span className="text-sm text-vs-fg-2">Sleep een stuk naar het veld</span></div><div className="flex min-h-24 gap-3 overflow-x-auto overscroll-x-contain pb-1" style={{ touchAction: "pan-x" }}>{loosePieces.map((id) => { const piece = geometry.pieces[id]; return <button key={id} type="button" className={`relative h-20 w-24 shrink-0 overflow-hidden rounded-2xl border-2 shadow-sm transition-transform active:scale-95 ${selected === id ? "border-vs-xp ring-2 ring-vs-xp/25" : "border-vs-line"}`} style={{ backgroundImage: `url(${state.image})`, backgroundPosition: `${piece.column / Math.max(1, geometry.grid.columns - 1) * 100}% ${piece.row / Math.max(1, geometry.grid.rows - 1) * 100}%`, backgroundSize }} onPointerDown={(event) => beginTrayDrag(event, id)} onClick={() => setSelected(id)} aria-label={`Puzzelstuk ${id + 1} pakken en slepen`}><span className="sr-only">Puzzelstuk {id + 1}</span></button>; })}{loosePieces.length === 0 && <p className="px-2 py-6 text-sm text-vs-fg-2">Alle losse stukken zijn verbonden.</p>}</div></section></section><div className="flex flex-wrap gap-2"><button className="btn-secondary min-h-11" onClick={() => hint("LOCATION")} disabled={selected === null}>Locatie</button><button className="btn-secondary min-h-11" onClick={() => hint("CONNECTION")} disabled={selected === null}>Verbinding</button></div><p aria-live="polite" className="min-h-6 text-sm text-vs-fg-2">{message}</p>{preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"><Image src={state.image} alt="Voorbeeld van de volledige puzzel" width={1200} height={800} unoptimized className="max-h-full max-w-full rounded-2xl" /></div>}{state.status === "COMPLETED" && state.question && <section className="card mx-auto max-w-2xl"><h2 className="text-xl font-bold">{t("jigsaw.questionIntro")}</h2><p className="mt-3 font-semibold">{state.question.text}</p><div className="mt-3 grid gap-2">{state.question.options.map((option, index) => <button className="btn-secondary min-h-12 text-left" disabled={!!answer} onClick={() => submit(index)} key={option}>{option}</button>)}</div>{answer && <p className="mt-3 font-semibold">{"alreadyAnswered" in answer ? t("jigsaw.alreadyAnswered") : answer.correct ? t("jigsaw.correct") : t("jigsaw.incorrect")}</p>}</section>}</FocusLayout>;
}
