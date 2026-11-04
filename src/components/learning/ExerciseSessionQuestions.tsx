"use client";
// De bestaande vraagpresentatie, los van webreader/navigatie. De adapter
// levert controle/inzending; de server blijft de enige beoordelaar.
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/components/I18nProvider";
import type { TFunction } from "@/lib/i18n/core";
import { normalizeAnswer } from "@/lib/exerciseGen";
import type { ExerciseCheckpoint } from "@/lib/learning/exerciseCheckpoint";
import type { ExerciseFeedbackContext } from "@/lib/exerciseFeedback";
import { exerciseProgress } from "@/lib/exerciseProgress";
import FocusLayout from "@/components/versado/FocusLayout";
import PersonalMascot from "@/components/versado/PersonalMascot";
import ExerciseFeedbackSheet from "@/components/ExerciseFeedbackSheet";
import { Flag, CheckCircle2, XCircle } from "lucide-react";
export type ExerciseType =
  | "FILL_BLANK"
  | "WORD_BANK"
  | "TRUE_FALSE"
  | "MULTIPLE_CHOICE"
  | "SEQUENCE"
  | "IMAGE_CHOICE";

export interface Exercise {
  id: string;
  type: ExerciseType;
  verseRef: string;
  prompt: string;
  hint?: string;
  blanks: number;
  wordBank?: string[];
  options?: string[];
}

export interface SubmittedAnswer {
  exerciseId: string;
  given: string[];
  correct: boolean;
}

