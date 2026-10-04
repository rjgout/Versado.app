"use client";

import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import ToggleSwitch from "@/components/versado/ToggleSwitch";
import FocusLayout from "@/components/versado/FocusLayout";
import { JIGSAW_LEVELS, jigsawGrid, jigsawPiecePath, type JigsawLevel, type JigsawState } from "@/lib/jigsaw";

async function requestGame(body: object, fallback: string): Promise<JigsawState & { accepted?: boolean }> {
  const response = await fetch("/api/jigsaw", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).catch(() => { throw new Error(fallback); });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(result?.error ?? fallback);
  return result;
}

export default function JigsawClient({ images }: { images: string[] }) {
  const t = useT();
  const confirm = useConfirm();
  const [imageIndex, setImageIndex] = useState(0);
  const [pieces, setPieces] = useState<JigsawLevel>(12);
  const [page, setPage] = useState(0);
  const [game, setGame] = useState<JigsawState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const starting = useRef(false);
  const pages = Math.ceil(images.length / 12);

  async function start() {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setError("");
    try {
      setGame(await requestGame({ action: "start", imageIndex, pieces }, t("jigsaw.failed")));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("jigsaw.failed"));
    } finally {
      starting.current = false;
      setBusy(false);
    }
  }

  if (game) return <Puzzle initial={game} image={images[game.imageIndex]} onExit={() => setGame(null)} />;

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">🧩 {t("jigsaw.title")}</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">{t("jigsaw.intro")}</p>
      </header>
      <fieldset disabled={busy} className="flex flex-col gap-3">
        <legend className="font-bold mb-3">{t("jigsaw.chooseImage")}</legend>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {images.slice(page * 12, page * 12 + 12).map((image, offset) => {
            const index = page * 12 + offset;
            return (
              <button type="button" key={image} aria-pressed={index === imageIndex} onClick={() => setImageIndex(index)}
                className={`overflow-hidden rounded-2xl border-4 text-left focus-visible:outline focus-visible:outline-4 focus-visible:outline-brand-500 ${index === imageIndex ? "border-brand-500 bg-brand-50 dark:bg-brand-900" : "border-transparent bg-slate-100 dark:bg-slate-800"}`}>
                {/* De bestaande lokale illustraties blijven intact; alleen de keuzeminiatuur wordt bijgesneden. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={image} alt="" loading="lazy" draggable={false} className="w-full aspect-[4/3] object-cover" />
                <span className="block px-3 py-2 text-sm font-semibold">{index === imageIndex ? "✓ " : ""}{t("jigsaw.image", { n: index + 1 })}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn-secondary min-h-11" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label={t("jigsaw.previous")}>←</button>
          <span className="text-sm">{t("jigsaw.page", { n: page + 1, total: pages })}</span>
          <button type="button" className="btn-secondary min-h-11" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label={t("jigsaw.next")}>→</button>
        </div>
      </fieldset>
      <fieldset disabled={busy}>
        <legend className="font-bold mb-3">{t("jigsaw.level")}</legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {JIGSAW_LEVELS.map((level) => <button key={level} type="button" aria-pressed={pieces === level}
            className={`btn-secondary min-h-12 ${pieces === level ? "!bg-brand-100 dark:!bg-brand-900 !border-brand-500" : ""}`}
            onClick={() => setPieces(level)}>{t("jigsaw.pieces", { n: level })}</button>)}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <button type="button" className="btn-primary min-h-12" disabled={busy || !images.length} onClick={start}>{busy ? t("common.loading") : t("jigsaw.start")}</button>
        <span className="text-sm text-slate-500 dark:text-slate-400">{t("jigsaw.image", { n: imageIndex + 1 })} · {t("jigsaw.pieces", { n: pieces })}</span>
      </div>
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

function PieceImage({ piece, pieces, aspect, image }: { piece: number; pieces: JigsawLevel; aspect: number; image: string }) {
  const clip = useId();
  const { columns, rows } = jigsawGrid(pieces);
  const height = columns * 100 / aspect / rows;
  const padding = Math.min(100, height) * 0.2;
  const x = piece % columns * 100;
  const y = Math.floor(piece / columns) * height;
  const path = jigsawPiecePath(piece, pieces, aspect);
  return <svg viewBox={`${x - padding} ${y - padding} ${100 + padding * 2} ${height + padding * 2}`} className="h-full w-full overflow-visible" aria-hidden>
    <defs><clipPath id={clip}><path d={path} /></clipPath></defs>
    <image href={image} width={columns * 100} height={rows * height} preserveAspectRatio="none" clipPath={`url(#${clip})`} />
    <path d={path} fill="none" stroke="currentColor" strokeWidth="1" />
  </svg>;
}

type Drag = { piece: number; x: number; y: number; width: number; height: number };
type Gesture = { id: number; piece: number; x: number; y: number; offset: number; moved: boolean };

function Puzzle({ initial, image, onExit }: { initial: JigsawState; image: string; onExit: () => void }) {
  const t = useT();
  const [game, setGame] = useState(initial);
  const [aspect, setAspect] = useState(1.5);
  const [loaded, setLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [ghost, setGhost] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const tray = useRef<HTMLDivElement>(null);
  const pending = useRef(false);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const clipPrefix = useId();
  const { columns, rows } = jigsawGrid(game.pieces);
  const width = columns * 100;
  const height = width / aspect;
  const minimumBoardWidth = Math.max(columns * 44, rows * 44 * aspect);
  const remaining = game.order.filter((piece) => !game.placed.includes(piece));

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setImageFailed(false);
    const picture = new Image();
    picture.onload = () => {
      if (cancelled) return;
      setAspect(picture.naturalWidth / picture.naturalHeight);
      setLoaded(true);
    };
    picture.onerror = () => { if (!cancelled) setImageFailed(true); };
    picture.src = image;
    return () => { cancelled = true; };
  }, [image, retry]);

  useEffect(() => {
    const cancel = () => { gesture.current = null; setDrag(null); };
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, []);

  async function place(piece: number, x: number, y: number) {
    if (pending.current || !loaded || game.complete || x < 0 || x > 1 || y < 0 || y > 1) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requestGame({ action: "place", token: game.token, piece, x, y }, t("jigsaw.failed"));
      setGame(result);
      if (result.accepted) setSelected(null);
      setMessage(t(result.complete ? "jigsaw.complete" : result.accepted ? "jigsaw.placed" : "jigsaw.wrong"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("jigsaw.failed"));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, piece: number) {
    if (!event.isPrimary || event.button !== 0 || pending.current) return;
    suppressClick.current = false;
    setSelected(piece);
    gesture.current = { id: event.pointerId, piece, x: event.clientX, y: event.clientY, offset: event.pointerType === "touch" ? 44 : 0, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId || !board.current) return;
    if (!current.moved && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    current.moved = true;
    const rect = board.current.getBoundingClientRect();
    const pieceWidth = rect.width / columns;
    const pieceHeight = rect.height / rows;
    const padding = Math.min(pieceWidth, pieceHeight) * 0.2;
    setDrag({ piece: current.piece, x: event.clientX, y: event.clientY - current.offset, width: pieceWidth + padding * 2, height: pieceHeight + padding * 2 });
  }

  function pointerUp(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.id !== event.pointerId) return;
    gesture.current = null;
    setDrag(null);
    suppressClick.current = current.moved;
    if (!current.moved || !board.current) return;
    const rect = board.current.getBoundingClientRect();
    const x = event.clientX;
    const y = event.clientY - current.offset;
    // Het bord kan bij veel stukjes scrollen. Een verborgen deel is geen
    // geldig neerzetdoel, ook al valt het binnen de volledige bordrechthoek.
    const viewport = board.current.parentElement!.getBoundingClientRect();
    if (x < viewport.left || x > viewport.right || y < viewport.top || y > viewport.bottom) return;
    void place(current.piece, (x - rect.left) / rect.width, (y - rect.top) / rect.height);
  }

  async function exit() {
    if (!game.complete && game.placed.length > 0 && !(await confirm(t("jigsaw.leaveConfirm")))) return;
    onExit();
  }

  return (
    <FocusLayout className="max-w-5xl gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-extrabold text-brand-800 dark:text-brand-300">🧩 {t("jigsaw.title")}</h1>
        <button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={exit}>{t("jigsaw.chooseAnother")}</button>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">{t("jigsaw.instructions")}</p>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <strong>{t("jigsaw.progress", { n: game.placed.length, total: game.pieces })}</strong>
        <button type="button" className="btn-secondary min-h-11" aria-expanded={preview} onClick={() => setPreview(!preview)}>{t(preview ? "jigsaw.hidePreview" : "jigsaw.preview")}</button>
        <label className="flex min-h-11 items-center gap-2">{t("jigsaw.ghost")}<ToggleSwitch checked={ghost} onChange={setGhost} compact /></label>
      </div>
      {preview && <div className="flex justify-center rounded-2xl bg-slate-100 dark:bg-slate-800 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={t("jigsaw.image", { n: game.imageIndex + 1 })} draggable={false} className="max-h-48 max-w-full object-contain rounded-lg" />
      </div>}
      {imageFailed ? <div role="alert" className="card flex flex-col gap-3">
        <p>{t("jigsaw.imageFailed")}</p>
        <button type="button" className="btn-secondary self-start" onClick={() => setRetry(retry + 1)}>{t("jigsaw.retry")}</button>
      </div> : !loaded ? <p role="status">{t("common.loading")}</p> : <>
        <div className="overflow-auto rounded-2xl bg-slate-200 dark:bg-slate-900 p-2 overscroll-contain" style={{ maxHeight: "48svh" }}>
          <div ref={board} role="group" aria-label={t("jigsaw.board")} className="relative mx-auto bg-white dark:bg-slate-800 select-none"
            style={{ aspectRatio: aspect, width: "100%", minWidth: minimumBoardWidth, maxWidth: `max(${minimumBoardWidth}px, ${44 * aspect}svh)` }}>
            <svg viewBox={`0 0 ${width} ${height}`} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
              {ghost && <image href={image} width={width} height={height} opacity="0.2" preserveAspectRatio="none" />}
              {game.order.map((piece) => <path key={piece} d={jigsawPiecePath(piece, game.pieces, aspect)} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" />)}
              {game.placed.map((piece) => {
                const path = jigsawPiecePath(piece, game.pieces, aspect);
                const clip = `${clipPrefix}-${piece}`;
                return <g key={piece}>
                  <defs><clipPath id={clip}><path d={path} /></clipPath></defs>
                  <image href={image} width={width} height={height} preserveAspectRatio="none" clipPath={`url(#${clip})`} />
                  {!game.complete && <path d={path} fill="none" stroke="white" strokeWidth="1" strokeOpacity="0.6" />}
                </g>;
              })}
            </svg>
            <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
              {Array.from({ length: game.pieces }, (_, cell) => <button key={cell} type="button"
                aria-label={t("jigsaw.cell", { row: Math.floor(cell / columns) + 1, column: cell % columns + 1 })}
                disabled={busy || selected === null || game.placed.includes(cell) || game.complete}
                className="focus-visible:outline focus-visible:outline-4 focus-visible:outline-brand-500 enabled:active:bg-brand-400/20"
                onClick={() => { if (selected !== null) void place(selected, (cell % columns + 0.5) / columns, (Math.floor(cell / columns) + 0.5) / rows); }} />)}
            </div>
          </div>
        </div>
        <div role="status" aria-live="polite" className={`min-h-6 text-center text-sm font-semibold ${game.complete ? "text-brand-700 dark:text-brand-300" : ""}`}>
          {busy ? t("jigsaw.checking") : message || "\u00a0"}
        </div>
        {!game.complete && <div className="flex items-center gap-1 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
          <button type="button" className="shrink-0 w-11 h-24 rounded-xl text-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700"
            aria-label={t("jigsaw.previousPieces")} onClick={() => tray.current?.scrollBy({ left: -tray.current.clientWidth * 0.8, behavior: "smooth" })}>←</button>
          <div ref={tray} aria-label={t("jigsaw.tray")} role="group" className="flex min-w-0 flex-1 gap-2 overflow-x-auto p-2 overscroll-x-contain">
          {remaining.map((piece) => <button key={piece} type="button" data-piece={piece} aria-label={t("jigsaw.piece", { n: piece + 1 })} aria-pressed={selected === piece}
            disabled={busy} className={`shrink-0 w-24 h-24 p-2 rounded-xl border-2 select-none text-slate-600 dark:text-slate-300 ${selected === piece ? "border-brand-500 bg-brand-100 dark:bg-brand-900" : "border-transparent bg-white dark:bg-slate-700"}`}
            // Stukjes mogen ook diagonaal bewegen; horizontaal bladeren gaat
            // via de pijlen zodat de browser een sleep niet als swipe afbreekt.
            style={{ touchAction: "none", WebkitUserSelect: "none", opacity: drag?.piece === piece ? 0.3 : 1 }}
            onPointerDown={(event) => pointerDown(event, piece)} onPointerMove={pointerMove} onPointerUp={pointerUp}
            onPointerCancel={() => { gesture.current = null; setDrag(null); }}
            onLostPointerCapture={() => { gesture.current = null; setDrag(null); }}
            onContextMenu={(event) => event.preventDefault()}
            onClick={(event) => { if (event.detail === 0 || !suppressClick.current) setSelected(piece); suppressClick.current = false; }}>
            <PieceImage piece={piece} pieces={game.pieces} aspect={aspect} image={image} />
          </button>)}
          </div>
          <button type="button" className="shrink-0 w-11 h-24 rounded-xl text-xl font-bold hover:bg-slate-200 dark:hover:bg-slate-700"
            aria-label={t("jigsaw.nextPieces")} onClick={() => tray.current?.scrollBy({ left: tray.current.clientWidth * 0.8, behavior: "smooth" })}>→</button>
        </div>}
      </>}
      {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
      {drag && <div className="fixed z-[100] pointer-events-none text-slate-700 drop-shadow-xl" style={{ left: drag.x, top: drag.y, width: drag.width, height: drag.height, transform: "translate(-50%, -50%)" }}>
        <PieceImage piece={drag.piece} pieces={game.pieces} aspect={aspect} image={image} />
      </div>}
    </FocusLayout>
  );
}
