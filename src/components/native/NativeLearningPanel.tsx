"use client";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useNativeData } from "@/lib/data/nativeHooks";
import {
  type NativeLearningFlow,
  type LearningFlowState,
} from "@/lib/native/learningFlow";
import type { NativeReader } from "@/lib/native/readerContract";
import { nativeRoute } from "@/lib/native/navigation";
import { useAppNavigation } from "@/components/navigation/AppNavigation";
import { useT } from "@/components/I18nProvider";
import { useConfirm } from "@/components/ConfirmProvider";
import { useReadAloudPlayer } from "@/lib/readAloudPlayerContext";
import { ExerciseSessionQuestions } from "@/components/learning/ExerciseSessionQuestions";
import { SummaryScreen } from "@/components/learning/LessonSummary";
import ReadingCompletionSummary from "@/components/learning/ReadingCompletionSummary";
import { chapterTerm } from "@/lib/chapterTerm";
import { focusNativeRouteHeading } from "@/lib/native/routeFocus";
import { requestScrollRestore } from "@/lib/scrollRestore";
import { currentEntryKey } from "@/lib/navigationEntry";
import type { NativeLearningOutcome } from "@/lib/native/learningContract";

const noSubscribe = () => () => {},
  noSnapshot = () => null;
export function useNativeLearningFlow(
  reader: NativeReader | undefined,
  enabled: boolean,
) {
  const runtime = useNativeData();
  const flow = useMemo(
    () => (reader && enabled ? runtime.learningFlow(reader) : null),
    [runtime, reader, enabled],
  );
  const state = useSyncExternalStore(
    flow?.subscribe ?? noSubscribe,
    flow?.snapshot ?? noSnapshot,
    noSnapshot,
  );
  return { flow, state };
}
/** Vervolg komt uitsluitend uit de bevestigde servercursor, nooit uit een
 * clientberekening of het eerste hoofdstuk van de collectie. */
