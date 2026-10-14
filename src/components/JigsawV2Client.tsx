"use client";

import Link from "next/link";
import { formatPuzzleTime } from "@/lib/puzzle/recordFormat";
import RecordNotice from "@/components/puzzle/RecordNotice";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useHintInventory } from "@/lib/data/hints";
import { liveMutation } from "@/lib/data/mutation";
import NextImage from "next/image";
import { Ellipsis, RotateCw, Lightbulb } from "lucide-react";
import PuzzleHintPanel from "@/components/PuzzleHintPanel";
import FriendPicker from "@/components/FriendPicker";
import { useTick } from "@/components/puzzle/serverClock";
import { JIGSAW_ROUTE, previousPuzzleStage } from "@/lib/puzzle/navigation";
import PuzzleTogetherOverview from "@/components/puzzle/PuzzleTogetherOverview";
import FocusLayout from "@/components/versado/FocusLayout";
import { useT } from "@/components/I18nProvider";
import { createPuzzleGeometry } from "@/lib/puzzle/geometry";
import { renderPuzzle } from "@/lib/puzzle/render";
import { boardSnapTarget, connectedPieces, findSnapConnection, groupFor, worldOf } from "@/lib/puzzle/engine";
import { clampGroupPosition, groupMemberAt, puzzleRenderOrder, puzzleWorktable } from "@/lib/puzzle/worktable";
import { constrainCamera as constrainViewport, fitCamera, initialPuzzleCamera, resizeCamera, screenToWorld, zoomCamera, type PuzzleCamera, type ViewportSize } from "@/lib/puzzle/viewport";
import { puzzlePolicy, type PuzzleFilter, type PuzzleHintType, type PuzzleHint, type PuzzleDifficulty, type PuzzlePieceCount, type PuzzleSnapshot } from "@/lib/puzzle/types";
import { activePuzzleHint, puzzleHintTarget } from "@/lib/puzzle/hints";
import { filterPuzzleCatalog, puzzleCatalogPage } from "@/lib/puzzle/catalog";
import type { JigsawAnswerResult } from "@/lib/jigsaw";
import type { SoloRecordInfo } from "@/lib/puzzle/solo";
import { useSetBackTarget } from "@/lib/backTarget";

type State = { hintBalance: number; id: string; version: number; status: string; image: string; seed: string; geometryVersion: number; pieceCount: PuzzlePieceCount; difficulty: PuzzleDifficulty; rulesVersion: number; snapshot: PuzzleSnapshot; question?: { text: string; options: string[] }; answer?: Answer };
type Answer = (JigsawAnswerResult & { record?: SoloRecordInfo }) | { alreadyAnswered: true };
type Point = { x: number; y: number };
type Drag = { pointer: number; groupId: string; offset: Point };
type Pan = { pointer: number; point: Point; camera: PuzzleCamera };
type Pinch = { distance: number; world: Point; scale: number };
type Stage = "BOARD" | "COMPLETE" | "QUESTION" | "RESULT";

type Mode = "SOLO" | "COOP" | "MATCH";
type Chosen = { id: string; handle: string };
const COUNTS: Record<Mode, number[]> = { SOLO: [6, 12, 24, 48, 96], COOP: [24, 48, 96, 150, 300], MATCH: [6, 12, 24, 48, 96] };
const KEY = "versado:jigsaw-v2-session";
const PAGE_SIZE = 24;
const difficulties: PuzzleDifficulty[] = ["DISCOVERER", "ADVENTURER", "EXPERT", "MASTER"];
const levelDescriptions = { DISCOVERER: "jigsaw.discovererDescription", ADVENTURER: "jigsaw.adventurerDescription", EXPERT: "jigsaw.expertDescription", MASTER: "jigsaw.masterDescription" } as const;
const levelKeys = { DISCOVERER: "jigsaw.discoverer", ADVENTURER: "jigsaw.adventurer", EXPERT: "jigsaw.expert", MASTER: "jigsaw.master" } as const;

class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function request(body: object, url = "/api/jigsaw-v2") {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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

export default function JigsawV2Client({ images, allowStarts = true }: { images: Array<{ url: string; story: number }>; allowStarts?: boolean }) {
  const t = useT(); const router = useRouter();
  const [mode, setMode] = useState<Mode>("SOLO"); const [chosen, setChosen] = useState<Chosen[]>([]); const [pickerOpen, setPickerOpen] = useState(false); const [matchKind, setMatchKind] = useState<"LIVE" | "ASYNC">("ASYNC");
  const [state, setState] = useState<State | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [pieceCount, setPieceCount] = useState<PuzzlePieceCount>(24);
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>("ADVENTURER");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const starting = useRef(false); const [isStarting, setIsStarting] = useState(false);
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

  async function startTogether() {
    if (!allowStarts || starting.current || !selectedImage || chosen.length === 0) return;
    starting.current = true; setIsStarting(true); setError("");
    try {
      const friendIds = chosen.map((friend) => friend.id);
      const response = await fetch(mode === "COOP" ? "/api/puzzle/coop" : "/api/puzzle/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(mode === "COOP" ? { action: "create", imageId: selectedImage.src, pieceCount, difficulty, friendIds } : { action: "create", imageId: selectedImage.src, pieceCount, difficulty, friendIds, kind: matchKind }) });
      const data = await response.json().catch(() => null) as { sessionId?: string; matchId?: string; error?: string } | null;
      if (!response.ok || !data) throw new Error(data?.error ?? "");
      router.push(mode === "COOP" ? `/jigsaw/samen/${data.sessionId}` : `/jigsaw/wedstrijd/${data.matchId}`);
    } catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("jigsaw.failed")); starting.current = false; setIsStarting(false); }
  }

