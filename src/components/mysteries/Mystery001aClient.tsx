"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Check, CheckCircle2, Eraser, Lightbulb, Undo2, X } from "lucide-react";
import FocusLayout from "@/components/versado/FocusLayout";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { focusRing, primaryButton, secondaryButton, surfaceCard } from "@/components/versado/styles";
import { MYSTERY_001A, emptyMysteryPlacements } from "@/lib/mysteries/mystery001a";
import { allCharactersPlaced, cellFootAnchor, cellFromBoardPoint, characterImageMetrics, gridNormalizedRect, hintFor, isHardConstraintValid, occupantAt, placeCharacter, sameCell } from "@/lib/mysteries/logic";
import { parseBoardManifest, type BoardGeometry } from "@/lib/mysteries/manifest";
import { characterCluesFor } from "@/lib/mysteries/characterClues";
import { closingQuestionFor } from "@/lib/mysteries/closingQuestions";
import { nextMysteryHrefFor } from "@/lib/mysteries/game";
import type { CharacterId, GridCell, MysteryDefinition, Placements } from "@/lib/mysteries/types";
import type { MysteryProgressView } from "@/lib/mysteries/progress";
import type { MessageKey } from "@/lib/i18n/core";

type Gesture = { pointerId: number; characterId: CharacterId; startX: number; startY: number; moved: boolean };
type DragState = { characterId: CharacterId; x: number; y: number };

