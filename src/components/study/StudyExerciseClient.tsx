"use client";
import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import {
  ExerciseSessionQuestions,
  SummaryScreen,
  type Exercise,
} from "@/components/LessonFlow";
import type { StudyContentExerciseResult } from "@/lib/learning/contentProgress";
import { jsonMutation } from "@/lib/data/mutation";
import { announceXpChanged } from "@/lib/xpBroadcast";
import { chapterTerm } from "@/lib/chapterTerm";
import FocusLayout from "@/components/versado/FocusLayout";
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
}: {
  editionId: string;
  revisionId: string;
  stepIndex: number | null;
  returnHref: string;
  sessionKey: string;
  available: boolean;
}) {
  const t = useT(),
    [issued, setIssued] = useState<Issued | null>(null),
    [result, setResult] = useState<StudyContentExerciseResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function request<T>(body: unknown): Promise<T> {
    const res = await fetch("/api/study-exercises", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Reading-Session": sessionKey,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? t("courses.error"));
    return data;
  }
  async function start() {
    setBusy(true);
    setError(null);
    try {
      const data = await request<Issued | null>({
        action: "issue",
        editionId,
        revisionId,
        stepIndex,
      });
      if (!data) throw new Error(t("cfmExercises.unavailable"));
      setIssued(data);
    } catch (e) {
      setError(e instanceof Error && !(e instanceof TypeError) && !(e instanceof SyntaxError) ? e.message : t("courses.error"));
    } finally {
      setBusy(false);
    }
  }
  if (result)
    return (
      <SummaryScreen
        summary={result}
        nextChapterId={null}
        term={chapterTerm(null)}
        returnHref={returnHref}
      />
    );
  if (issued)
    return (
      <ExerciseSessionQuestions
        exercises={issued.exercises}
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
          jsonMutation<StudyContentExerciseResult>(
            "/api/study-exercises",
            {
              headers: { "X-Reading-Session": sessionKey },
              json: {
                action: "submit",
                sessionId: issued.sessionId,
                answers: answers.map(({ exerciseId, given }) => ({
                  exerciseId,
                  given,
                })),
              },
            },
            { invalidates: "studyStepsChanged" },
          )
        }
        onComplete={(data) => {
          setResult(data);
          announceXpChanged();
        }}
      />
    );
  return (
    <FocusLayout className="max-w-2xl gap-4">
      <h1 className="text-xl font-extrabold">{t("cfmExercises.title")}</h1>
      {available ? (
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() => void start()}
        >
          {busy
            ? t("courses.busy")
            : t("progress.practice", { n: stepIndex ? 3 : 18 })}
        </button>
      ) : (
        <p role="status">{t("cfmExercises.unavailable")}</p>
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