export function nativeLearningNext(
  reader: NativeReader,
  outcome: NativeLearningOutcome | null,
) {
  if (!outcome) return null;
  const next =
    reader.kind === "steps"
      ? "nextLessonId" in outcome
        ? outcome.nextLessonId
        : null
      : "nextChapterId" in outcome
        ? outcome.nextChapterId
        : null;
  if (
    typeof next !== "string" ||
    next === reader.targetId ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(next)
  )
    return null;
  return nativeRoute(`/courses/${reader.courseId}/read/${reader.kind}/${next}`);
}
type Props = {
  flow: NativeLearningFlow;
  state: LearningFlowState;
  reader: NativeReader;
  mode: "steps" | "FREE_CHOICE" | "FRONT_TO_BACK";
  onError: (error: unknown) => void;
};
export default function NativeLearningPanel({
  flow,
  state,
  reader,
  mode,
  onError,
}: Props) {
  const t = useT(),
    navigation = useAppNavigation(),
    confirm = useConfirm(),
    audio = useReadAloudPlayer();
  const path = `/courses/${reader.courseId}/pad`;
  const run = async (action: () => Promise<unknown>) => {
    audio.stop();
    try {
      await action();
    } catch {
      /* De sessiegebonden flow houdt de fout en oorspronkelijke poging vast. */
    }
  };
  useEffect(() => {
    if (state.denial) onError(state.denial);
  }, [state.denial, onError]);
  useEffect(
    () =>
      navigation.registerNavigationGuard?.(() => {
        if (!state.pending && !state.busy) return true;
        void confirm(t("nativeLearningFlow.pendingNavigation"), {
          native: true,
          notice: true,
          title: t("nativeLearningFlow.result"),
          confirmLabel: t("common.close"),
        });
        return false;
      }),
    [navigation, state.pending, state.busy, confirm, t],
  );
  const index = state.checkpoint?.reviewQueue
    ? state.checkpoint.reviewPos
    : state.checkpoint?.index;
  useEffect(() => {
    if (state.phase === "read") return;
    requestScrollRestore(currentEntryKey(), "explicit", () => 0, true);
    return focusNativeRouteHeading();
  }, [state.phase, index]);
  const submit = useCallback(
    async (answers: { exerciseId: string; given: string[] }[]) => {
      try {
        return await flow.submit(
          answers.map(({ exerciseId, given }) => ({ exerciseId, given })),
        );
      } catch {
        throw new Error(t("nativeLearningFlow.uncertain"));
      }
    },
    [flow, t],
  );
  const toPath = (
    <button
      className="btn-secondary"
      disabled={state.busy || !!state.pending}
      onClick={() => navigation.replace(path)}
    >
      {t("nativeLearningFlow.toPath")}
    </button>
  );
  const retry = state.error && (
    <div role="alert" className="space-y-3">
      <p>
        {t(
          state.pending
            ? "nativeLearningFlow.uncertain"
            : "nativeLearningFlow.error",
        )}
      </p>
      <button
        className="btn-primary"
        disabled={state.busy}
        onClick={() =>
          void run(state.phase === "blocked" ? flow.restart : flow.retry)
        }
      >
        {t(
          state.pending
            ? "nativeLearningFlow.recover"
            : "nativeFoundation.retry",
        )}
      </button>
    </div>
  );
  if (state.phase === "read")
    return (
      <div
        data-native-learning-actions
        className="flex flex-col items-start gap-3"
      >
        <div className="flex flex-wrap gap-3">
          {mode === "steps" ? (
            <button
              className="btn-primary"
              disabled={state.busy || !!state.pending}
              onClick={() => void run(flow.start)}
            >
              {t("nativeLearningFlow.next")}
            </button>
          ) : (
            <>
              <button
                className="btn-primary"
                disabled={state.busy || !!state.pending}
                onClick={() => void run(flow.read)}
              >
                {t("progress.markRead")}
              </button>
              {mode === "FREE_CHOICE" && (
                <button
                  className="btn-secondary"
                  disabled={state.busy || !!state.pending}
                  onClick={() => void run(flow.start)}
                >
                  {t("readingLesson.toQuestions")}
                </button>
              )}
            </>
          )}
        </div>
        {state.busy && <p role="status">{t("courses.busy")}</p>}
        {retry}
      </div>
    );
  const outcome =
    state.phase === "result"
      ? state.session?.outcome
      : state.readReceipt?.outcome;
  const next = nativeLearningNext(reader, outcome ?? null);
  const nextAction = next && (
    <button
      className="btn-primary"
      disabled={state.busy || !!state.pending}
      onClick={() => navigation.replace(next)}
    >
      {t(
        reader.kind === "steps"
          ? "readingLesson.nextStep"
          : "nativeReader.next",
      )}
    </button>
  );
  const canPractice =
    reader.kind === "chapters" &&
    (!state.session || state.session.exercises.length > 0);
  return (
    <section
      data-native-learning-phase={state.phase}
      className="flex min-w-0 flex-col gap-4"
    >
      <h1 tabIndex={-1} className="sr-only">
        {t(
          state.phase === "questions"
            ? "nativeLearningFlow.questions"
            : "nativeLearningFlow.result",
        )}
      </h1>
      {state.phase === "questions" && state.session && (
        <ExerciseSessionQuestions
          exercises={state.session.exercises}
          review={reader.kind !== "steps"}
          showHint={false}
          retryCheckErrors
          onCheck={(exercise, given) => flow.check(exercise.id, given)}
          submit={submit}
          onComplete={() => {}}
          initialCheckpoint={state.checkpoint}
          onCheckpoint={flow.checkpoint}
        />
      )}
      {state.phase === "result" && outcome && "xpEarned" in outcome && (
        <SummaryScreen
          summary={outcome}
          successThreshold={reader.kind === "steps" ? 60 : 50}
          nextChapterId={null}
          term={chapterTerm(null)}
          streakContinuation={
            <p className="font-bold">
              {t(
                outcome.currentStreak === 1
                  ? "nativeLearningFlow.streakOne"
                  : "nativeLearningFlow.streak",
                { n: outcome.currentStreak },
              )}
            </p>
          }
          actions={
            <>
              {toPath}
              {nextAction}
              {reader.kind === "chapters" &&
                outcome.content.read !== "READ" && (
                  <button
                    className="btn-primary"
                    disabled={state.busy || !!state.pending}
                    onClick={() => void run(flow.read)}
                  >
                    {t("progress.markRead")}
                  </button>
                )}
              {reader.kind === "chapters" && (
                <button
                  className="btn-secondary"
                  disabled={state.busy || !!state.pending}
                  onClick={() => void run(flow.start)}
                >
                  {t("progress.practiceAgain", { n: outcome.total })}
                </button>
              )}
            </>
          }
        />
      )}
      {(state.phase === "read-result" ||
        (state.phase === "empty" && state.readReceipt)) && (
        <ReadingCompletionSummary
          heading={reader.kind === "chapters" ? t("progress.read") : undefined}
          description={
            reader.kind === "chapters" ? t("progress.readingNoXp") : undefined
          }
          actions={
            <>
              {toPath}
              {canPractice && (
                <button
                  className="btn-primary"
                  disabled={state.busy || !!state.pending}
                  onClick={() => void run(flow.start)}
                >
                  {t("readingLesson.toQuestions")}
                </button>
              )}
              {nextAction}
            </>
          }
        />
      )}
      {state.phase === "empty" && !state.readReceipt && (
        <>
          <p>{t("nativeLearningFlow.noQuestions")}</p>
          <button
            className="btn-primary"
            disabled={state.busy || !!state.pending}
            onClick={() => void run(flow.read)}
          >
            {t(
              reader.kind === "steps"
                ? "readingLesson.finishStep"
                : "progress.markRead",
            )}
          </button>
          {toPath}
        </>
      )}
      {state.phase === "blocked" && (
        <p role="alert">{t("nativeLearning.pathUnavailable")}</p>
      )}
      {state.phase !== "questions" && retry}
      {state.busy && state.phase !== "questions" && (
        <p role="status">{t("courses.busy")}</p>
      )}
    </section>
  );
}