export function ExerciseSessionQuestions<Result>({
  exercises,
  review,
  submit,
  onComplete,
  onCheck,
  feedbackContext,
  groupForIndex,
  initialCheckpoint,
  onCheckpoint,
  onSkipRemaining,
  retryCheckErrors = false,
  showHint = true,
}: {
  exercises: Exercise[];
  showHint?: boolean;
  review: boolean;
  submit: (answers: SubmittedAnswer[]) => Promise<Result>;
  onComplete: (result: Result) => void;
  onCheck?: (
    exercise: Exercise,
    given: string[],
  ) => Promise<{ correct: boolean; correctAnswer: string[] | null }>;
  feedbackContext?: (exercise: Exercise) => ExerciseFeedbackContext;
  groupForIndex?: (index: number) => string;
  initialCheckpoint?: ExerciseCheckpoint | null;
  onCheckpoint?: (checkpoint: ExerciseCheckpoint) => void;
  /** CFM: verder lezen met behoud van de nog niet ingeleverde vragenset. */
  onSkipRemaining?: () => void;
  retryCheckErrors?: boolean;
}) {
  const t = useT();
  const [index, setIndex] = useState(initialCheckpoint?.index ?? 0),
    [answers, setAnswers] = useState<SubmittedAnswer[]>(
      initialCheckpoint?.answers ?? [],
    );
  const [reviewQueue, setReviewQueue] = useState<string[] | null>(
      initialCheckpoint?.reviewQueue ?? null,
    ),
    [reviewPos, setReviewPos] = useState(initialCheckpoint?.reviewPos ?? 0);
  const [pending, setPending] = useState<SubmittedAnswer[] | null>(
      initialCheckpoint?.pending ?? null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(
      initialCheckpoint?.pending ? t("apiErrors.notSaved") : null,
    );
  useEffect(() => {
    onCheckpoint?.({ index, answers, reviewQueue, reviewPos, pending });
  }, [index, answers, reviewQueue, reviewPos, pending, onCheckpoint]);
  const current = reviewQueue
    ? exercises.find((e) => e.id === reviewQueue[reviewPos])
    : exercises[index];
  async function finish(final: SubmittedAnswer[]) {
    if (busy) return;
    setPending(final);
    setBusy(true);
    setError(null);
    try {
      onComplete(await submit(final));
    } catch (e) {
      setError(
        e instanceof Error &&
          !(e instanceof TypeError) &&
          !(e instanceof SyntaxError)
          ? e.message
          : t("courses.error"),
      );
    } finally {
      setBusy(false);
    }
  }
  function advance(final: SubmittedAnswer[]) {
    if (reviewQueue) {
      if (reviewPos + 1 < reviewQueue.length) setReviewPos(reviewPos + 1);
      else void finish(final);
    } else if (index + 1 < exercises.length) setIndex(index + 1);
    else {
      const wrong = review
        ? final.filter((a) => !a.correct).map((a) => a.exerciseId)
        : [];
      if (wrong.length) {
        setReviewQueue(wrong);
        setReviewPos(0);
      } else void finish(final);
    }
  }
  function done(given: string[], correct: boolean) {
    if (!current) return;
    const final = reviewQueue
      ? answers.map((a) =>
          a.exerciseId === current.id ? { ...a, given, correct } : a,
        )
      : [...answers, { exerciseId: current.id, given, correct }];
    setAnswers(final);
    advance(final);
  }
  return (
    <FocusLayout className="max-w-2xl gap-6">
      {groupForIndex && !reviewQueue && (
        <p className="font-bold text-vs-fg" data-exercise-group>
          {groupForIndex(index)}
        </p>
      )}
      {reviewQueue && !pending && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-extrabold">
              {t("lesson.reviewTitle", {
                pos: reviewPos + 1,
                total: reviewQueue.length,
              })}
            </h2>
            <button
              className="btn-secondary !px-3"
              disabled={busy}
              onClick={() => void finish(answers)}
            >
              {t("lesson.skipAll")}
            </button>
          </div>
          <p className="text-sm text-vs-fg-2">{t("lesson.reviewHint")}</p>
        </>
      )}
      {!pending && current && (
        <ExerciseCard
          key={(reviewQueue ? "review:" : "question:") + current.id}
          exercise={current}
          onDone={done}
          onSkip={reviewQueue ? () => advance(answers) : onSkipRemaining}
          disabled={busy}
          focus
          progress={{
            current: reviewQueue ? reviewPos : index,
            total: reviewQueue ? reviewQueue.length : exercises.length,
          }}
          onCheck={onCheck ? (given) => onCheck(current, given) : undefined}
          retryCheckErrors={retryCheckErrors}
          showHint={showHint}
          feedbackContext={feedbackContext?.(current)}
        />
      )}
      {busy && <p role="status">{t("courses.busy")}</p>}
      {error && (
        <div role="alert">
          <p className="text-vs-danger">{error}</p>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => pending && void finish(pending)}
          >
            {t("studyReader.retry")}
          </button>
        </div>
      )}
    </FocusLayout>
  );
}

function formatCorrectAnswer(
  type: Exercise["type"],
  correctAnswer: string[],
  t: TFunction,
): string {
  if (type === "TRUE_FALSE")
    return correctAnswer[0] === "true" ? t("lesson.true") : t("lesson.false");
  return correctAnswer.join(" ");
}