  async function start(previous?: State) {
    if (!allowStarts || starting.current || (!previous && !selectedImage)) return;
    starting.current = true; setIsStarting(true); setLoading(true); setError("");
    try { const next = await request({ action: "start", imageId: previous?.image ?? selectedImage!.src, pieceCount: previous?.pieceCount ?? pieceCount, difficulty: previous?.difficulty ?? difficulty }) as State; remember(next.id); setState(next); }
    catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("jigsaw.failed")); }
    finally { starting.current = false; setIsStarting(false); setLoading(false); }
  }

  if (state) return <Puzzle key={state.id} initial={state} setOuter={(next) => setState((current) => current?.id === next.id ? next : current)} onReplay={() => { const previous = state; setState(null); void start(previous); }} onChooseAnother={chooseAnother} />;
  if (loading && !isStarting) return <FocusLayout><p role="status">{t("common.loading")}</p></FocusLayout>;
  if (!allowStarts) return <FocusLayout><p role="status">{t("gameAvailability.unavailable")}</p><PuzzleTogetherOverview /></FocusLayout>;
  return <FocusLayout className="max-w-5xl gap-5">
    <header><h1 className="text-2xl font-extrabold text-vs-fg">{t("jigsaw.title")}</h1><p className="mt-2 text-vs-fg-2">{t("jigsaw.intro")}</p></header>
    <Link href="/jigsaw/records" className="btn-secondary min-h-12 self-start" data-kompas-target="puzzle-records">{t("puzzleRecords.hubLink")}</Link>
    <PuzzleTogetherOverview />
    <section aria-labelledby="jigsaw-mode"><h2 id="jigsaw-mode" className="font-bold">{t("puzzleTogether.modes.title")}</h2><div className="mt-3 grid gap-2 sm:grid-cols-3" role="group" aria-labelledby="jigsaw-mode">{(["SOLO", "COOP", "MATCH"] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} onClick={() => { setMode(value); if (!COUNTS[value].includes(pieceCount)) setPieceCount(24); }} className={`btn-secondary min-h-11 flex-col items-start text-left ${mode === value ? "!border-vs-xp !bg-vs-xp/15" : ""}`}><span className="block font-semibold">{t(value === "SOLO" ? "puzzleTogether.modes.solo" : value === "COOP" ? "puzzleTogether.modes.coop" : "puzzleTogether.modes.match")}</span><span className="mt-1 block text-sm font-normal normal-case tracking-normal">{t(value === "SOLO" ? "puzzleTogether.modes.soloHelp" : value === "COOP" ? "puzzleTogether.modes.coopHelp" : "puzzleTogether.modes.matchHelp")}</span></button>)}</div></section>
    <section aria-labelledby="jigsaw-image-choice"><div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="jigsaw-image-choice" className="font-bold">{t("jigsaw.chooseImage")}</h2><p className="text-sm text-vs-fg-2">{t("jigsaw.catalogCount", { n: images.length })}</p></div><label className="min-w-[min(100%,16rem)] text-sm font-semibold">{t("jigsaw.searchImages")}<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} className="input mt-1 w-full" /></label></div>
      {visible.length ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">{visible.map(({ src, label, category }) => <button key={src} type="button" onClick={() => setImageId(src)} aria-pressed={imageId === src} className={`min-w-0 overflow-hidden rounded-xl border-2 text-left ${imageId === src ? "border-vs-xp" : "border-vs-line"}`}><NextImage src={src} alt="" width={240} height={180} unoptimized loading="lazy" className="aspect-[4/3] w-full object-cover" /><span className="block vs-wrap px-2 pt-2 text-sm font-semibold">{label}</span><span className="block vs-wrap px-2 pb-2 text-xs text-vs-fg-2">{category}</span></button>)}</div> : <p className="mt-3 text-vs-fg-2">{t("jigsaw.noImages")}</p>}
      {pages > 1 && <nav className="mt-3 flex flex-wrap items-center justify-between gap-2" aria-label={t("jigsaw.imagePages")}><button type="button" className="btn-secondary min-h-11" disabled={activePage === 0} onClick={() => setPage(activePage - 1)}>{t("jigsaw.previous")}</button><span className="text-sm font-semibold">{t("jigsaw.page", { n: activePage + 1, total: pages })}</span><button type="button" className="btn-secondary min-h-11" disabled={activePage + 1 >= pages} onClick={() => setPage(activePage + 1)}>{t("jigsaw.next")}</button></nav>}
    </section>
    <section><h2 className="font-bold">{t("jigsaw.pieces", { n: pieceCount })}</h2><p className="mt-1 text-sm text-vs-fg-2">{mode === "COOP" ? t("puzzleTogether.setup.pieceHelpCoop") : mode === "MATCH" ? t("puzzleTogether.setup.pieceHelpMatch") : t("jigsaw.pieceCountHelp")}</p><div className="mt-3 flex flex-wrap gap-2">{COUNTS[mode].map((count) => <button type="button" className={`btn-secondary min-h-11 ${count === pieceCount ? "!border-vs-xp !bg-vs-xp/15" : ""}`} onClick={() => setPieceCount(count as PuzzlePieceCount)} key={count}>{count}</button>)}</div></section>
    <section><h2 className="font-bold">{t("jigsaw.difficulty")}</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{difficulties.map((level) => <button type="button" className={`btn-secondary min-h-11 flex-col items-start text-left ${difficulty === level ? "!border-vs-xp !bg-vs-xp/15" : ""}`} aria-label={t(levelKeys[level])} aria-describedby={`difficulty-${level}`} aria-pressed={difficulty === level} onClick={() => setDifficulty(level)} key={level}><span className="block font-semibold">{t(levelKeys[level])}</span><span id={`difficulty-${level}`} className="mt-1 block text-sm font-normal normal-case tracking-normal">{t(levelDescriptions[level])}</span></button>)}</div></section>
    {mode === "MATCH" && <section><h2 className="font-bold">{t("puzzleTogether.setup.kind")}</h2><div className="mt-3 grid gap-2 sm:grid-cols-2" role="group">{(["LIVE", "ASYNC"] as const).map((kind) => <button type="button" key={kind} aria-pressed={matchKind === kind} onClick={() => setMatchKind(kind)} className={`btn-secondary min-h-11 flex-col items-start text-left ${matchKind === kind ? "!border-vs-xp !bg-vs-xp/15" : ""}`}><span className="block font-semibold">{t(kind === "LIVE" ? "puzzleTogether.setup.live" : "puzzleTogether.setup.async")}</span><span className="mt-1 block text-sm font-normal normal-case tracking-normal">{t(kind === "LIVE" ? "puzzleTogether.setup.liveHelp" : "puzzleTogether.setup.asyncHelp")}</span></button>)}</div></section>}
    {mode !== "SOLO" && <section><h2 className="font-bold">{t("puzzleTogether.setup.friends")}</h2><p className="mt-1 text-sm text-vs-fg-2">{t(mode === "COOP" ? "puzzleTogether.setup.friendsCoop" : "puzzleTogether.setup.friendsMatch")}</p><div className="mt-3 flex flex-wrap items-center gap-2">{chosen.map((friend) => <button type="button" key={friend.id} className="btn-secondary min-h-11" aria-label={t("puzzleTogether.setup.remove", { name: friend.handle })} onClick={() => setChosen(chosen.filter((item) => item.id !== friend.id))}>{friend.handle} ✕</button>)}{chosen.length < 3 && <button type="button" className="btn-secondary min-h-11" onClick={() => setPickerOpen(true)}>{t("puzzleTogether.setup.pick")}</button>}</div>{chosen.length === 0 && <p className="mt-2 text-sm text-vs-fg-2">{t("puzzleTogether.setup.none")}</p>}</section>}
    <p role="status">{selectedImage ? selectedImage.label : t("jigsaw.chooseImage")}</p>
    {mode === "SOLO" ? <button type="button" className="btn-primary min-h-12 w-full max-w-[440px] self-center" disabled={!selectedImage || loading} onClick={() => void start()}>{loading ? t("common.loading") : t("jigsaw.start")}</button> : <button type="button" className="btn-primary min-h-12 w-full max-w-[440px] self-center" disabled={!selectedImage || chosen.length === 0 || isStarting} onClick={() => void startTogether()}>{isStarting ? t("common.loading") : t(mode === "COOP" ? "puzzleTogether.setup.startCoop" : "puzzleTogether.setup.startMatch")}</button>}{error && <p role="alert">{error}</p>}
    <FriendPicker open={pickerOpen} onClose={() => setPickerOpen(false)} title={t("puzzleTogether.setup.pickerTitle")} subtitle={t("puzzleTogether.setup.pickerSubtitle")} onInvite={(friend) => setChosen((current) => current.some((item) => item.id === friend.id) || current.length >= 3 ? current : [...current, { id: friend.id, handle: friend.handle }])} stateFor={(id) => chosen.some((friend) => friend.id === id) ? "joined" : "invite"} inviteLabel={t("friendPicker.pick")} joinedLabel={t("puzzleTogether.setup.chosen")} />
  </FocusLayout>;
}

