"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Check, CheckCircle2, ChevronLeft, ChevronRight, Lightbulb, List, RotateCcw, X } from "lucide-react";
import FocusLayout from "@/components/versado/FocusLayout";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { focusRing, primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";
import { MYSTERY_001A, emptyMysteryPlacements } from "@/lib/mysteries/mystery001a";
import { allCharactersPlaced, cellFootAnchor, cellFromBoardPoint, characterImageMetrics, hintFor, isHardConstraintValid, occupantAt, placeCharacter, sameCell } from "@/lib/mysteries/logic";
import { parseBoardManifest, type BoardGeometry } from "@/lib/mysteries/manifest";
import type { CharacterId, GridCell, Placements } from "@/lib/mysteries/types";
import type { MysteryProgressView } from "@/lib/mysteries/progress";

type Gesture = { pointerId: number; characterId: CharacterId; startX: number; startY: number; moved: boolean };
type DragState = { characterId: CharacterId; x: number; y: number };

export default function Mystery001aClient({ initialProgress, readerHref }: { initialProgress: MysteryProgressView; readerHref: string }) {
  const t = useT();
  const confirm = useConfirm();
  const boardRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [geometry, setGeometry] = useState<BoardGeometry | null>(null);
  const [boardAssetError, setBoardAssetError] = useState(false);
  const [characterAssetErrors, setCharacterAssetErrors] = useState<Partial<Record<CharacterId, true>>>({});
  const [placements, setPlacements] = useState<Placements>(emptyMysteryPlacements);
  const [selected, setSelected] = useState<CharacterId | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragTarget, setDragTarget] = useState<GridCell | null>(null);
  const [clueIndex, setClueIndex] = useState(0);
  const [clueNotes, setClueNotes] = useState([false, false, false]);
  const [allCluesOpen, setAllCluesOpen] = useState(false);
  const [wrongOpen, setWrongOpen] = useState(false);
  const [hintKey, setHintKey] = useState<ReturnType<typeof hintFor> | null>(null);
  const [hintCount, setHintCount] = useState(0);
  const [checking, setChecking] = useState(false);
  const [solved, setSolved] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [tutorialDone, setTutorialDone] = useState(initialProgress.tutorialSeen);
  const [tutorialFeedback, setTutorialFeedback] = useState<string | null>(null);
  const [constraintPulse, setConstraintPulse] = useState(false);
  const tutorialActive = !tutorialDone;
  const canCheck = allCharactersPlaced(MYSTERY_001A, placements);
  const selectedCharacter = MYSTERY_001A.characters.find((character) => character.id === selected) ?? null;

  const markCharacterAssetError = useCallback((characterId: CharacterId) => {
    setCharacterAssetErrors((current) => current[characterId] ? current : { ...current, [characterId]: true });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(MYSTERY_001A.assets.manifest, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("manifest");
        return response.json();
      })
      .then((manifest) => {
        if (cancelled) return;
        const parsed = parseBoardManifest(manifest);
        if (!parsed || parsed.rows !== MYSTERY_001A.grid.rows || parsed.columns !== MYSTERY_001A.grid.columns) throw new Error("geometry");
        setGeometry(parsed);
      })
      .catch(() => { if (!cancelled) setBoardAssetError(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const cancel = () => {
      gesture.current = null;
      setDrag(null);
      setDragTarget(null);
    };
    window.addEventListener("blur", cancel);
    return () => window.removeEventListener("blur", cancel);
  }, []);

  const resetAttempt = useCallback(() => {
    setPlacements(emptyMysteryPlacements());
    setSelected(null);
    setDrag(null);
    setDragTarget(null);
    setClueNotes([false, false, false]);
    setClueIndex(0);
    setHintCount(0);
    setHintKey(null);
    setWrongOpen(false);
    setSolved(false);
    setSaveError(false);
    setTutorialFeedback(null);
    // Historische tutorialstatus wordt bij replay/reset nooit verwijderd.
    setTutorialDone(initialProgress.tutorialSeen || tutorialDone);
  }, [initialProgress.tutorialSeen, tutorialDone]);

  async function restart() {
    if (Object.values(placements).some(Boolean) || hintCount > 0 || clueNotes.some(Boolean)) {
      const accepted = await confirm(t("mystery001a.restartConfirm"), { title: t("mystery001a.restart"), confirmLabel: t("mystery001a.restart") });
      if (!accepted) return;
    }
    resetAttempt();
  }

  function unplace(characterId: CharacterId) {
    if (tutorialActive && characterId === "lehi") return;
    setPlacements((current) => ({ ...current, [characterId]: null }));
    setSelected(null);
  }

  function finishTutorial(nextPlacements: Placements) {
    setPlacements(nextPlacements);
    setTutorialDone(true);
    setTutorialFeedback(t("mystery001a.tutorialGood"));
    setConstraintPulse(true);
    setSelected(null);
    fetch("/api/mysteries/001a/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "tutorial-seen" }),
    }).catch(() => {});
    window.setTimeout(() => setConstraintPulse(false), 1800);
  }

  function tryPlace(characterId: CharacterId, cell: GridCell) {
    const result = placeCharacter(MYSTERY_001A, placements, characterId, cell, tutorialActive);
    if (!result.accepted) {
      if (tutorialActive) setTutorialFeedback(t("mystery001a.tutorialTryAgain"));
      return;
    }
    if (tutorialActive && result.tutorialCorrect) finishTutorial(result.placements);
    else {
      setPlacements(result.placements);
      setSelected(null);
    }
  }

  function targetAt(clientX: number, clientY: number): GridCell | null {
    if (!geometry || !boardRef.current) return null;
    const cell = cellFromBoardPoint({ x: clientX, y: clientY }, boardRef.current.getBoundingClientRect(), geometry);
    if (!cell || !gesture.current) return null;
    return isHardConstraintValid(MYSTERY_001A, placements, gesture.current.characterId, cell) ? cell : null;
  }

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>, characterId: CharacterId) {
    if (!event.isPrimary || event.button !== 0 || (tutorialActive && characterId !== "lehi")) return;
    suppressClick.current = false;
    setSelected(characterId);
    gesture.current = { pointerId: event.pointerId, characterId, startX: event.clientX, startY: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (!current.moved && Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < 6) return;
    current.moved = true;
    event.preventDefault();
    setDrag({ characterId: current.characterId, x: event.clientX, y: event.clientY - (event.pointerType === "touch" ? 36 : 10) });
    setDragTarget(targetAt(event.clientX, event.clientY - (event.pointerType === "touch" ? 36 : 10)));
  }

  function pointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDrag(null);
    setDragTarget(null);
    suppressClick.current = current.moved;
    if (!current.moved) return;
    const y = event.clientY - (event.pointerType === "touch" ? 36 : 10);
    const cell = geometry && boardRef.current
      ? cellFromBoardPoint({ x: event.clientX, y }, boardRef.current.getBoundingClientRect(), geometry)
      : null;
    if (cell && isHardConstraintValid(MYSTERY_001A, placements, current.characterId, cell)) {
      tryPlace(current.characterId, cell);
      return;
    }
    const tray = trayRef.current?.getBoundingClientRect();
    if (tray && event.clientX >= tray.left && event.clientX <= tray.right && y >= tray.top && y <= tray.bottom && placements[current.characterId]) {
      unplace(current.characterId);
    }
  }

  function characterClick(characterId: CharacterId) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (tutorialActive && characterId !== "lehi") return;
    setSelected((current) => current === characterId ? null : characterId);
  }

  async function checkSolution() {
    if (!canCheck || checking) return;
    setChecking(true);
    setSaveError(false);
    try {
      const response = await fetch("/api/mysteries/001a/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", placements, hintCount }),
      });
      const data = await response.json().catch(() => null);
      if (response.status === 422 || data?.correct === false) setWrongOpen(true);
      else if (!response.ok || !data?.correct) setSaveError(true);
      else {
        setTutorialDone(true);
        setSolved(true);
      }
    } catch {
      setSaveError(true);
    } finally {
      setChecking(false);
    }
  }

  function useHint() {
    setHintKey(hintFor(MYSTERY_001A, placements));
    setHintCount((count) => count + 1);
    setWrongOpen(false);
  }

  if (solved) {
    return (
      <FocusLayout className="max-w-2xl justify-center gap-6 py-4 text-center">
        <div className="vs-rise mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-vs-success-soft motion-reduce:animate-none">
          <CheckCircle2 className="h-14 w-14 text-vs-success" strokeWidth={2.25} aria-hidden />
        </div>
        <div>
          <p className="text-sm font-extrabold uppercase tracking-wider text-vs-success">{t("mystery001a.discovererComplete")}</p>
          <h1 className="mt-1 text-3xl font-black text-vs-fg">{t("mystery001a.solved")}</h1>
          <p className="mt-3 font-bold text-vs-fg-2">{hintCount === 0 ? t("mystery001a.solvedWithoutHints") : t("mystery001a.solvedWithHints", { count: hintCount })}</p>
        </div>
        <section className={`${surfaceCard} p-5 text-left sm:p-6`}>
          <p className="font-extrabold text-vs-accent">{t("mystery001a.puzzleDisclaimer")}</p>
          <p className="mt-3 text-vs-fg-2">{t("mystery001a.story")}</p>
        </section>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href={readerHref} className={`${primaryButton} min-h-12 px-6`}>{t("mystery001a.read")}</Link>
          <Link href="/live" className={`${secondaryButton} min-h-12 px-6`}>{t("mystery001a.backToGames")}</Link>
          <button type="button" className={`${secondaryButton} min-h-12 px-6`} onClick={resetAttempt}>{t("mystery001a.replay")}</button>
        </div>
      </FocusLayout>
    );
  }

  return (
    <FocusLayout className="max-w-5xl gap-4 pb-[calc(5.5rem+var(--vs-safe-area-bottom))]">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="sr-only">{t("mystery001a.title")}</h1>
          <p className="text-xs font-extrabold uppercase tracking-wider text-vs-accent">{t("mystery001a.difficulty")}</p>
        </div>
        <button type="button" onClick={restart} className={`${secondaryButton} min-h-11`}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t("mystery001a.restart")}</span>
        </button>
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 space-y-3">
          <p className="text-sm font-semibold text-vs-fg-2">{tutorialActive ? t("mystery001a.tutorial") : t("mystery001a.placementHelp")}</p>
          {tutorialFeedback && <p className="rounded-xl bg-vs-success-soft px-3 py-2 text-sm font-bold text-vs-success" role="status">{tutorialFeedback}</p>}
          {boardAssetError ? (
            <div className={`${surfaceCard} flex aspect-square items-center justify-center p-6 text-center text-vs-danger`} role="alert">{t("mystery001a.assetsMissing")}</div>
          ) : !geometry ? (
            <div className={`${surfaceCard} flex aspect-square items-center justify-center text-vs-fg-2`} role="status">{t("mystery001a.boardLoading")}</div>
          ) : (
            <MysteryBoard
              geometry={geometry}
              placements={placements}
              selected={selected}
              dragTarget={dragTarget}
              constraintPulse={constraintPulse}
              tutorialActive={tutorialActive}
              boardRef={boardRef}
              onBoardAssetError={() => setBoardAssetError(true)}
              characterAssetErrors={characterAssetErrors}
              onCharacterAssetError={markCharacterAssetError}
              onCell={(cell) => { if (selected) tryPlace(selected, cell); }}
              onCharacterClick={characterClick}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
            />
          )}

          <CharacterTray
            trayRef={trayRef}
            placements={placements}
            selected={selected}
            tutorialActive={tutorialActive}
            characterAssetErrors={characterAssetErrors}
            onCharacterAssetError={markCharacterAssetError}
            onClick={characterClick}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
          />
          {selectedCharacter && placements[selectedCharacter.id] && !tutorialActive && (
            <button type="button" className="text-sm font-bold text-vs-accent underline-offset-4 hover:underline" onClick={() => unplace(selectedCharacter.id)}>
              {t("mystery001a.returnToTray", { name: selectedCharacter.name })}
            </button>
          )}
          <div className="lg:hidden">
            <CluePanel clueIndex={clueIndex} notes={clueNotes} onIndex={setClueIndex} onToggle={(index) => setClueNotes((notes) => notes.map((value, at) => at === index ? !value : value))} onAll={() => setAllCluesOpen(true)} />
          </div>
        </section>
        <aside className="hidden lg:block">
          <CluePanel clueIndex={clueIndex} notes={clueNotes} onIndex={setClueIndex} onToggle={(index) => setClueNotes((notes) => notes.map((value, at) => at === index ? !value : value))} onAll={() => setAllCluesOpen(true)} />
        </aside>
      </div>

      {saveError && <p className="text-center text-sm font-bold text-vs-danger" role="alert">{t("mystery001a.saveFailed")}</p>}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-vs-line bg-vs-elevated/95 px-4 pt-3 pb-[max(1rem,var(--vs-safe-area-bottom))] backdrop-blur">
        <button type="button" className="btn-primary mx-auto min-h-12 w-full max-w-5xl" disabled={!canCheck || checking || boardAssetError} onClick={checkSolution}>
          {checking ? t("mystery001a.checking") : t("mystery001a.check")}
        </button>
      </div>

      {drag && <DragPreview drag={drag} />}
      {allCluesOpen && <AllCluesSheet notes={clueNotes} onToggle={(index) => setClueNotes((notes) => notes.map((value, at) => at === index ? !value : value))} onClose={() => setAllCluesOpen(false)} />}
      {wrongOpen && <BottomSheet title={t("mystery001a.wrongTitle")} onClose={() => setWrongOpen(false)}>
        <p className="text-vs-fg-2">{t("mystery001a.wrongText")}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" className={`${primaryButton} min-h-12`} onClick={() => setWrongOpen(false)}>{t("mystery001a.continue")}</button>
          <button type="button" className={`${secondaryButton} min-h-12`} onClick={useHint}><Lightbulb className="h-4 w-4" aria-hidden />{t("mystery001a.useHint")}</button>
        </div>
      </BottomSheet>}
      {hintKey && <BottomSheet title={t("mystery001a.hintTitle")} onClose={() => setHintKey(null)}>
        <p className="text-lg font-bold text-vs-fg">{t(hintKey)}</p>
        <button type="button" className={`${primaryButton} mt-5 min-h-12 w-full`} onClick={() => setHintKey(null)}>{t("mystery001a.continue")}</button>
      </BottomSheet>}
    </FocusLayout>
  );
}