function HintControl({
  exercise,
  checked,
}: {
  exercise: Exercise;
  checked: boolean;
}) {
  const t = useT();
  const [hint, setHint] = useState<string | null>(null);
  const [hintCredits, setHintCredits] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/hints")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.hintBalance === "number")
          setHintCredits(data.hintBalance);
      })
      .catch(() => {});
  }, []);

  async function showHint() {
    if (loading || checked || hint) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/exercises/${exercise.id}/hint`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(
          typeof data.error === "string" ? data.error : t("lesson.hintFailed"),
        );
        return;
      }
      setHint(typeof data.hint === "string" ? data.hint : null);
      setHintCredits(
        typeof data.hintBalance === "number" ? data.hintBalance : hintCredits,
      );
    } catch {
      setError(t("lesson.hintFailed"));
    } finally {
      setLoading(false);
    }
  }

  if (hint) {
    return (
      <div className="rounded-2xl bg-gold-50 dark:bg-slate-700 px-4 py-3">
        <p className="font-extrabold text-gold-700 dark:text-gold-300">
          💡 {t("lesson.hint")}
        </p>
        <p className="text-sm text-gold-700/90 dark:text-gold-200 mt-1">
          {hint}
        </p>
        {hintCredits !== null && (
          <p className="text-xs text-gold-600 dark:text-gold-300 mt-2 font-bold">
            {hintCredits === 1
              ? t("lesson.hintsLeftOne", { n: hintCredits })
              : t("lesson.hintsLeftMany", { n: hintCredits })}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        className="btn-secondary self-start"
        disabled={loading || checked || hintCredits === 0}
        onClick={showHint}
      >
        {loading
          ? t("lesson.hintLoading")
          : `💡 ${t("lesson.hint")}${hintCredits === null ? "" : ` · ${hintCredits}`}`}
      </button>
      {error && (
        <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

export function ExerciseCard({
  exercise,
  onDone,
  onSkip,
  disabled,
  checkEndpoint,
  onCheck,
  showHint = true,
  retryCheckErrors = false,
  focus = false,
  progress,
  feedbackContext,
}: {
  exercise: Exercise;
  onDone: (given: string[], correct: boolean) => void;
  onSkip?: () => void;
  disabled: boolean;
  /** Standaard /api/exercises/{id}/check — voor bv. podcastoefeningen kan een ander endpoint meegegeven worden. */
  checkEndpoint?: string;
  /** Eigen controle in plaats van een endpoint, bv. via de socket bij Samen studeren (daar telt ook het tijdstip). */
  onCheck?: (
    given: string[],
  ) => Promise<{ correct: boolean; correctAnswer: string[] | null }>;
  /** Hints uit bij een wedstrijd tegen anderen, waar iedereen gelijke kansen moet hebben. */
  showHint?: boolean;
  /** Optioneel: verbindingsfouten bewaren het antwoord voor opnieuw controleren. */
  retryCheckErrors?: boolean;
  /** Een actieve focusflow gebruikt de pagina zelf als canvas i.p.v. een buitenkaart. */
  focus?: boolean;
  /** Progressie binnen deze uitgedeelde oefenset/stap. */
  progress?: { current: number; total: number };
  /** Server-gevalideerde context voor de gedeelde vraagfeedback. */
  feedbackContext?: ExerciseFeedbackContext;
}) {
  const t = useT();
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(false);
  const [wasCorrect, setWasCorrect] = useState(false);
  const [correctAnswer, setCorrectAnswer] = useState<string[] | null>(null);
  const [givenAnswer, setGivenAnswer] = useState<string[]>([]);
  const [choice, setChoice] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ word: string; poolIndex: number }[]>(
    [],
  );
  const [trueFalseAnswer, setTrueFalseAnswer] = useState<
    "true" | "false" | null
  >(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);

  const pool = useMemo(() => exercise.wordBank ?? [], [exercise]);
  const availablePool = pool
    .map((word, poolIndex) => ({ word, poolIndex }))
    .filter(({ poolIndex }) => !placed.some((p) => p.poolIndex === poolIndex));

  const promptParts = exercise.prompt.split(/____/);

  const canCheck =
    exercise.type === "FILL_BLANK" ||
    exercise.type === "MULTIPLE_CHOICE" ||
    exercise.type === "IMAGE_CHOICE"
      ? choice !== null
      : exercise.type === "TRUE_FALSE"
        ? trueFalseAnswer !== null
        : placed.length === exercise.blanks;

  async function check() {
    if (checking || checked) return;
    const given =
      exercise.type === "FILL_BLANK" ||
      exercise.type === "MULTIPLE_CHOICE" ||
      exercise.type === "IMAGE_CHOICE"
        ? [choice ?? ""]
        : exercise.type === "TRUE_FALSE"
          ? [trueFalseAnswer ?? "true"]
          : placed.map((p) => p.word);

    setChecking(true);
    setCheckError(false);
    let failed = false;
    try {
      if (onCheck) {
        const result = await onCheck(given);
        setWasCorrect(result.correct);
        setCorrectAnswer(result.correctAnswer);
        setGivenAnswer(given);
        return;
      }
      const res = await fetch(
        checkEndpoint ?? `/api/exercises/${exercise.id}/check`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ given }),
        },
      );
      const data = await res.json();
      setWasCorrect(Boolean(data.correct));
      setCorrectAnswer(
        Array.isArray(data.correctAnswer) ? data.correctAnswer : null,
      );
      setGivenAnswer(given);
    } catch {
      if (retryCheckErrors) {
        failed = true;
        setCheckError(true);
        return;
      }
      setWasCorrect(false);
      setCorrectAnswer(null);
      setGivenAnswer(given);
    } finally {
      setChecking(false);
      if (!failed) setChecked(true);
    }
  }

  function next() {
    onDone(givenAnswer, wasCorrect);
  }

  const mascotReaction = (
    <ExerciseMascotReaction checked={checked} correct={wasCorrect} />
  );
  const surfaceClass = focus
    ? "flex min-h-[calc(100dvh-var(--header-height,var(--header-default))-2rem)] flex-col gap-5"
    : "card flex flex-col gap-5";
  const givenFeedbackContext = feedbackContext
    ? { ...feedbackContext, givenAnswer }
    : undefined;
  const progressState = progress
    ? exerciseProgress(progress.current, progress.total, checked)
    : null;

  const actionArea = (
    <>
      {checkError && (
        <p role="alert" className="text-sm text-vs-danger">
          {t("courses.error")}
        </p>
      )}
      <ExerciseActionArea
        focus={focus}
        checked={checked}
        wasCorrect={wasCorrect}
        correctAnswer={correctAnswer}
        exerciseType={exercise.type}
        feedbackContext={givenFeedbackContext}
        feedbackSent={feedbackSent}
        onOpenFeedback={() => setFeedbackOpen(true)}
        onCheck={check}
        onNext={next}
        onSkip={onSkip}
        checking={checking}
        canCheck={canCheck}
        disabled={disabled}
      />
    </>
  );

  const progressHeader = progressState && (
    <div
      className="sticky top-[var(--header-offset,var(--header-default))] z-10 -mx-1 bg-vs-app/95 py-2 backdrop-blur sm:-mx-2"
      data-exercise-progress
    >
      <div className="mb-1 flex items-center justify-between gap-3 text-xs font-extrabold uppercase tracking-wide text-vs-fg-3">
        <span>{t("lesson.exerciseProgress")}</span>
        <span>
          {progressState.answered}/{progressState.total}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-vs-line"
        aria-label={`${progressState.answered}/${progressState.total}`}
      >
        <div
          className="h-full rounded-full bg-vs-accent transition-[width] duration-500 motion-reduce:transition-none"
          style={{ width: `${progressState.percent}%` }}
        />
      </div>
    </div>
  );

  const feedbackSheet = feedbackOpen && givenFeedbackContext && (
    <ExerciseFeedbackSheet
      context={givenFeedbackContext}
      onClose={() => setFeedbackOpen(false)}
      onSubmitted={() => {
        setFeedbackOpen(false);
        setFeedbackSent(true);
      }}
    />
  );

  if (exercise.type === "TRUE_FALSE") {
    return (
      <div className={surfaceClass}>
        {progressHeader}
        <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
          {exercise.verseRef}
        </p>
        {showHint && <HintControl exercise={exercise} checked={checked} />}
        {mascotReaction}
        <p className="text-xl leading-relaxed dark:text-slate-100">
          {exercise.prompt}
        </p>
        <div className="flex gap-3">
          {(["true", "false"] as const).map((value) => {
            const isCorrectValue = checked && correctAnswer?.[0] === value;
            const isWrongPick =
              checked && trueFalseAnswer === value && !isCorrectValue;
            return (
              <button
                key={value}
                disabled={checked || checking || disabled}
                onClick={() => setTrueFalseAnswer(value)}
                className={`btn flex-1 border-2 ${
                  isCorrectValue
                    ? "bg-brand-500 text-white border-brand-500"
                    : isWrongPick
                      ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 border-red-400"
                      : trueFalseAnswer === value
                        ? "bg-brand-500 text-white border-brand-500"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600"
                }`}
              >
                {value === "true"
                  ? `✅ ${t("lesson.true")}`
                  : `❌ ${t("lesson.false")}`}
              </button>
            );
          })}
        </div>
        {actionArea}
        {feedbackSheet}
      </div>
    );
  }

  if (exercise.type === "FILL_BLANK") {
    const options = exercise.options ?? [];

    // Oudere content (van vóór keuzeopties bestonden) heeft geen opties —
    // nooit een doodlopende weg tonen, gewoon doorlaten zonder score.
    if (options.length === 0) {
      return (
        <div className={surfaceClass}>
          {progressHeader}
          <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
            {exercise.verseRef}
          </p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("lesson.outdated")}
          </p>
          <button
            className="btn-primary self-end"
            disabled={disabled}
            onClick={() => onDone([""], false)}
          >
            {t("lesson.continue")}
          </button>
        </div>
      );
    }

    return (
      <div className={surfaceClass}>
        {progressHeader}
        <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
          {exercise.verseRef}
        </p>
        {showHint && <HintControl exercise={exercise} checked={checked} />}
        {mascotReaction}
        <p className="text-xl leading-relaxed dark:text-slate-100">
          {promptParts.map((part, i) => (
            <span key={i}>
              {part}
              {i < promptParts.length - 1 && (
                <span className="inline-block mx-1 px-3 py-0.5 rounded-lg border-b-2 border-dashed border-brand-400 font-bold text-brand-500 dark:text-brand-300">
                  {checked ? (choice ?? "…") : "____"}
                </span>
              )}
            </span>
          ))}
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-3">
          {options.map((opt) => {
            const isCorrectOption =
              checked &&
              correctAnswer &&
              normalizeAnswer(opt) === normalizeAnswer(correctAnswer[0] ?? "");
            const isWrongPick = checked && choice === opt && !isCorrectOption;
            return (
              <button
                key={opt}
                disabled={checked || checking || disabled}
                onClick={() => setChoice(opt)}
                className={`btn text-left border-2 ${
                  isCorrectOption
                    ? "bg-brand-500 text-white border-brand-500"
                    : isWrongPick
                      ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 border-red-400"
                      : choice === opt
                        ? "bg-brand-500 text-white border-brand-500"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:border-brand-300"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
        {actionArea}
        {feedbackSheet}
      </div>
    );
  }

  if (exercise.type === "MULTIPLE_CHOICE") {
    const options = exercise.options ?? [];
    return (
      <div className={surfaceClass}>
        {progressHeader}
        <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
          {exercise.verseRef}
        </p>
        {showHint && <HintControl exercise={exercise} checked={checked} />}
        {mascotReaction}
        <p className="text-xl leading-relaxed dark:text-slate-100">
          {exercise.prompt}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {options.map((opt) => {
            const isCorrectOption =
              checked &&
              correctAnswer &&
              normalizeAnswer(opt) === normalizeAnswer(correctAnswer[0] ?? "");
            const isWrongPick = checked && choice === opt && !isCorrectOption;
            return (
              <button
                key={opt}
                disabled={checked || checking || disabled}
                onClick={() => setChoice(opt)}
                className={`btn text-left border-2 ${
                  isCorrectOption
                    ? "bg-brand-500 text-white border-brand-500"
                    : isWrongPick
                      ? "bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 border-red-400"
                      : choice === opt
                        ? "bg-brand-500 text-white border-brand-500"
                        : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-600 hover:border-brand-300"
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
        {actionArea}
        {feedbackSheet}
      </div>
    );
  }

  if (exercise.type === "IMAGE_CHOICE") {
    const options = exercise.options ?? [];
    return (
      <div className={surfaceClass}>
        {progressHeader}
        <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
          {exercise.verseRef}
        </p>
        {showHint && <HintControl exercise={exercise} checked={checked} />}
        {mascotReaction}
        <p className="text-xl leading-relaxed dark:text-slate-100">
          {exercise.prompt}
        </p>
        <div className="grid grid-cols-2 gap-3">
          {options.map((opt) => {
            const isCorrectOption =
              checked &&
              correctAnswer &&
              normalizeAnswer(opt) === normalizeAnswer(correctAnswer[0] ?? "");
            const isWrongPick = checked && choice === opt && !isCorrectOption;
            return (
              <button
                key={opt}
                disabled={checked || checking || disabled}
                onClick={() => setChoice(opt)}
                className={`rounded-2xl overflow-hidden border-4 transition ${
                  isCorrectOption
                    ? "border-brand-500"
                    : isWrongPick
                      ? "border-red-400"
                      : choice === opt
                        ? "border-brand-500"
                        : "border-transparent hover:border-brand-300"
                }`}
              >
                {/* Bestaande web-afbeeldingskeuze; geen Next-afhankelijkheid in de gedeelde kaart. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={opt} alt="" className="w-full h-auto block" />
              </button>
            );
          })}
        </div>
        {actionArea}
        {feedbackSheet}
      </div>
    );
  }

  // WORD_BANK / SEQUENCE — zelfde mechaniek (items in de juiste volgorde
  // aantikken), SEQUENCE gebruikt alleen langere zinnen i.p.v. losse woorden.
  return (
    <div className={surfaceClass}>
      {progressHeader}
      <p className="text-xs font-bold uppercase text-slate-400 dark:text-slate-500">
        {exercise.verseRef}
      </p>
      {showHint && <HintControl exercise={exercise} checked={checked} />}
      {mascotReaction}
      <p className="text-xl leading-relaxed dark:text-slate-100">
        {exercise.prompt}
      </p>

      <div className="flex flex-wrap gap-2 min-h-[3rem] p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-700">
        {placed.length === 0 && (
          <span className="text-slate-400 dark:text-slate-500 text-sm">
            {exercise.type === "SEQUENCE"
              ? t("lesson.tapEvents")
              : t("lesson.tapWords")}
          </span>
        )}
        {placed.map((p, i) => (
          <button
            key={i}
            disabled={checked || checking || disabled}
            onClick={() => setPlaced(placed.filter((_, idx) => idx !== i))}
            className="rounded-xl bg-brand-500 text-white px-3 py-1.5 font-bold"
          >
            {p.word}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {availablePool.map(({ word, poolIndex }) => (
          <button
            key={poolIndex}
            disabled={checked || checking || disabled}
            onClick={() => setPlaced([...placed, { word, poolIndex }])}
            className="rounded-xl bg-white dark:bg-slate-800 dark:text-slate-100 border-2 border-slate-200 dark:border-slate-600 px-3 py-1.5 font-bold hover:border-brand-300"
          >
            {word}
          </button>
        ))}
      </div>

      {actionArea}
      {feedbackSheet}
    </div>
  );
}

function ExerciseMascotReaction({
  checked,
  correct,
}: {
  checked: boolean;
  correct: boolean;
}) {
  const state = checked ? (correct ? "success" : "encourage") : "thinking";
  return (
    <div className="mx-auto aspect-square w-16 shrink-0 sm:w-20">
      <PersonalMascot state={state} size={96} fill />
    </div>
  );
}

export function LessonResultMascot({
  scorePercent,
  celebrate = false,
  successThreshold = 50,
}: {
  scorePercent: number;
  celebrate?: boolean;
  successThreshold?: number;
}) {
  const state = celebrate
    ? "celebrate"
    : scorePercent >= successThreshold
      ? "success"
      : "encourage";
  return (
    <div className="aspect-square w-[clamp(110px,30vw,8.125rem)] shrink-0 sm:w-36 vs-decor">
      <PersonalMascot state={state} size={144} fill />
    </div>
  );
}

function ExerciseActionArea({
  checked,
  checking,
  canCheck,
  disabled,
  onCheck,
  onNext,
  onSkip,
  focus,
  wasCorrect,
  correctAnswer,
  exerciseType,
  feedbackContext,
  feedbackSent,
  onOpenFeedback,
}: {
  checked: boolean;
  checking: boolean;
  canCheck: boolean;
  disabled: boolean;
  onCheck: () => void;
  onNext: () => void;
  onSkip?: () => void;
  focus: boolean;
  wasCorrect: boolean;
  correctAnswer: string[] | null;
  exerciseType: Exercise["type"];
  feedbackContext?: ExerciseFeedbackContext & { givenAnswer: string[] };
  feedbackSent: boolean;
  onOpenFeedback: () => void;
}) {
  const t = useT();
  return (
    <div
      className={
        focus
          ? "sticky bottom-0 z-20 -mx-4 mt-auto border-t border-vs-line bg-vs-elevated/95 px-4 pt-3 pb-[max(1rem,var(--vs-safe-area-bottom))] backdrop-blur sm:-mx-2 sm:px-2"
          : "mt-2"
      }
      data-exercise-action-area
    >
      {checked && (
        <div className="mb-3" aria-live="polite">
          <div
            className={`flex items-center justify-between gap-3 rounded-2xl px-3 py-2 font-extrabold ${wasCorrect ? "bg-vs-success-soft text-vs-success" : "bg-vs-danger-soft text-vs-danger"}`}
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              {wasCorrect ? (
                <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
              ) : (
                <XCircle className="h-5 w-5 shrink-0" aria-hidden />
              )}
              {wasCorrect ? t("lesson.correctTitle") : t("lesson.wrongTitle")}
            </span>
            {feedbackContext && (
              <button
                type="button"
                onClick={onOpenFeedback}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-current/70 hover:bg-black/5 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
                aria-label={t("feedback.exercise.reportQuestion")}
              >
                <Flag className="h-4 w-4" aria-hidden />
              </button>
            )}
          </div>
          {!wasCorrect && (
            <p className="mt-2 px-1 text-sm font-semibold text-vs-fg-2">
              {exerciseType === "IMAGE_CHOICE"
                ? t("lesson.wrongImage")
                : t("lesson.wrongAnswer", {
                    answer: formatCorrectAnswer(
                      exerciseType,
                      correctAnswer ?? [],
                      t,
                    ),
                  })}
            </p>
          )}
          {feedbackSent && (
            <p
              className="mt-2 px-1 text-sm font-bold text-vs-success"
              role="status"
            >
              {t("feedback.exercise.sent")}
            </p>
          )}
        </div>
      )}
      {!checked ? (
        <div className="flex flex-wrap items-center gap-3">
          {onSkip ? (
            <button
              className="text-sm font-bold text-vs-fg-3 hover:text-vs-fg"
              disabled={disabled}
              onClick={onSkip}
            >
              {t("lesson.skip")}
            </button>
          ) : null}
          <button
            className={`${focus ? "w-full !px-2" : "ml-auto"} btn-primary min-h-12`}
            disabled={!canCheck || disabled || checking}
            onClick={onCheck}
          >
            {checking ? t("lesson.checking") : t("lesson.check")}
          </button>
        </div>
      ) : (
        <button
          className={`btn-primary min-h-12 w-full animate-pop ${focus ? "!px-2" : ""}`}
          disabled={disabled}
          onClick={onNext}
        >
          {disabled ? t("courses.busy") : t("lesson.continue")}
        </button>
      )}
    </div>
  );
}