/** Context van een officiële wedstrijdpoging: dezelfde werktafel, maar acties lopen via de wedstrijd-API en de klok is de serverklok. */
export type MatchContext = {
  id: string; startedAt: number; serverOffsetMs: number;
  /** Na het antwoord: terug naar het wedstrijdscherm met het vraagresultaat. */
  onAnswered: (result: { correct: boolean; correctChoice: number | null; counted: boolean }) => void;
  /** Stap waarmee de poging opent als de puzzel al voltooid is (bij herladen of terugkeren). */
  initialStage?: "COMPLETE" | "QUESTION";
  /** De voltooiingsstap of vraag is getoond (voor herstel na refresh). */
  onStage?: (stage: "COMPLETE" | "QUESTION") => void;
  /** "Later beantwoorden": terug naar het overzicht van de wedstrijd zonder antwoord. */
  onLater: () => void;
};
export function Puzzle({ initial, setOuter, onChooseAnother, onReplay, match }: { initial: State; setOuter: (state: State) => void; onChooseAnother: () => void; onReplay: () => void; match?: MatchContext }) {
  const t = useT(); const router = useRouter(); const inventory = useHintInventory(initial.hintBalance); const [state, setState] = useState(initial); const [stage, setStage] = useState<Stage>(() => { if (initial.status === "ANSWERED") return "RESULT"; if (initial.status !== "COMPLETED") return "BOARD"; if (match) return match.initialStage ?? "COMPLETE"; try { if (localStorage.getItem(`${KEY}:question`) === initial.id) return "QUESTION"; } catch {} return "COMPLETE"; });
  const shown = useRef(initial); const saved = useRef(initial); const [selected, setSelected] = useState<number | null>(null); const [message, setMessage] = useState(""); const [answer, setAnswer] = useState<Answer | null>(initial.answer ?? null); const [menuOpen, setMenuOpen] = useState(false); const [hintsOpen, setHintsOpen] = useState(false);
  const [hint, setHint] = useState<PuzzleHint | null>(() => activePuzzleHint(initial.snapshot)); const hintRef = useRef(hint); const selectedRef = useRef(selected); const menuButton = useRef<HTMLButtonElement>(null);
  const pending = useRef(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null); const image = useRef<HTMLImageElement | null>(null); const camera = useRef<PuzzleCamera>({ scale: 60, x: 0, y: 0 }); const frame = useRef<number | null>(null);
  const mounted = useRef(true); const stopAnimation = useRef<(() => void) | null>(null);
  const viewport = useRef<ViewportSize | null>(null); const paths = useRef(new Map<string, Path2D>());
  const pointers = useRef(new Map<number, Point>()); const drag = useRef<Drag | null>(null); const pan = useRef<Pan | null>(null); const pinch = useRef<Pinch | null>(null);
  const geometry = useMemo(() => createPuzzleGeometry(initial.pieceCount, initial.seed, initial.geometryVersion), [initial.pieceCount, initial.seed, initial.geometryVersion]); const table = useMemo(() => puzzleWorktable(geometry), [geometry]); const policy = puzzlePolicy(state.difficulty, state.rulesVersion);

  // Eén plek die bepaalt waar een verzoek heen gaat; Solo blijft ongewijzigd.
  const call = (body: Record<string, unknown>) => match ? request({ ...body, matchId: match.id, sessionId: undefined }, "/api/puzzle/match") : request(body);
  // Alleen een wedstrijd heeft een klok; Solo tikt niet mee.
  const tick = useTick(!!match, 500);
  const clock = match && tick ? Math.max(0, tick + match.serverOffsetMs - match.startedAt) : 0;

  // Eén bestemming per stap (lib/puzzle/navigation.ts): de vraag gaat terug naar de voltooide afbeelding,
  // alle andere stappen naar de puzzelkeuze (Solo) of het puzzeloverzicht (wedstrijd). Nooit browsergeschiedenis.
  const pathname = usePathname();
  const back = useCallback(() => {
    if (previousPuzzleStage(stage) === "COMPLETE") { try { localStorage.removeItem(`${KEY}:question`); } catch {} match?.onStage?.("COMPLETE"); setStage("COMPLETE"); }
    else onChooseAnother();
  }, [stage, onChooseAnother, match]);
  useSetBackTarget(pathname, JIGSAW_ROUTE, "", back);

  function schedulePaint() { if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; paint(); }); }
  function constrainCamera() { const canvas = canvasRef.current; if (canvas) camera.current = constrainViewport(camera.current, { width: canvas.clientWidth, height: canvas.clientHeight }, table.bounds); }
  function paint() {
    const canvas = canvasRef.current; if (!canvas) return;
    const snapshot = shown.current.snapshot; const draggedGroupId = drag.current?.groupId ?? null;
    renderPuzzle(canvas, {
      geometry, table, camera: camera.current, image: image.current, paths: paths.current, snapshot, groups: puzzleRenderOrder(snapshot.groups, draggedGroupId),
      place: (group, out) => { out.lifted = group.id === draggedGroupId; },
      selectedPiece: selectedRef.current, hint: hintRef.current?.target,
      backdrop: state.rulesVersion === 1 || policy.showOutline || policy.showGhost, ghost: policy.showGhost, outline: policy.showOutline,
      edges: true, anchoredStroke: "rgba(43, 103, 99, .70)",
    });
  }
  function update(next: State) { inventory.setData({ hintBalance: next.hintBalance }); saved.current = next; if (!mounted.current) return; shown.current = next; setState(next); setOuter(next); if (!match) remember(next.id); if (next.status === "COMPLETED") setStage("COMPLETE"); if (next.status === "ANSWERED") setStage("RESULT"); schedulePaint(); }
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
  async function action(operation: object, movedGroupId?: string) {
    const current = saved.current; const body = { action: "act", sessionId: current.id, version: current.version, actionId: crypto.randomUUID(), operation };
    if ("kind" in operation && operation.kind === "hint") {
      // Toon het serverantwoord vóór invalidatie. Een snellere voorraad-refetch
      // mag niet daarna worden overschreven door een oudere actie-response.
      return await liveMutation(() => call(body) as Promise<State>, { invalidates: "hintsChanged", onSuccess: update });
    }
    const next = await call(body) as State;
    if (movedGroupId) await animateSnap(current, next, movedGroupId);
    update(next); return next;
  }
  async function runBoard(work: () => Promise<void>) {
    if (!mounted.current || pending.current || saved.current.status !== "ACTIVE") return;
    pending.current = true; setBusy(true); setError("");
    try { await work(); }
    catch (cause) {
      if (!mounted.current) return;
      setError(cause instanceof Error && cause.message ? cause.message : t("jigsaw.failed"));
      // Ook na een verloren completion-response de autoritatieve fase herstellen.
      try { update(await call({ action: "resume", sessionId: saved.current.id }) as State); }
      catch { shown.current = saved.current; setState(saved.current); schedulePaint(); }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  function fit() { const canvas = canvasRef.current; if (!canvas) return; camera.current = fitCamera({ width: canvas.clientWidth, height: canvas.clientHeight }, table.bounds); schedulePaint(); }
  function screenPoint(event: { clientX: number; clientY: number }) { const rect = canvasRef.current?.getBoundingClientRect(); return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 0, y: 0 }; }
  function worldPoint(point: Point) { return screenToWorld(camera.current, point); }
  function picked(point: Point) { for (const group of [...shown.current.snapshot.groups].reverse()) { const id = groupMemberAt(geometry, group, point); if (id !== null) return { group, id }; } return null; }
  function transientMove(groupId: string, x: number, y: number) { const base = saved.current; const group = base.snapshot.groups.find((candidate) => candidate.id === groupId); if (!group || group.anchored) return; const position = clampGroupPosition(geometry, group, x, y); const next = { ...base, snapshot: { ...base.snapshot, groups: base.snapshot.groups.map((candidate) => candidate.id === groupId ? { ...candidate, ...position } : candidate) } }; shown.current = next; setState(next); schedulePaint(); }
  function beginPinch() { const fingers = [...pointers.current.values()]; if (fingers.length < 2) return; if (drag.current) { drag.current = null; shown.current = saved.current; setState(saved.current); } pan.current = null; const center = { x: (fingers[0].x + fingers[1].x) / 2, y: (fingers[0].y + fingers[1].y) / 2 }; pinch.current = { distance: Math.max(1, distance(fingers[0], fingers[1])), world: worldPoint(center), scale: camera.current.scale }; schedulePaint(); }
  function updatePinch() { const active = pinch.current; const fingers = [...pointers.current.values()]; if (!active || fingers.length < 2) return; const center = { x: (fingers[0].x + fingers[1].x) / 2, y: (fingers[0].y + fingers[1].y) / 2 }; camera.current.scale = Math.max(8, Math.min(240, active.scale * distance(fingers[0], fingers[1]) / active.distance)); camera.current.x = center.x - active.world.x * camera.current.scale; camera.current.y = center.y - active.world.y * camera.current.scale; constrainCamera(); schedulePaint(); }
  async function snapAfterMove(next: State, groupId: string) {
    let current = next; const piece = next.snapshot.groups.find((group) => group.id === groupId)?.pieceIds[0];
    if (piece === undefined) return;
    for (let count = 0; count < state.pieceCount && mounted.current; count++) {
      const moved = groupFor(current.snapshot, piece); if (!moved || current.status !== "ACTIVE") break;
      const connection = findSnapConnection(current.snapshot, geometry, current.difficulty, moved.id, current.rulesVersion); if (!connection) break;
      // Na de eerste snap staat het nieuwe geheel vast: volgende buren worden
      // naar dit anker getrokken, niet andersom.
      const a = count === 0 ? connection.a : connection.b;
      const b = count === 0 ? connection.b : connection.a;
      const joined = await action({ kind: "connect", a, b }, groupFor(current.snapshot, b)?.id);
      if (joined.version === current.version) break;
      current = joined; if (mounted.current) setMessage(t("jigsaw.piecesConnected"));
    }
    const moved = groupFor(current.snapshot, piece);
    if (current.status === "ACTIVE" && moved && boardSnapTarget(current.snapshot, geometry, current.difficulty, moved.id, current.rulesVersion)) await action({ kind: "anchor", groupId: moved.id }, moved.id);
  }
  async function finishDrag(active: Drag, point: Point) { const next = await action({ kind: "move", groupId: active.groupId, x: point.x - active.offset.x, y: point.y - active.offset.y }); await snapAfterMove(next, active.groupId); }
  function boardDown(event: ReactPointerEvent<HTMLCanvasElement>) { if (pending.current) return; setMenuOpen(false); setHintsOpen(false); const point = screenPoint(event); pointers.current.set(event.pointerId, point); event.currentTarget.setPointerCapture(event.pointerId); if (pointers.current.size >= 2) { beginPinch(); return; } const hit = picked(worldPoint(point)); if (hit) { setSelected(hit.id); if (hit.group.anchored) { schedulePaint(); return; } drag.current = { pointer: event.pointerId, groupId: hit.group.id, offset: { x: worldPoint(point).x - hit.group.x, y: worldPoint(point).y - hit.group.y } }; } else { setSelected(null); pan.current = { pointer: event.pointerId, point, camera: { ...camera.current } }; } schedulePaint(); }
  function boardMove(event: ReactPointerEvent<HTMLCanvasElement>) { if (!pointers.current.has(event.pointerId)) return; const point = screenPoint(event); pointers.current.set(event.pointerId, point); if (pointers.current.size >= 2) { updatePinch(); return; } if (drag.current?.pointer === event.pointerId) { const world = worldPoint(point); transientMove(drag.current.groupId, world.x - drag.current.offset.x, world.y - drag.current.offset.y); } else if (pan.current?.pointer === event.pointerId) { camera.current.x = pan.current.camera.x + point.x - pan.current.point.x; camera.current.y = pan.current.camera.y + point.y - pan.current.point.y; constrainCamera(); schedulePaint(); } }
  async function boardUp(event: ReactPointerEvent<HTMLCanvasElement>) { const point = screenPoint(event); const activeDrag = drag.current; pointers.current.delete(event.pointerId); if (pointers.current.size >= 2) { beginPinch(); return; } if (pinch.current) { pinch.current = null; const remaining = [...pointers.current.entries()][0]; if (remaining) pan.current = { pointer: remaining[0], point: remaining[1], camera: { ...camera.current } }; return; } if (activeDrag?.pointer === event.pointerId) { drag.current = null; schedulePaint(); await runBoard(() => finishDrag(activeDrag, worldPoint(point))); } if (pan.current?.pointer === event.pointerId) pan.current = null; }
  function boardCancel(event: ReactPointerEvent<HTMLCanvasElement>) { pointers.current.delete(event.pointerId); drag.current = null; pan.current = null; pinch.current = null; shown.current = saved.current; setState(saved.current); schedulePaint(); }
  function zoom(factor: number, around?: Point) { const canvas = canvasRef.current; if (!canvas) return; const center = around ?? { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }; camera.current = zoomCamera(camera.current, { width: canvas.clientWidth, height: canvas.clientHeight }, table.bounds, factor, center); schedulePaint(); }
  async function rotateSelected() { if (selected === null || state.difficulty !== "MASTER") return; await runBoard(async () => { const group = groupFor(saved.current.snapshot, selected); if (group && !group.anchored) await action({ kind: "rotate", groupId: group.id }); }); }
  async function moveSelectedBy(dx: number, dy: number) { if (selected === null) return; await runBoard(async () => { const group = groupFor(saved.current.snapshot, selected); if (group && !group.anchored) { const next = await action({ kind: "move", groupId: group.id, x: group.x + dx, y: group.y + dy }); await snapAfterMove(next, group.id); } }); }
  async function submit(choice: number) { if (match) { const outcome = await call({ action: "answer", choice }) as { correct: boolean; correctChoice: number | null; counted: boolean }; if (mounted.current) match.onAnswered(outcome); return; } // Een nieuw persoonlijk record verandert de recordoverzichten en ranglijsten: ongeldig maken via de live-datalaag.
    const result = await liveMutation(() => request({ action: "answer", sessionId: saved.current.id, choice }) as Promise<Answer>, { invalidates: "gamesChanged" }); if (!mounted.current) return; setAnswer(result); const next = { ...saved.current, status: "ANSWERED", answer: result }; saved.current = next; setState(next); setOuter(next); remember(null); setStage("RESULT"); }
  function continueToQuestion() { if (match) match.onStage?.("QUESTION"); else { try { localStorage.setItem(`${KEY}:question`, state.id); } catch {} } setStage("QUESTION"); }

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
  useEffect(() => {
    const active = activePuzzleHint(state.snapshot);
    hintRef.current = active;
    queueMicrotask(() => { if (mounted.current) setHint(active); });
    schedulePaint();
    if (!active?.expiresAt) return;
    const timeout = setTimeout(() => { hintRef.current = null; setHint(null); schedulePaint(); }, Math.max(0, Date.parse(active.expiresAt) - Date.now()));
    return () => clearTimeout(timeout);
    // De marker leest actuele refs; de absolute eindtijd wordt nooit verlengd.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.snapshot.hints]);
  async function requestHint(type: PuzzleHintType, filter?: Exclude<PuzzleFilter, null>, confirmPersonal = false) {
    await runBoard(async () => {
      const next = await action({ kind: "hint", hint: type, confirmPersonal, ...(selected !== null ? { pieceId: selected } : {}), ...(filter ? { filter } : {}) });
      const active = activePuzzleHint(next.snapshot);
      if (active) {
        hintRef.current = active; setHint(active); setHintsOpen(false);
        // Behoud zoom en zichtbare markeringen. Alleen naar een onzichtbaar
        // hintdoel pannen; fit blijft een bewuste menuactie van de gebruiker.
        const target = active.target; const canvas = canvasRef.current;
        if (canvas && target && (target.type === "LOCATION" || target.type === "CONNECTION")) {
          const point = target.type === "LOCATION" ? { x: target.x + .5, y: target.y + .5 } : (() => { const group = groupFor(next.snapshot, target.neighborId)!; const point = worldOf(geometry, group, target.neighborId); return { x: point.x + .5, y: point.y + .5 }; })();
          const margin = 32; const screen = { x: camera.current.x + point.x * camera.current.scale, y: camera.current.y + point.y * camera.current.scale };
          camera.current.x += Math.max(margin, Math.min(canvas.clientWidth - margin, screen.x)) - screen.x;
          camera.current.y += Math.max(margin, Math.min(canvas.clientHeight - margin, screen.y)) - screen.y;
          constrainCamera();
        }
        schedulePaint();
      }
    });
  }
  function closeHints() { setHintsOpen(false); menuButton.current?.focus(); }
  useEffect(() => { selectedRef.current = selected; schedulePaint(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, selected]);

  // Wedstrijd: de officiële puzzeltijd staat vast bij de laatste verbinding (completedAt van de server); de vraag staat daar los van.
  const officialMs = match && state.snapshot.completedAt ? Math.max(0, Date.parse(state.snapshot.completedAt) - match.startedAt) : null;
  if (stage === "COMPLETE") return <Completion image={state.image} onContinue={continueToQuestion} t={t} officialMs={officialMs} />;
  if (stage === "QUESTION") return <Question state={state} onSubmit={submit} t={t} matchMode={!!match} onLater={match?.onLater} />;
  if (stage === "RESULT") return <Result answer={answer} question={state.question} onChooseAnother={onChooseAnother} onReplay={onReplay} t={t} />;
  const selectedGroup = selected === null ? null : groupFor(state.snapshot, selected);
  return <FocusLayout className="puzzle-workspace gap-0"><section aria-busy={busy} className="relative min-h-0 flex-1 overflow-hidden bg-vs-surface"><canvas ref={canvasRef} data-active-hint={hint?.type ?? ""} aria-label={t("jigsaw.board")} aria-describedby="jigsaw-board-help" tabIndex={0} className="block h-full w-full touch-none outline-none focus-visible:ring-4 focus-visible:ring-vs-xp" onPointerDown={boardDown} onPointerMove={boardMove} onPointerUp={boardUp} onPointerCancel={boardCancel} onWheel={(event) => { event.preventDefault(); zoom(event.deltaY > 0 ? .9 : 1.1, screenPoint(event)); }} onKeyDown={async (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); const pieces = state.snapshot.groups.flatMap((group) => group.pieceIds); setSelected(pieces[(pieces.indexOf(selected ?? -1) + 1) % pieces.length]); } if (event.key === "0") { event.preventDefault(); fit(); } if ((event.key === "r" || event.key === "R") && state.difficulty === "MASTER") { event.preventDefault(); await rotateSelected(); } if (event.key === "ArrowLeft") { event.preventDefault(); await moveSelectedBy(-.2, 0); } if (event.key === "ArrowRight") { event.preventDefault(); await moveSelectedBy(.2, 0); } if (event.key === "ArrowUp") { event.preventDefault(); await moveSelectedBy(0, -.2); } if (event.key === "ArrowDown") { event.preventDefault(); await moveSelectedBy(0, .2); } }} />{hint?.type === "PREVIEW" && <div className="pointer-events-none absolute inset-3 rounded-xl bg-vs-surface/95 p-2"><NextImage src={state.image} alt={t("jigsaw.hintPreview")} fill unoptimized className="object-contain p-2" /></div>}<p id="jigsaw-board-help" className="sr-only">{t("jigsaw.boardHelp")}</p>{state.difficulty === "MASTER" && selectedGroup && !selectedGroup.anchored && <button type="button" aria-label={t("jigsaw.rotate")} title={t("jigsaw.rotate")} className="btn-primary absolute bottom-3 left-3 min-h-[60px] min-w-[60px] rounded-2xl !p-[12px] shadow-md" disabled={busy} onClick={rotateSelected}><RotateCw size={26} /></button>}<div className="absolute bottom-3 right-3"><button ref={menuButton} type="button" className="btn-secondary min-h-[60px] min-w-[60px] rounded-2xl !p-[12px] shadow-md" aria-label={t("jigsaw.boardMenu")} aria-expanded={menuOpen || hintsOpen} onClick={() => { setHintsOpen(false); setMenuOpen(!menuOpen); }}><Ellipsis size={26} /></button>{menuOpen && <div className="absolute bottom-full right-0 z-10 mb-3 w-64 max-w-[calc(100vw-1.5rem-var(--vs-safe-area-left)-var(--vs-safe-area-right))] max-h-[calc(100dvh-var(--header-height,var(--header-default))-60px-2.25rem-var(--vs-safe-area-bottom))] overflow-y-auto rounded-xl border border-vs-line !bg-vs-surface p-1 shadow-lg"><button type="button" className="btn-secondary min-h-11 w-full justify-start gap-2 text-left" disabled={busy} onClick={() => { setMenuOpen(false); setError(""); setHintsOpen(true); void inventory.refetch(); }}><Lightbulb size={22} className="shrink-0" />{t("jigsaw.useHint")}</button>{state.rulesVersion === 1 && <p className="p-2 text-sm text-vs-fg-2">{t("jigsaw.legacyRules")}</p>}<button type="button" className="btn-secondary w-full min-h-11 justify-start text-left" onClick={() => { fit(); setMenuOpen(false); }}>{t("jigsaw.fitBoard")}</button><button type="button" className="btn-secondary mt-1 w-full min-h-11 justify-start text-left" disabled={busy} onClick={onChooseAnother}>{t("jigsaw.chooseAnother")}</button></div>}{hintsOpen && <PuzzleHintPanel returnFocus={menuButton} snapshot={state.snapshot} difficulty={state.difficulty} rulesVersion={state.rulesVersion} selected={selected} canConnect={puzzleHintTarget(state.snapshot, geometry, "CONNECTION", selected ?? undefined) !== null} hintBalance={inventory.data?.hintBalance ?? null} inventoryBusy={inventory.isFetching} inventoryError={!!inventory.error} busy={busy} active={hint !== null} error={error} onRefresh={() => void inventory.refetch()} onShop={() => { if (!pending.current) { if (!match) remember(saved.current.id); router.push("/shop"); } }} onUse={(type, filter, confirmed) => void requestHint(type, filter, confirmed)} onClose={closeHints} />}</div><p aria-live="polite" className="sr-only">{message || t("jigsaw.connected", { n: connectedPieces(state.snapshot), total: state.pieceCount })}</p>{match && <p className="pointer-events-none absolute left-3 top-3 rounded-xl bg-vs-surface/90 px-3 py-1 font-mono text-lg font-bold tabular-nums shadow" aria-label={t("puzzleTogether.match.clock")}>{`${Math.floor(clock / 60000)}:${String(Math.floor(clock / 1000) % 60).padStart(2, "0")}`}</p>}{error && <p role="alert" className="absolute inset-x-3 top-3 rounded-xl bg-vs-surface p-3 text-vs-fg">{error}</p>}</section></FocusLayout>;
}

function Completion({ image, onContinue, t, officialMs = null }: { image: string; onContinue: () => void; t: ReturnType<typeof useT>; officialMs?: number | null }) { return <FocusLayout className="page-fill max-w-none items-center justify-center gap-5 py-4 text-center"><div className="w-full max-w-4xl overflow-hidden rounded-2xl bg-vs-surface shadow-lg"><NextImage src={image} alt={t("jigsaw.completedImage")} width={1440} height={960} unoptimized priority className="h-auto max-h-[68dvh] w-full object-contain" /></div><div><h1 className="text-2xl font-extrabold text-vs-fg">{t("jigsaw.complete")}</h1>{officialMs !== null ? <p className="mt-2 text-vs-fg" data-official-time><span className="text-sm text-vs-fg-2">{t("puzzleTogether.match.officialTime")}</span><span className="block font-mono text-3xl font-extrabold tabular-nums">{formatPuzzleTime(officialMs)}</span><span className="mt-1 block text-sm text-vs-fg-2">{t("puzzleTogether.match.questionIndependent")}</span></p> : <p className="mt-2 text-vs-fg-2">{t("jigsaw.completeHint")}</p>}</div><button type="button" className="btn-primary min-h-12 w-full max-w-[440px] self-center" onClick={onContinue}>{t("jigsaw.continue")}</button></FocusLayout>; }

function Question({ state, onSubmit, t, matchMode = false, onLater }: { state: State; onSubmit: (choice: number) => Promise<void>; t: ReturnType<typeof useT>; matchMode?: boolean; onLater?: () => void }) { const [choice, setChoice] = useState<number | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); async function submit() { if (choice === null || busy) return; setBusy(true); setError(""); try { await onSubmit(choice); } catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : t("jigsaw.failed")); } finally { setBusy(false); } } return <FocusLayout className="page-fill mx-auto max-w-2xl justify-center gap-5 py-4"><header><h1 className="text-2xl font-extrabold text-vs-fg">{t("jigsaw.questionIntro")}</h1><p className="mt-2 text-vs-fg-2">{matchMode ? t("puzzleTogether.match.questionHelp") : t("jigsaw.questionHint")}</p></header><section className="card"><p className="font-semibold">{state.question?.text}</p><div className="mt-4 grid gap-2">{state.question?.options.map((option, index) => <button key={option} type="button" className={`btn-secondary min-h-12 justify-start text-left ${choice === index ? "!border-vs-xp !bg-vs-xp/15" : ""}`} aria-pressed={choice === index} disabled={busy} onClick={() => setChoice(index)}>{option}</button>)}</div></section><button type="button" className="btn-primary min-h-12 w-full max-w-[440px] self-center" disabled={choice === null || busy} onClick={submit}>{busy ? t("jigsaw.answering") : t("jigsaw.confirmAnswer")}</button>{matchMode && onLater && <button type="button" className="btn-secondary min-h-12 w-full max-w-[440px] self-center" disabled={busy} onClick={onLater}>{t("puzzleTogether.match.questionLater")}</button>}{error && <p role="alert">{error}</p>}</FocusLayout>; }

