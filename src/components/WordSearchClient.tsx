"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useConfirm } from "@/components/ConfirmProvider";
import { useT } from "@/components/I18nProvider";
import { lineCoordinates, type WordSearchDifficulty, type WordSearchPlacedWord, type WordSearchPosition } from "@/lib/wordSearch/generator";
import type { WordSearchView } from "@/lib/wordSearch/game";
import FocusLayout from "@/components/versado/FocusLayout";

interface Props {
  initialGame?: WordSearchView | null;
}

function keyOf(position: WordSearchPosition) {
  return `${position.row}:${position.col}`;
}

export default function WordSearchClient({ initialGame = null }: Props) {
  const t = useT();
  const confirm = useConfirm();
  const router = useRouter();
  const [game, setGame] = useState<WordSearchView | null>(initialGame);
  const [difficulty, setDifficulty] = useState<WordSearchDifficulty>("EASY");
  const [starting, setStarting] = useState(false);
  const [selecting, setSelecting] = useState<WordSearchPosition | null>(null);
  const [selection, setSelection] = useState<WordSearchPosition[]>([]);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pointerId = useRef<number | null>(null);

  async function start() {
    setStarting(true);
    setMessage(null);
    const response = await fetch("/api/word-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ difficulty, theme: "RANDOM" }),
    }).catch(() => null);
    if (!response?.ok) {
      setMessage(t("wordSearch.error"));
      setStarting(false);
      return;
    }
    const next = (await response.json()) as WordSearchView;
    setGame(next);
    setStarting(false);
    router.replace(`/word-search/${next.id}`);
  }

  async function giveUp() {
    if (!game || !(await confirm(t("wordSearch.giveUpConfirm")))) return;
    const response = await fetch(`/api/word-search/${game.id}/give-up`, { method: "POST" }).catch(() => null);
    if (!response?.ok) {
      setMessage(t("wordSearch.error"));
      return;
    }
    setGame(null);
    setMessage(null);
    router.push("/word-search");
  }

  function cellFromPoint(clientX: number, clientY: number): WordSearchPosition | null {
    const element = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-cell]");
    if (!element) return null;
    return { row: Number(element.dataset.row), col: Number(element.dataset.col) };
  }

  function updateSelection(end: WordSearchPosition) {
    if (!selecting || !game) return;
    setSelection(lineCoordinates(selecting, end, game.size) ?? []);
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>, position: WordSearchPosition) {
    if (!game || game.status === "COMPLETED" || checking) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerId.current = event.pointerId;
    setSelecting(position);
    setSelection([position]);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== event.pointerId || !selecting) return;
    event.preventDefault();
    const position = cellFromPoint(event.clientX, event.clientY);
    if (position) updateSelection(position);
  }

  async function finishSelection(event: React.PointerEvent<HTMLDivElement>) {
    if (pointerId.current !== event.pointerId || !selecting) return;
    pointerId.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const end = cellFromPoint(event.clientX, event.clientY) ?? selection.at(-1);
    const startPosition = selecting;
    setSelecting(null);
    setSelection([]);
    if (!end || !game || !lineCoordinates(startPosition, end, game.size)) return;
    setChecking(true);
    const response = await fetch(`/api/word-search/${game.id}/find`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start: startPosition, end }),
    }).catch(() => null);
    if (response?.ok) {
      const result = (await response.json()) as { correct: boolean; view: WordSearchView };
      setGame(result.view);
      if (!result.correct) setMessage(t("wordSearch.incorrect"));
      else setMessage(null);
    } else {
      setMessage(t("wordSearch.error"));
    }
    setChecking(false);
  }

  const foundCells = useMemo(() => {
    if (!game) return new Set<string>();
    const cells = new Set<string>();
    game.words
      .filter((word) => game.foundWords.includes(word.normalized))
      .forEach((word) => word.start && word.end && lineCoordinates(word.start, word.end, game.size)?.forEach((cell) => cells.add(keyOf(cell))));
    return cells;
  }, [game]);

  const selectedCells = useMemo(() => new Set(selection.map(keyOf)), [selection]);

  if (!game) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <div className="card">
          <h1 className="text-2xl font-black dark:text-slate-100">{t("wordSearch.title")}</h1>
          <p className="mt-2 text-slate-600 dark:text-slate-300">{t("wordSearch.intro")}</p>
        </div>
        <div className="card flex flex-col gap-5">
          <div>
            <h2 className="font-extrabold dark:text-slate-100">{t("wordSearch.title")}</h2>
            <div className="mt-3 grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("wordSearch.title")}>
              {(["EASY", "MEDIUM", "HARD"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={`btn ${difficulty === level ? "!border-gold-400 !bg-gold-50 dark:!bg-slate-700" : "btn-secondary"}`}
                  onClick={() => setDifficulty(level)}
                  aria-pressed={difficulty === level}
                >
                  {t(`wordSearch.${level === "EASY" ? "easy" : level === "MEDIUM" ? "medium" : "hard"}`)}
                </button>
              ))}
            </div>
          </div>
          {starting ? (
            <div className="rounded-2xl bg-slate-50 p-4 text-center dark:bg-slate-800" role="status">
              <p className="font-bold dark:text-slate-100">{t("wordSearch.generating")}</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("wordSearch.generatingHint")}</p>
            </div>
          ) : (
            <button type="button" className="btn-primary w-full" onClick={start}>
              {t("wordSearch.start")}
            </button>
          )}
          {message && <p className="text-sm text-red-600 dark:text-red-400">{message}</p>}
        </div>
      </main>
    );
  }

  return (
    <FocusLayout className="max-w-5xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black dark:text-slate-100">{t("wordSearch.title")}</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("wordSearch.selectHint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {game.status === "IN_PROGRESS" && <button type="button" className="btn-secondary" onClick={() => void giveUp()}>{t("wordSearch.giveUp")}</button>}
          <Link href="/live" className="btn-secondary">{t("wordSearch.backToGames")}</Link>
        </div>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section className="card flex flex-col items-center gap-4">
          <div className="flex w-full items-center justify-between gap-3">
            <span className="text-sm font-bold text-slate-600 dark:text-slate-300">{t("wordSearch.found", { found: game.foundWords.length, total: game.words.length })}</span>
            {checking && <span className="text-sm text-slate-500" role="status">{t("common.loading")}</span>}
          </div>
          <div
            className="grid w-full max-w-[42rem] select-none overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900"
            style={{ gridTemplateColumns: `repeat(${game.size}, minmax(0, 1fr))`, touchAction: "none" }}
            onPointerMove={onPointerMove}
            onPointerUp={finishSelection}
            onPointerCancel={finishSelection}
            role="grid"
            aria-label={t("wordSearch.title")}
          >
            {game.grid.flatMap((row, rowIndex) => row.map((letter, colIndex) => {
              const key = `${rowIndex}:${colIndex}`;
              const isSelected = selectedCells.has(key);
              const isFound = foundCells.has(key);
              return (
                <div
                  key={key}
                  data-cell
                  data-row={rowIndex}
                  data-col={colIndex}
                  className={`flex aspect-square min-w-0 items-center justify-center rounded-lg text-[clamp(.72rem,2.7vw,1.25rem)] font-black transition-colors ${
                    isSelected ? "bg-gold-400 text-slate-950" : isFound ? "bg-emerald-200 text-emerald-900 dark:bg-emerald-800 dark:text-emerald-50" : "text-slate-700 dark:text-slate-200"
                  }`}
                  onPointerDown={(event) => onPointerDown(event, { row: rowIndex, col: colIndex })}
                  role="gridcell"
                  aria-label={`${letter}, ${rowIndex + 1}, ${colIndex + 1}`}
                >
                  {letter}
                </div>
              );
            }))}
          </div>
          {message && <p className="text-sm text-slate-500 dark:text-slate-400" role="status">{message}</p>}
        </section>

        <aside className="card">
          <h2 className="font-extrabold dark:text-slate-100">{game.status === "COMPLETED" ? t("wordSearch.completed") : t("wordSearch.wordsToFind")}</h2>
          {game.status === "COMPLETED" && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t("wordSearch.completedSummary", { count: game.foundWords.length, total: game.words.length })}</p>}
          {game.status === "COMPLETED" && game.xpEarned > 0 && <p className="mt-1 text-sm font-bold text-gold-700 dark:text-gold-300">{t("wordSearch.xpEarned", { xp: game.xpEarned })}</p>}
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
            {game.words.map((word) => {
              const found = game.foundWords.includes(word.normalized);
              return <li key={word.normalized} className={`rounded-lg px-2 py-1 text-sm font-bold ${found ? "text-emerald-700 line-through dark:text-emerald-300" : "text-slate-700 dark:text-slate-200"}`}>{found ? "✓ " : ""}{word.display.toUpperCase()}</li>;
            })}
          </ul>
          {game.status === "COMPLETED" && (
            <button type="button" className="btn-primary mt-5 w-full" onClick={() => { setGame(null); setMessage(null); router.push("/word-search"); }}>
              {t("wordSearch.newPuzzle")}
            </button>
          )}
        </aside>
      </div>
    </FocusLayout>
  );
}