function MysteryBoard({ geometry, placements, selected, dragTarget, constraintPulse, tutorialActive, boardRef, onBoardAssetError, characterAssetErrors, onCharacterAssetError, onCell, onCharacterClick, onPointerDown, onPointerMove, onPointerUp }: {
  geometry: BoardGeometry;
  placements: Placements;
  selected: CharacterId | null;
  dragTarget: GridCell | null;
  constraintPulse: boolean;
  tutorialActive: boolean;
  boardRef: React.RefObject<HTMLDivElement | null>;
  onBoardAssetError: () => void;
  characterAssetErrors: Partial<Record<CharacterId, true>>;
  onCharacterAssetError: (id: CharacterId) => void;
  onCell: (cell: GridCell) => void;
  onCharacterClick: (id: CharacterId) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, id: CharacterId) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const t = useT();
  const cells = useMemo(() => Array.from({ length: geometry.rows * geometry.columns }, (_, index) => ({ row: Math.floor(index / geometry.columns) + 1, column: index % geometry.columns + 1 })), [geometry]);
  const metrics = characterImageMetrics(geometry);
  const showGrid = selected !== null || dragTarget !== null || tutorialActive || constraintPulse;

  return (
    <div ref={boardRef} role="grid" aria-label={t("mystery001a.board")} aria-rowcount={geometry.rows} aria-colcount={geometry.columns} className="relative aspect-square w-full touch-none overflow-hidden rounded-2xl bg-vs-subtle shadow-sm select-none">
      {/* Het volledige vierkante bronbeeld blijft zichtbaar; geen object-cover of uitsnede. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={MYSTERY_001A.assets.board} alt="" draggable={false} onError={onBoardAssetError} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
      <div
        className="absolute grid"
        style={{
          left: `${geometry.bounds.left * 100}%`, top: `${geometry.bounds.top * 100}%`,
          width: `${(geometry.bounds.right - geometry.bounds.left) * 100}%`, height: `${(geometry.bounds.bottom - geometry.bounds.top) * 100}%`,
          gridTemplateColumns: `repeat(${geometry.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${geometry.rows}, minmax(0, 1fr))`,
        }}
      >
        {cells.map((cell) => {
          const occupant = occupantAt(placements, cell);
          const valid = selected ? isHardConstraintValid(MYSTERY_001A, placements, selected, cell) : true;
          const tutorialTarget = tutorialActive && sameCell(cell, MYSTERY_001A.solution.lehi);
          const pulsed = constraintPulse && (cell.row === 4 || cell.column === 2) && !sameCell(cell, MYSTERY_001A.solution.lehi);
          const label = occupant ? t("mystery001a.cellOccupied", { row: cell.row, column: cell.column, name: MYSTERY_001A.characters.find((character) => character.id === occupant)?.name ?? occupant }) : t("mystery001a.cellEmpty", { row: cell.row, column: cell.column });
          return (
            <button
              key={`${cell.row}-${cell.column}`}
              type="button"
              role="gridcell"
              aria-rowindex={cell.row}
              aria-colindex={cell.column}
              aria-label={`${label}${!valid ? `, ${t("mystery001a.cellUnavailable")}` : ""}`}
              aria-disabled={selected !== null && !valid}
              onClick={() => { if (selected && valid) onCell(cell); }}
              className={`relative border transition focus-visible:z-20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-vs-accent ${showGrid ? "border-white/45 dark:border-white/25" : "border-transparent"} ${selected && !valid ? "bg-vs-overlay/35" : ""} ${sameCell(cell, dragTarget) ? "z-10 bg-vs-accent/30 ring-4 ring-inset ring-vs-accent" : ""} ${tutorialTarget ? "animate-pulse ring-4 ring-inset ring-vs-xp-fill motion-reduce:animate-none" : ""} ${pulsed ? "bg-vs-danger/20 ring-2 ring-inset ring-vs-danger/70" : ""}`}
            />
          );
        })}
      </div>
      {MYSTERY_001A.characters.map((character) => {
        const cell = placements[character.id];
        if (!cell) return null;
        const anchor = cellFootAnchor(cell, geometry);
        return (
          <button
            key={character.id}
            type="button"
            aria-label={`${character.name}, ${t("mystery001a.cellOccupied", { row: cell.row, column: cell.column, name: character.name })}`}
            aria-pressed={selected === character.id}
            onClick={() => onCharacterClick(character.id)}
            onPointerDown={(event) => onPointerDown(event, character.id)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={`absolute z-20 touch-none rounded-xl ${focusRing} ${selected === character.id ? "ring-4 ring-vs-accent" : ""}`}
            style={{
              left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%`,
              width: `${metrics.height * 100}%`, height: `${metrics.height * 100}%`,
              transform: `translate(${-metrics.anchorX * 100}%, ${-metrics.anchorY * 100}%)`,
              zIndex: 20 + cell.row,
            }}
          >
            {/* De transparante bron blijft volledig intact; de voetpixel is het positioneringsanker. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={character.asset} alt="" draggable={false} onError={() => onCharacterAssetError(character.id)} className={`pointer-events-none h-full w-full object-contain ${characterAssetErrors[character.id] ? "opacity-0" : ""}`} />
            <span className="absolute left-1/2 top-full -translate-x-1/2 rounded-full bg-vs-elevated/90 px-1.5 py-0.5 text-[10px] font-extrabold text-vs-fg shadow-sm">{character.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function CharacterTray({ trayRef, placements, selected, tutorialActive, characterAssetErrors, onCharacterAssetError, onClick, onPointerDown, onPointerMove, onPointerUp }: {
  trayRef: React.RefObject<HTMLDivElement | null>;
  placements: Placements;
  selected: CharacterId | null;
  tutorialActive: boolean;
  characterAssetErrors: Partial<Record<CharacterId, true>>;
  onCharacterAssetError: (id: CharacterId) => void;
  onClick: (id: CharacterId) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, id: CharacterId) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const t = useT();
  const remaining = MYSTERY_001A.characters.filter((character) => !placements[character.id]);
  return (
    <div ref={trayRef} className={`${surfaceCard} min-h-20 p-3`} aria-label={t("mystery001a.tray")}>
      <p className="mb-2 text-xs font-extrabold uppercase tracking-wider text-vs-fg-3">{t("mystery001a.tray")}</p>
      {remaining.length === 0 ? <p className="text-sm text-vs-fg-2">{t("mystery001a.placedTray")}</p> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {remaining.map((character) => {
            const disabled = tutorialActive && character.id !== "lehi";
            return (
              <button
                key={character.id}
                type="button"
                disabled={disabled}
                aria-label={character.name}
                aria-pressed={selected === character.id}
                onClick={() => onClick(character.id)}
                onPointerDown={(event) => onPointerDown(event, character.id)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className={`flex min-h-16 touch-none items-center gap-2 rounded-xl border bg-vs-surface px-2 text-left transition disabled:opacity-40 ${selected === character.id ? "border-vs-accent ring-2 ring-vs-accent" : "border-vs-line hover:border-vs-line-strong"} ${focusRing}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={character.asset} alt="" draggable={false} onError={() => onCharacterAssetError(character.id)} className={`pointer-events-none h-12 w-12 shrink-0 object-contain ${characterAssetErrors[character.id] ? "opacity-0" : ""}`} />
                <span className="text-sm font-extrabold text-vs-fg">{character.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CluePanel({ clueIndex, notes, onIndex, onToggle, onAll }: { clueIndex: number; notes: boolean[]; onIndex: (index: number) => void; onToggle: (index: number) => void; onAll: () => void }) {
  const t = useT();
  const clue = MYSTERY_001A.clues[clueIndex];
  return (
    <section className={`${surfaceCard} p-4`} aria-labelledby="mystery-clue-title">
      <div className="flex items-center justify-between gap-2">
        <p id="mystery-clue-title" className="text-xs font-extrabold uppercase tracking-wider text-vs-accent">{t("mystery001a.clueProgress", { current: clueIndex + 1, total: MYSTERY_001A.clues.length })}</p>
        <button type="button" className={`h-10 w-10 rounded-full text-vs-fg-2 hover:bg-vs-subtle ${focusRing}`} onClick={onAll} aria-label={t("mystery001a.allClues")}><List className="mx-auto h-5 w-5" aria-hidden /></button>
      </div>
      <p className="mt-3 min-h-14 font-extrabold text-vs-fg">{t(clue.textKey)}</p>
      <button type="button" onClick={() => onToggle(clueIndex)} aria-pressed={notes[clueIndex]} className={`mt-3 flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm font-bold ${notes[clueIndex] ? "border-vs-success bg-vs-success-soft text-vs-success" : "border-vs-line text-vs-fg-2"} ${focusRing}`}>
        {notes[clueIndex] ? <Check className="h-5 w-5" aria-hidden /> : <span className="h-5 w-5 rounded-full border-2 border-current" aria-hidden />}
        {t(notes[clueIndex] ? "mystery001a.processed" : "mystery001a.unprocessed")}
      </button>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" className={`${secondaryButton} min-h-11`} disabled={clueIndex === 0} onClick={() => onIndex(clueIndex - 1)}><ChevronLeft className="h-4 w-4" aria-hidden />{t("mystery001a.previousClue")}</button>
        <button type="button" className={`${secondaryButton} min-h-11`} disabled={clueIndex + 1 === MYSTERY_001A.clues.length} onClick={() => onIndex(clueIndex + 1)}>{t("mystery001a.nextClue")}<ChevronRight className="h-4 w-4" aria-hidden /></button>
      </div>
      <button type="button" onClick={onAll} className="mt-3 w-full text-sm font-extrabold text-vs-accent underline-offset-4 hover:underline">{t("mystery001a.allClues")}</button>
    </section>
  );
}

function AllCluesSheet({ notes, onToggle, onClose }: { notes: boolean[]; onToggle: (index: number) => void; onClose: () => void }) {
  const t = useT();
  return <BottomSheet title={t("mystery001a.allClues")} onClose={onClose}>
    <ol className="space-y-3">
      {MYSTERY_001A.clues.map((clue, index) => <li key={clue.id} className="rounded-xl bg-vs-subtle p-3">
        <p className="font-bold text-vs-fg">{index + 1}. {t(clue.textKey)}</p>
        <button type="button" aria-pressed={notes[index]} onClick={() => onToggle(index)} className={`mt-2 flex min-h-10 items-center gap-2 text-sm font-bold ${notes[index] ? "text-vs-success" : "text-vs-fg-2"}`}>
          {notes[index] ? <Check className="h-5 w-5" aria-hidden /> : <span className="h-5 w-5 rounded-full border-2 border-current" aria-hidden />}
          {t(notes[index] ? "mystery001a.processed" : "mystery001a.unprocessed")}
        </button>
      </li>)}
    </ol>
    <div className="mt-5 border-t border-vs-line pt-4">
      <h3 className="font-extrabold text-vs-fg">{t("mystery001a.spatialTitle")}</h3>
      <p className="mt-2 text-sm text-vs-fg-2">{t("mystery001a.directRight")}</p>
      <p className="mt-2 text-sm text-vs-fg-2">{t("mystery001a.higherRight")}</p>
    </div>
  </BottomSheet>;
}

function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", key); };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-vs-overlay/50 sm:items-center sm:p-4" role="presentation" onPointerDown={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="mystery-sheet-title" onPointerDown={(event) => event.stopPropagation()} className="vs-rise max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-vs-line bg-vs-elevated p-5 pb-[calc(1.25rem+var(--vs-safe-area-bottom))] shadow-2xl sm:rounded-3xl sm:pb-5">
        <div className="flex items-center justify-between gap-3">
          <h2 id="mystery-sheet-title" className="text-xl font-black text-vs-fg">{title}</h2>
          <button type="button" autoFocus onClick={onClose} aria-label={t("common.close")} className={`h-10 w-10 rounded-full text-vs-fg-2 hover:bg-vs-subtle ${focusRing}`}><X className="mx-auto h-5 w-5" aria-hidden /></button>
        </div>
        <div className="mt-4">{children}</div>
      </section>
    </div>
  );
}

function DragPreview({ drag }: { drag: DragState }) {
  const character = MYSTERY_001A.characters.find((item) => item.id === drag.characterId)!;
  return (
    <div className="pointer-events-none fixed z-[70] h-24 w-24 -translate-x-1/2 -translate-y-1/2" style={{ left: drag.x, top: drag.y }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={character.asset} alt="" className="h-full w-full object-contain drop-shadow-xl" />
    </div>
  );
}