function Result({ answer, question, onChooseAnother, onReplay, t }: { answer: Answer | null; question: State["question"]; onChooseAnother: () => void; onReplay: () => void; t: ReturnType<typeof useT> }) {
  const result = answer && "correct" in answer ? answer : null;
  const text = result ? result.correct ? t("jigsaw.correct") : t("jigsaw.incorrect") : t("jigsaw.answerRecorded");
  return <FocusLayout className="page-fill mx-auto max-w-2xl items-center justify-center gap-5 py-4 text-center">
    <h1 className="text-2xl font-extrabold text-vs-fg">{t("jigsaw.complete")}</h1>
    <p role="status" className="text-vs-fg-2">{text}</p>
    {result && !result.correct && question && <p>{t("jigsaw.correctWas", { answer: question.options[result.correctChoice] })}</p>}
    {result && "record" in result && result.record && result.record.result !== "UNCHANGED" && <RecordNotice mode="SOLO" variantId={result.record.variantId} hintCategory={result.record.hintCategory} elapsedMs={result.record.elapsedMs} first={result.record.result === "CREATED"} />}
    <button type="button" className="btn-primary min-h-12 w-full max-w-[440px] self-center" onClick={onChooseAnother}>{t("jigsaw.another")}</button>
    <button type="button" className="btn-secondary min-h-12 w-full max-w-[440px] self-center" onClick={onReplay}>{t("jigsaw.replay")}</button>
  </FocusLayout>;
}