export function MysteryClient({ initialProgress, readerHref, definition, progressEndpoint, hintEndpoint }: { initialProgress: MysteryProgressView; readerHref: string; definition: MysteryDefinition; progressEndpoint: string; hintEndpoint: string }) {
  // De bestaande component blijft de gedeelde renderer; deze lokale alias
  // beperkt de refactor tot data-invoer en laat de bestaande interactie intact.
  const MYSTERY_001A = definition;
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const boardRef = useRef<HTMLDivElement>(null);
  const trayRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [geometry, setGeometry] = useState<BoardGeometry | null>(null);
  const [boardAssetError, setBoardAssetError] = useState(false);
  const [characterAssetErrors, setCharacterAssetErrors] = useState<Partial<Record<CharacterId, true>>>({});
  const [placements, setPlacements] = useState<Placements>(() => emptyMysteryPlacements(definition));
  const [placementHistory, setPlacementHistory] = useState<Placements[]>([]);
  const [selected, setSelected] = useState<CharacterId | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [dragTarget, setDragTarget] = useState<GridCell | null>(null);
  const [clueNotes, setClueNotes] = useState<Record<string, boolean>>(() => initialCharacterClueNotes(definition));
  const [wrongOpen, setWrongOpen] = useState(false);
  const [hintKey, setHintKey] = useState<ReturnType<typeof hintFor> | null>(null);
  const [hintCount, setHintCount] = useState(0);
  const [hintBalance, setHintBalance] = useState<number | null>(null);
  const [hintLoading, setHintLoading] = useState(false);
  const [hintError, setHintError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [solved, setSolved] = useState(false);
  const [closingAnswer, setClosingAnswer] = useState<number | null>(null);
  const [closingSubmitted, setClosingSubmitted] = useState(false);
  const [closingDismissed, setClosingDismissed] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [tutorialDone, setTutorialDone] = useState(initialProgress.tutorialSeen);
  const [tutorialFeedback, setTutorialFeedback] = useState<string | null>(null);
  const [constraintPulse, setConstraintPulse] = useState(false);
  const tutorialActive = !!definition.tutorial && !tutorialDone;
  const canCheck = allCharactersPlaced(MYSTERY_001A, placements);
  const canClear = Object.values(placements).some(Boolean);
  const canUndo = placementHistory.length > 0;
  const closingQuestion = closingQuestionFor(definition);
  const resumeCompleted = searchParams.get("resume") === "completed" && initialProgress.completed;
  const resultVisible = solved || resumeCompleted;
  const nextMysteryHref = nextMysteryHrefFor(definition);
  const playHref = `/mysteries/${definition.routeId}/play`;
  const readerReturnHref = `${playHref}?resume=completed`;
  const readerLink = withReturnContext(readerHref, readerReturnHref);
  const resultHintCount = resumeCompleted ? (initialProgress.hintCount ?? 0) : hintCount;
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
  }, [MYSTERY_001A.assets.manifest, MYSTERY_001A.grid.columns, MYSTERY_001A.grid.rows]);

  useEffect(() => {
    fetch("/api/hints", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (typeof data?.hintBalance === "number") setHintBalance(data.hintBalance); })
      .catch(() => {});
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
    setPlacements(emptyMysteryPlacements(definition));
    setPlacementHistory([]);
    setSelected(null);
    setDrag(null);
    setDragTarget(null);
    setClueNotes(initialCharacterClueNotes(definition));
    setHintCount(0);
    setHintKey(null);
    setHintError(null);
    setWrongOpen(false);
    setSolved(false);
    setClosingAnswer(null);
    setClosingSubmitted(false);
    setClosingDismissed(false);
    setSaveError(false);
    setTutorialFeedback(null);
    // Historische tutorialstatus wordt bij replay/reset nooit verwijderd.
    setTutorialDone(!!definition.tutorial && (initialProgress.tutorialSeen || tutorialDone));
  }, [definition, initialProgress.tutorialSeen, tutorialDone]);

  async function clearBoard() {
    if (!canClear) return;
    const accepted = await confirm(t("mystery001a.clearBoardConfirm"), { title: t("mystery001a.clearBoard"), confirmLabel: t("mystery001a.clearBoard") });
    if (!accepted) return;
    setPlacements(emptyMysteryPlacements(definition));
    setPlacementHistory([]);
    setSelected(null);
    setDrag(null);
    setDragTarget(null);
    setWrongOpen(false);
  }

  function applyPlacement(next: Placements) {
    setPlacementHistory((history) => [...history, placements]);
    setPlacements(next);
    setSelected(null);
  }

  function undoPlacement() {
    const previous = placementHistory.at(-1);
    if (!previous) return;
    setPlacementHistory((history) => history.slice(0, -1));
    setPlacements(previous);
    setSelected(null);
    setDrag(null);
    setDragTarget(null);
  }

  function showTransientTutorialFeedback(message: string) {
    setTutorialFeedback(message);
    window.setTimeout(() => setTutorialFeedback(null), 1800);
  }

  function unplace(characterId: CharacterId) {
    if (tutorialActive && characterId === definition.tutorial?.characterId) return;
    applyPlacement({ ...placements, [characterId]: null });
  }

  function finishTutorial(nextPlacements: Placements) {
    applyPlacement(nextPlacements);
    setTutorialDone(true);
    setTutorialFeedback(t("mystery001a.tutorialGood"));
    setConstraintPulse(true);
    setSelected(null);
    fetch(progressEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "tutorial-seen" }),
    }).catch(() => {});
    window.setTimeout(() => {
      setConstraintPulse(false);
      setTutorialFeedback(null);
    }, 1800);
  }

  function tryPlace(characterId: CharacterId, cell: GridCell) {
    const result = placeCharacter(MYSTERY_001A, placements, characterId, cell, tutorialActive);
    if (!result.accepted) {
      if (tutorialActive) showTransientTutorialFeedback(t(definition.tutorialTryAgainKey ?? "mystery001a.tutorialTryAgain"));
      return;
    }
    if (tutorialActive && result.tutorialCorrect) finishTutorial(result.placements);
    else applyPlacement(result.placements);
  }

  function targetAt(clientX: number, clientY: number): GridCell | null {
    if (!geometry || !boardRef.current) return null;
    const cell = cellFromBoardPoint({ x: clientX, y: clientY }, boardRef.current.getBoundingClientRect(), geometry);
    if (!cell || !gesture.current) return null;
    return isHardConstraintValid(MYSTERY_001A, placements, gesture.current.characterId, cell) ? cell : null;
  }

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>, characterId: CharacterId) {
    if (!event.isPrimary || event.button !== 0 || (tutorialActive && characterId !== definition.tutorial?.characterId)) return;
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
    // De preview hangt iets boven de vinger, maar de drop raakt altijd de
    // zichtbare cel onder de werkelijke pointerpositie.
    setDragTarget(targetAt(event.clientX, event.clientY));
  }

  function pointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    setDrag(null);
    setDragTarget(null);
    suppressClick.current = current.moved;
    if (!current.moved) return;
    const cell = geometry && boardRef.current
      ? cellFromBoardPoint({ x: event.clientX, y: event.clientY }, boardRef.current.getBoundingClientRect(), geometry)
      : null;
    if (cell && isHardConstraintValid(MYSTERY_001A, placements, current.characterId, cell)) {
      tryPlace(current.characterId, cell);
      return;
    }
    const tray = trayRef.current?.getBoundingClientRect();
    if (tray && event.clientX >= tray.left && event.clientX <= tray.right && event.clientY >= tray.top && event.clientY <= tray.bottom && placements[current.characterId]) {
      unplace(current.characterId);
    }
  }

  function pointerCancel(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    // Een door browser/scroll geannuleerde pointer mag nooit als drop tellen.
    gesture.current = null;
    suppressClick.current = true;
    setDrag(null);
    setDragTarget(null);
  }

  function characterClick(characterId: CharacterId) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (tutorialActive && characterId !== definition.tutorial?.characterId) return;
    setSelected((current) => current === characterId ? null : characterId);
  }

  async function checkSolution() {
    if (!canCheck || checking) return;
    setChecking(true);
    setSaveError(false);
    try {
      const response = await fetch(progressEndpoint, {
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

  async function useHint() {
    if (hintLoading || hintBalance === 0) return;
    setHintLoading(true);
    setHintError(null);
    try {
      const response = await fetch(hintEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ difficulty: definition.difficulty, placements }),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && typeof data?.hint === "string") {
        setHintKey(data.hint as MessageKey);
        setHintCount((count) => count + 1);
        if (typeof data.hintBalance === "number") setHintBalance(data.hintBalance);
        setWrongOpen(false);
      } else setHintError(typeof data?.error === "string" ? data.error : t("mystery001a.hintFailed"));
    } catch {
      setHintError(t("mystery001a.hintFailed"));
    } finally {
      setHintLoading(false);
    }
  }

  function submitClosingQuestion() {
    if (closingAnswer === null) return;
    setClosingSubmitted(true);
    rememberClosingState(definition.id, { answer: closingAnswer });
  }

  function dismissClosingQuestion() {
    setClosingDismissed(true);
    rememberClosingState(definition.id, { dismissed: true });
  }

  function replay() {
    forgetClosingState(definition.id);
    if (resumeCompleted) router.replace(playHref);
    else resetAttempt();
  }

  // Herstel de vrijblijvende slotvraag na een reader-roundtrip; dit is
  // bewust een eenmalige synchronisatie met sessionStorage.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!resultVisible) return;
    const state = readClosingState(definition.id);
    if (state?.dismissed) {
      setClosingDismissed(true);
    }
    else if (typeof state?.answer === "number") {
      setClosingAnswer(state.answer);
      setClosingSubmitted(true);
    }
  }, [definition.id, resultVisible]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (resultVisible) {
    const closingDone = closingSubmitted || closingDismissed;
    const closingCorrect = closingAnswer === closingQuestion.correctOption;
    return (
      <FocusLayout className="max-w-2xl justify-center gap-6 py-4 text-center">
        <div className="vs-rise mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-vs-success-soft motion-reduce:animate-none">
          <CheckCircle2 className="h-14 w-14 text-vs-success" strokeWidth={2.25} aria-hidden />
        </div>
        <div>
          <p className="text-sm font-extrabold uppercase tracking-wider text-vs-success">{t(definition.completionLabelKey)}</p>
          <h1 className="mt-1 text-3xl font-black text-vs-fg">{t("mystery001a.solved")}</h1>
          <p className="mt-3 font-bold text-vs-fg-2">{resultHintCount === 0 ? t("mystery001a.solvedWithoutHints") : t("mystery001a.solvedWithHints", { count: resultHintCount })}</p>
        </div>
        <section className={`${surfaceCard} p-5 text-left sm:p-6`}>
          <p className="text-vs-fg-2">{t(definition.story.summaryKey)}</p>
        </section>
        <p className="text-sm font-bold text-vs-fg-2">{t("mysteryClosing.intro")}</p>
        <section className={`${surfaceCard} p-5 text-left sm:p-6`} aria-labelledby="mystery-closing-question">
          <p className="text-xs font-extrabold uppercase tracking-wider text-vs-accent">{t("mysteryClosing.questionTitle")}</p>
          <p id="mystery-closing-question" className="mt-2 text-lg font-black text-vs-fg">{t(closingQuestion.questionKey)}</p>
          {!closingDone ? (
            <>
              <fieldset className="mt-4 space-y-2">
                <legend className="sr-only">{t(closingQuestion.questionKey)}</legend>
                {closingQuestion.optionKeys.map((optionKey, index) => (
                  <label key={optionKey} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm font-bold transition ${closingAnswer === index ? "border-vs-accent bg-vs-accent/10" : "border-vs-line hover:border-vs-line-strong"}`}>
                    <input type="radio" name="mystery-closing-answer" value={index} checked={closingAnswer === index} onChange={() => setClosingAnswer(index)} className="mt-0.5 h-4 w-4 accent-[var(--vs-accent)]" />
                    <span>{t(optionKey)}</span>
                  </label>
                ))}
              </fieldset>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <button type="button" className={`${primaryButton} min-h-11 flex-1`} disabled={closingAnswer === null} onClick={submitClosingQuestion}>{t("mysteryClosing.continue")}</button>
                <button type="button" className={`${secondaryButton} min-h-11 flex-1`} onClick={dismissClosingQuestion}>{t("mysteryClosing.skip")}</button>
              </div>
            </>
          ) : closingDismissed ? (
            <p className="mt-4 text-sm font-bold text-vs-fg-2">{t("mysteryClosing.solved")}</p>
          ) : (
            <div className="mt-4 rounded-xl bg-vs-subtle p-4" role="status">
              <p className={`font-black ${closingCorrect ? "text-vs-success" : "text-vs-fg"}`}>{t(closingCorrect ? "mysteryClosing.correct" : "mysteryClosing.incorrect")}</p>
              {!closingCorrect && <p className="mt-2 text-sm font-bold text-vs-fg">{t("mysteryClosing.correctAnswer", { answer: t(closingQuestion.optionKeys[closingQuestion.correctOption]) })}</p>}
              <p className="mt-3 text-sm text-vs-fg-2"><span className="font-extrabold text-vs-fg">{t("mysteryClosing.explanationTitle")}: </span>{t(closingQuestion.explanationKey)}</p>
              <p className="mt-2 text-xs font-extrabold uppercase tracking-wider text-vs-fg-3">{t(closingQuestion.scriptureReferenceKey)}</p>
            </div>
          )}
        </section>
        {closingDone && <p className="text-sm font-extrabold text-vs-success">{t("mysteryClosing.solved")}</p>}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
          {nextMysteryHref ? <Link href={nextMysteryHref} className={`${primaryButton} min-h-12 px-6`}>{t("mysteryClosing.nextMystery")}</Link> : null}
          <Link href={readerLink} className={`${nextMysteryHref ? secondaryButton : primaryButton} min-h-12 px-6`}>{t(definition.readerLabelKey)}</Link>
          <Link href="/mysteries" className={`${secondaryButton} min-h-12 px-6`}>{t("mysteryClosing.backToMysteries")}</Link>
          <button type="button" className={`${secondaryButton} min-h-12 px-6`} onClick={replay}>{t("mystery001a.replay")}</button>
        </div>
      </FocusLayout>
    );
  }

  return (
    <FocusLayout className="mystery-game-layout max-w-5xl gap-4">
      <header className="hidden shrink-0 items-center lg:flex">
        <div className="min-w-0">
          <h1 className="sr-only">{t(definition.titleKey)}</h1>
          <p className="text-xs font-extrabold uppercase tracking-wider text-vs-accent">{t(definition.difficultyLabelKey)}</p>
        </div>
      </header>

      <div className="mystery-mobile-play-column grid min-h-0 flex-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:gap-3">
          <div className="mystery-mobile-board-slot">
            {boardAssetError ? (
              <div className={`${surfaceCard} mystery-board-frame flex aspect-square items-center justify-center p-6 text-center text-vs-danger`} role="alert">{t("mystery001a.assetsMissing")}</div>
            ) : !geometry ? (
              <div className={`${surfaceCard} mystery-board-frame flex aspect-square items-center justify-center text-vs-fg-2`} role="status">{t("mystery001a.boardLoading")}</div>
            ) : (
              <MysteryBoard
                definition={definition}
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
                onPointerCancel={pointerCancel}
              />
            )}
            {(tutorialActive || tutorialFeedback || saveError || (hintError && !hintKey)) && (
              <div className={`pointer-events-none absolute inset-x-2 top-2 z-30 rounded-xl px-3 py-2 text-center text-xs font-extrabold shadow-lg ${tutorialFeedback ? "bg-vs-success-soft text-vs-success" : "bg-vs-elevated/95 text-vs-fg"}`} role={saveError || hintError ? "alert" : "status"}>
                {tutorialActive ? t(definition.tutorialCopyKey ?? "mystery001a.tutorial") : tutorialFeedback ? tutorialFeedback : saveError ? t("mystery001a.saveFailed") : t("mystery001a.hintFailed")}
              </div>
            )}
          </div>

          <CharacterTray
            definition={definition}
            trayRef={trayRef}
            placements={placements}
            selected={selected}
            tutorialActive={tutorialActive}
            clueNotes={clueNotes}
            characterAssetErrors={characterAssetErrors}
            onCharacterAssetError={markCharacterAssetError}
            onToggleClue={(key) => setClueNotes((notes) => ({ ...notes, [key]: !notes[key] }))}
            onClick={characterClick}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerCancel}
          />
          {selectedCharacter && placements[selectedCharacter.id] && !tutorialActive && (
            <button type="button" className="shrink-0 text-left text-sm font-bold text-vs-accent underline-offset-4 hover:underline" onClick={() => unplace(selectedCharacter.id)}>
              {t("mystery001a.returnToTray", { name: selectedCharacter.name })}
            </button>
          )}
        </section>
        <aside className="hidden lg:block" aria-label={t("mystery001a.spatialTitle")}>
          <section className={`${surfaceCard} p-4`}>
            <h2 className="font-extrabold text-vs-fg">{t("mystery001a.spatialTitle")}</h2>
            <p className="mt-2 text-sm text-vs-fg-2">{t("mystery001a.directRight")}</p>
            <p className="mt-2 text-sm text-vs-fg-2">{t("mystery001a.higherRight")}</p>
            <p className="mt-2 text-sm text-vs-fg-2">{t("mystery001a.directAbove")}</p>
          </section>
        </aside>
      </div>

      <div className="mystery-action-bar z-30 w-full shrink-0 border-t border-vs-line bg-vs-elevated/95 px-3 pt-2 backdrop-blur" aria-label={t("mystery001a.gameActions")}>
        <div className="mx-auto flex w-full max-w-5xl items-center gap-1.5">
          <button type="button" className={`${secondaryButton} h-11 w-11 !px-0`} disabled={!canClear} onClick={clearBoard} aria-label={t("mystery001a.clearBoard")} title={t("mystery001a.clearBoard")}><Eraser className="h-4 w-4" aria-hidden /></button>
          <button type="button" className={`${secondaryButton} h-11 w-11 !px-0`} disabled={!canUndo} onClick={undoPlacement} aria-label={t("mystery001a.undo")} title={t("mystery001a.undo")}><Undo2 className="h-4 w-4" aria-hidden /></button>
          <button type="button" className={`${secondaryButton} h-11 w-11 !px-0`} disabled={hintLoading || hintBalance === 0} onClick={useHint} aria-label={t("mystery001a.useHint")} title={t("mystery001a.useHint")}><Lightbulb className="h-4 w-4" aria-hidden /></button>
          <button type="button" className={`${primaryButton} min-w-0 flex-1`} disabled={!canCheck || checking || boardAssetError} onClick={checkSolution}>
            {checking ? t("mystery001a.checking") : <><span className="hidden sm:inline">{t("mystery001a.check")}</span><span className="sm:hidden">{t("mystery001a.checkShort")}</span></>}
          </button>
        </div>
      </div>

      {drag && <DragPreview definition={definition} drag={drag} />}
      {wrongOpen && <BottomSheet title={t("mystery001a.wrongTitle")} onClose={() => setWrongOpen(false)}>
        <p className="text-vs-fg-2">{t("mystery001a.wrongText")}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" className={`${primaryButton} min-h-12`} onClick={() => setWrongOpen(false)}>{t("mystery001a.continue")}</button>
          <button type="button" className={`${secondaryButton} min-h-12`} disabled={hintLoading || hintBalance === 0} onClick={useHint}><Lightbulb className="h-4 w-4" aria-hidden />{hintLoading ? t("mystery001a.checking") : t("mystery001a.useHint")}</button>
        </div>
        {hintBalance !== null && <p className="mt-3 text-xs font-bold text-vs-fg-3">{hintBalance === 1 ? t("mystery001a.hintsLeftOne", { count: hintBalance }) : t("mystery001a.hintsLeftMany", { count: hintBalance })}</p>}
        {hintError && <p className="mt-2 text-sm font-bold text-vs-danger" role="alert">{hintError}</p>}
      </BottomSheet>}
      {hintKey && <BottomSheet title={t("mystery001a.hintTitle")} onClose={() => setHintKey(null)}>
        <p className="text-lg font-bold text-vs-fg">{t(hintKey)}</p>
        {hintBalance !== null && <p className="mt-2 text-xs font-bold text-vs-fg-3">{hintBalance === 1 ? t("mystery001a.hintsLeftOne", { count: hintBalance }) : t("mystery001a.hintsLeftMany", { count: hintBalance })}</p>}
        <button type="button" className={`${primaryButton} mt-5 min-h-12 w-full`} onClick={() => setHintKey(null)}>{t("mystery001a.continue")}</button>
      </BottomSheet>}
    </FocusLayout>
  );
}

export default function Mystery001aClient({ initialProgress, readerHref }: { initialProgress: MysteryProgressView; readerHref: string }) {
  return <MysteryClient initialProgress={initialProgress} readerHref={readerHref} definition={MYSTERY_001A} progressEndpoint="/api/mysteries/001a/progress" hintEndpoint="/api/mysteries/001/hint" />;
}

function initialCharacterClueNotes(definition: MysteryDefinition): Record<string, boolean> {
  return Object.fromEntries(definition.characters.flatMap((character) => characterCluesFor(definition, character.id).map((_, index) => [`${character.id}-${index}`, false]))) as Record<string, boolean>;
}

function MysteryBoard({ definition, geometry, placements, selected, dragTarget, constraintPulse, tutorialActive, boardRef, onBoardAssetError, characterAssetErrors, onCharacterAssetError, onCell, onCharacterClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: {
  definition: MysteryDefinition;
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
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const t = useT();
  const cells = useMemo(() => Array.from({ length: geometry.rows * geometry.columns }, (_, index) => ({ row: Math.floor(index / geometry.columns) + 1, column: index % geometry.columns + 1 })), [geometry]);
  const grid = gridNormalizedRect(geometry);
  const gridStyle = {
    left: `${grid.left * 100}%`, top: `${grid.top * 100}%`,
    width: `${grid.width * 100}%`, height: `${grid.height * 100}%`,
    gridTemplateColumns: `repeat(${geometry.columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${geometry.rows}, minmax(0, 1fr))`,
  };
  const metrics = characterImageMetrics(geometry);
  const showGrid = selected !== null || dragTarget !== null || tutorialActive || constraintPulse;
  const [debugGrid, setDebugGrid] = useState(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    // Alleen de ontwikkeloverlay leest de querystring na hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDebugGrid(new URLSearchParams(window.location.search).get("debugGrid") === "1");
  }, []);

  return (
    <div ref={boardRef} role="grid" aria-label={t("mystery001a.board")} aria-rowcount={geometry.rows} aria-colcount={geometry.columns} className="mystery-board-frame relative aspect-square w-full touch-none overflow-hidden rounded-2xl bg-vs-subtle shadow-sm select-none" style={{ aspectRatio: `${geometry.imageWidth} / ${geometry.imageHeight}` }}>
      {/* Het volledige vierkante bronbeeld blijft zichtbaar; geen object-cover of uitsnede. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={definition.assets.board} alt="" width={geometry.imageWidth} height={geometry.imageHeight} draggable={false} onError={onBoardAssetError} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
      <div
        className="absolute grid"
        style={gridStyle}
      >
        {cells.map((cell) => {
          const occupant = occupantAt(placements, cell);
          const valid = selected ? isHardConstraintValid(definition, placements, selected, cell) : true;
          const tutorialTarget = tutorialActive && definition.tutorial && sameCell(cell, definition.tutorial.cell);
          const pulsed = constraintPulse && definition.tutorial && (cell.row === definition.tutorial.cell.row || cell.column === definition.tutorial.cell.column) && !sameCell(cell, definition.tutorial.cell);
          const label = occupant ? t("mystery001a.cellOccupied", { row: cell.row, column: cell.column, name: definition.characters.find((character) => character.id === occupant)?.name ?? occupant }) : t("mystery001a.cellEmpty", { row: cell.row, column: cell.column });
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
      {debugGrid && (
        <div className="pointer-events-none absolute inset-0 z-40" aria-hidden>
          <div
            className="absolute border-2 border-fuchsia-500/90"
            style={{
              left: `${grid.left * 100}%`, top: `${grid.top * 100}%`,
              width: `${grid.width * 100}%`, height: `${grid.height * 100}%`,
            }}
          />
          <div
            className="absolute grid"
            style={gridStyle}
          >
            {cells.map((cell) => (
              <div key={`debug-${cell.row}-${cell.column}`} className="relative border border-fuchsia-400/70 bg-fuchsia-300/5">
                <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[9px] font-bold text-white">R{cell.row}C{cell.column}</span>
              </div>
            ))}
          </div>
          {cells.map((cell) => {
            const anchor = cellFootAnchor(cell, geometry);
            return <span key={`debug-anchor-${cell.row}-${cell.column}`} className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white bg-cyan-400" style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }} />;
          })}
          {definition.characters.map((character) => {
            const cell = placements[character.id];
            if (!cell) return null;
            const anchor = cellFootAnchor(cell, geometry);
            return <span key={`debug-foot-${character.id}`} className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-yellow-300" style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }} />;
          })}
        </div>
      )}
      {definition.characters.map((character) => {
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
            onPointerCancel={onPointerCancel}
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

function CharacterTray({ definition, trayRef, placements, selected, tutorialActive, clueNotes, characterAssetErrors, onCharacterAssetError, onToggleClue, onClick, onPointerDown, onPointerMove, onPointerUp, onPointerCancel }: {
  definition: MysteryDefinition;
  trayRef: React.RefObject<HTMLDivElement | null>;
  placements: Placements;
  selected: CharacterId | null;
  tutorialActive: boolean;
  clueNotes: Record<string, boolean>;
  characterAssetErrors: Partial<Record<CharacterId, true>>;
  onCharacterAssetError: (id: CharacterId) => void;
  onToggleClue: (key: string) => void;
  onClick: (id: CharacterId) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, id: CharacterId) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  const t = useT();
  return (
    <div ref={trayRef} className={`${surfaceCard} mystery-character-pane min-h-0 p-2.5`} aria-label={t("mystery001a.tray")}>
      <p className="mb-1.5 shrink-0 text-xs font-extrabold uppercase tracking-wider text-vs-fg-3">{t("mystery001a.tray")}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {definition.characters.map((character) => {
          const placed = Boolean(placements[character.id]);
          const disabled = placed || (tutorialActive && character.id !== definition.tutorial?.characterId);
          const clues = characterCluesFor(definition, character.id);
          return (
            <article key={character.id} className={`rounded-xl border p-2.5 transition ${placed ? "border-vs-line bg-vs-subtle/70" : "border-vs-line bg-vs-surface"}`}>
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`${character.name}, ${placed ? t("mystery001a.placedStatus") : t("mystery001a.dragCharacter")}`}
                  onPointerDown={(event) => onPointerDown(event, character.id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                  onClick={() => onClick(character.id)}
                  className={`flex h-12 w-12 shrink-0 touch-none items-center justify-center rounded-lg text-left transition disabled:cursor-default ${selected === character.id ? "ring-2 ring-vs-accent" : ""} ${focusRing}`}
                >
                  {/* Alleen het artwork start een touch-drag; tekst en status blijven rustig scroll- en leesbaar. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={character.asset} alt="" draggable={false} onError={() => onCharacterAssetError(character.id)} className={`pointer-events-none h-12 w-12 object-contain ${characterAssetErrors[character.id] ? "opacity-0" : ""} ${placed ? "opacity-55" : ""}`} />
                </button>
                <button type="button" disabled={disabled} onClick={() => onClick(character.id)} className={`min-w-0 flex-1 rounded-lg text-left ${focusRing}`} aria-label={`${character.name}${placed ? `, ${t("mystery001a.placedStatus")}` : ""}`}>
                  <span className="block truncate text-sm font-extrabold text-vs-fg">{character.name}</span>
                  <span className="block text-[11px] font-semibold text-vs-fg-3">{placed ? t("mystery001a.placedHint") : t("mystery001a.selectCharacter")}</span>
                </button>
                {placed && <span className="shrink-0 rounded-full bg-vs-subtle px-2 py-1 text-[11px] font-extrabold text-vs-fg-2">✓ {t("mystery001a.placedStatus")}</span>}
              </div>
              <div className="mt-2 space-y-1.5 border-t border-vs-line pt-2">
                {clues.map((clue, index) => {
                  const key = `${character.id}-${index}`;
                  const processed = Boolean(clueNotes[key]);
                  return (
                    <div key={key} className="rounded-lg bg-vs-subtle/60 p-2">
                      <p className="text-xs font-bold leading-snug text-vs-fg">{t(clue.textKey, clue.vars)}</p>
                      <button type="button" aria-pressed={processed} onClick={() => onToggleClue(key)} className={`mt-1 flex min-h-8 items-center gap-1.5 text-[11px] font-extrabold ${processed ? "text-vs-success" : "text-vs-fg-3"} ${focusRing}`}>
                        {processed ? <Check className="h-3.5 w-3.5" aria-hidden /> : <span className="h-3.5 w-3.5 rounded-full border border-current" aria-hidden />}
                        {t(processed ? "mystery001a.processed" : "mystery001a.unprocessed")}
                      </button>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
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

function DragPreview({ definition, drag }: { definition: MysteryDefinition; drag: DragState }) {
  const character = definition.characters.find((item) => item.id === drag.characterId)!;
  return (
    <div className="pointer-events-none fixed z-[70] h-24 w-24 -translate-x-1/2 -translate-y-1/2" style={{ left: drag.x, top: drag.y }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={character.asset} alt="" className="h-full w-full object-contain drop-shadow-xl" />
    </div>
  );
}

type ClosingState = { answer?: number; dismissed?: boolean };
const CLOSING_STATE_PREFIX = "versado.mystery.closing.";

function closingStorageKey(id: string): string {
  return `${CLOSING_STATE_PREFIX}${id}`;
}

function rememberClosingState(id: string, state: ClosingState): void {
  try {
    window.sessionStorage.setItem(closingStorageKey(id), JSON.stringify(state));
  } catch {
    // Privémodus mag de resultaatsflow niet blokkeren.
  }
}

function readClosingState(id: string): ClosingState | null {
  try {
    const raw = window.sessionStorage.getItem(closingStorageKey(id));
    return raw ? JSON.parse(raw) as ClosingState : null;
  } catch {
    return null;
  }
}

function forgetClosingState(id: string): void {
  try {
    window.sessionStorage.removeItem(closingStorageKey(id));
  } catch {
    // Zie rememberClosingState().
  }
}

function withReturnContext(href: string, returnTo: string): string {
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}returnTo=${encodeURIComponent(returnTo)}`;
}
