"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import {
  ExerciseSessionQuestions,
  SummaryScreen,
  type Exercise,
} from "@/components/LessonFlow";
import type { StudyContentExerciseResult } from "@/lib/learning/contentProgress";
import { liveMutation } from "@/lib/data/mutation";
import { announceXpChanged } from "@/lib/xpBroadcast";
import {
  restoreExerciseCheckpoint,
  studyExerciseDraftKey,
  type ExerciseCheckpoint,
} from "@/lib/learning/exerciseCheckpoint";
import { chapterTerm } from "@/lib/chapterTerm";
import FocusLayout from "@/components/versado/FocusLayout";
import { useStudyReturnToPath } from "@/lib/studyOrigin";
class ReadingVisitRequiredError extends Error {}
class StudyExerciseRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
type Issued = {
  sessionId: string;
  exercises: Exercise[];
  groups: Array<{ index: number; count: number }>;
};
export default function StudyExerciseClient({
  editionId,
  revisionId,
  stepIndex,
  returnHref,
  sessionKey,
  available,
  requiresReadingVisit,
  nextHref = null,
}: {
  editionId: string;
  revisionId: string;
  stepIndex: number | null;
  returnHref: string;
  sessionKey: string;
  available: boolean;
  requiresReadingVisit: boolean;
  nextHref?: string | null;
}) {
  const t = useT(),
    [issued, setIssued] = useState<Issued | null>(null),
    [result, setResult] = useState<StudyContentExerciseResult | null>(null),
    [busy, setBusy] = useState(available),
    [checkpoint, setCheckpoint] = useState<ExerciseCheckpoint | null>(null),
    [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const returnToPath = useStudyReturnToPath(returnHref, nextHref ?? "/courses");
  const continueReading = () => { if (stepIndex === 6) returnToPath(); else if (nextHref) router.replace(nextHref); };
  const generation = useRef<object | null>(null);
  const draftKey = studyExerciseDraftKey(
    sessionKey,
    editionId,
    revisionId,
    stepIndex,
  );
  function removeDraft(clearVisit = false) {
    try {
      sessionStorage.removeItem(draftKey);
      if (clearVisit) sessionStorage.removeItem(draftKey + ":visit");
    } catch {}
  }
  function saveDraft(sessionId: string, state: ExerciseCheckpoint | null) {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ sessionId, checkpoint: state }),
      );
    } catch {}
  }
  function readingProof() {
    const fragment = new URLSearchParams(window.location.hash.slice(1)).get(
      "leesbewijs",
    );
    if (fragment?.startsWith("rv1.") && fragment.length <= 1500)
      return fragment;
    try {
      return sessionStorage.getItem(draftKey + ":visit") ?? undefined;
    } catch {
      return undefined;
    }
  }
  async function request<T>(body: Record<string, unknown>): Promise<T> {
    const res = await fetch("/api/study-exercises", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Reading-Session": sessionKey,
      },
      body: JSON.stringify({
        ...body,
        ...(requiresReadingVisit ? { visitProof: readingProof() } : {}),
      }),
    });
    const data = await res.json();
    if (data.code === "READ_REQUIRED") {
      try {
        sessionStorage.removeItem(draftKey + ":visit");
      } catch {}
      router.replace(returnHref);
      throw new ReadingVisitRequiredError(data.error);
    }
    if (!res.ok) throw new StudyExerciseRequestError(data.error ?? t("courses.error"), res.status);
    return data;
  }
  async function start() {
    const current = {};
    generation.current = current;
    if (requiresReadingVisit && !readingProof()) {
      router.replace(returnHref);
      return;
    }
    setBusy(true);
    setError(null);
    let saved: { sessionId?: unknown; checkpoint?: unknown } | null = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "null");
    } catch {
      removeDraft();
    }
    try {
      let data: Issued | null;
      let restored: ExerciseCheckpoint | null = null;
      if (typeof saved?.sessionId === "string") {
        const response = await request<{
          issued: Issued;
          result: StudyContentExerciseResult | null;
        }>({
          action: "resume",
          sessionId: saved.sessionId,
          editionId,
          revisionId,
          stepIndex,
        });
        if (current !== generation.current) return;
        if (response.result) {
          removeDraft(true);
          const confirmed = await liveMutation(async () => response.result!, {
            invalidates: "studyStepsChanged",
          });
          if (current !== generation.current) return;
          setResult(confirmed);
          announceXpChanged();
          return;
        }
        data = response.issued;
        restored = restoreExerciseCheckpoint(
          saved.checkpoint,
          data.exercises.map((q) => q.id),
        );
      } else
        data = await request<Issued | null>({
          action: "issue",
          editionId,
          revisionId,
          stepIndex,
        });
      if (current !== generation.current) return;
      if (!data) throw new Error(t("cfmExercises.unavailable"));
      saveDraft(data.sessionId, restored);
      setCheckpoint(restored);
      setIssued(data);
    } catch (e) {
      if (current !== generation.current) return;
      if (e instanceof ReadingVisitRequiredError) return;
      // Een tijdelijk transport-/serverprobleem mag bevestigde antwoorden niet wissen.
      if (e instanceof StudyExerciseRequestError && [400, 403, 404, 409].includes(e.status))
        removeDraft();
      setError(
        e instanceof Error &&
          !(e instanceof TypeError) &&
          !(e instanceof SyntaxError)
          ? e.message
          : t("courses.error"),
      );
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (available) void start();
    return () => {
      generation.current = null;
    };
    // De pagina is op editie/revisie/stap gesleuteld; een sessiewissel start opnieuw onder de nieuwe eigenaar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    editionId,
    revisionId,
    stepIndex,
    sessionKey,
    available,
    requiresReadingVisit,
  ]);
  if (result)
    return (
      <SummaryScreen
        summary={result}
        nextChapterId={null}
        term={chapterTerm(null)}
        returnHref={returnHref}
        continuation={nextHref ? { label: t(stepIndex === 6 ? "cfmStudy.backToPath" : "cfmStudy.nextStep"), onContinue: continueReading } : undefined}
      />
    );
  if (issued)
    return (
      <ExerciseSessionQuestions
        retryCheckErrors
        onSkipRemaining={nextHref ? continueReading : undefined}
        exercises={issued.exercises}
        initialCheckpoint={checkpoint}
        onCheckpoint={(state) => saveDraft(issued.sessionId, state)}
        review={stepIndex === null}
        feedbackContext={(exercise) => ({
          source: "SCRIPTURE",
          questionId: exercise.id,
        })}
        groupForIndex={(index) =>
          t("cfmStudy.stepOf", {
            n: issued.groups[Math.floor(index / 3)]?.index ?? stepIndex ?? 1,
            total: 6,
          })
        }
        onCheck={(exercise, given) =>
          request({
            action: "check",
            sessionId: issued.sessionId,
            exerciseId: exercise.id,
            given,
          })
        }
        submit={(answers) =>
          liveMutation(
            () =>
              request<StudyContentExerciseResult>({
                action: "submit",
                sessionId: issued.sessionId,
                answers: answers.map(({ exerciseId, given }) => ({
                  exerciseId,
                  given,
                })),
              }),
            { invalidates: "studyStepsChanged" },
          )
        }
        onComplete={(data) => {
          removeDraft(true);
          setResult(data);
          announceXpChanged();
        }}
      />
    );
  return (
    <FocusLayout className="max-w-2xl gap-4">
      <h1 className="text-xl font-extrabold">{t("cfmExercises.title")}</h1>
      {available && error ? (
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() => void start()}
        >
          {busy
            ? t("courses.busy")
            : t("progress.practice", { n: stepIndex ? 3 : 18 })}
        </button>
      ) : !available ? (
        <p role="status">{t("cfmExercises.unavailable")}</p>
      ) : (
        <p role="status">{t("courses.busy")}</p>
      )}
      {error && (
        <p role="alert" className="text-vs-danger">
          {error}
        </p>
      )}
      <Link href={returnHref} replace className="btn-secondary">
        {t("misc.backToLesson")}
      </Link>
    </FocusLayout>
  );
}
