"use client";

import { nanoid } from "nanoid";
import { StreakContinuationCard } from "@/components/StreakContinuation";

import { useState } from "react";
import Link from "next/link";
import { ExerciseCard, LessonResultMascot, type Exercise } from "@/components/LessonFlow";
import { useActivityStatus } from "@/lib/useActivity";
import { announceXpChanged } from "@/lib/xpBroadcast";
import { useT } from "@/components/I18nProvider";
import FocusLayout from "@/components/versado/FocusLayout";

interface Answer {
  exerciseId: string;
  given: string[];
}

interface Summary {
  correctCount: number;
  total: number;
  xpEarned: number;
  currentStreak: number;
  freezeCount: number;
  freezesEarned: number;
  freezeUsed: boolean;
  streakBroken: boolean;
  newAchievements: string[];
  alreadyStudiedToday: boolean;
  dayEarned?: boolean;
}

export default function QuickPracticeFlow({ exercises }: { exercises: Exercise[] }) {
  const t = useT();
  useActivityStatus("✏️", "Aan het oefenen");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activityId] = useState(() => nanoid());

  const current = exercises[index];

  async function finish(all: Answer[]) {
    setSubmitting(true);
    const res = await fetch("/api/practice/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-activity-id": activityId },
      body: JSON.stringify({ answers: all }),
    });
    const data = await res.json();
    setSubmitting(false);
    setSummary(data);
    announceXpChanged();
  }

  function onDone(given: string[], _correct: boolean) {
    void _correct; // de server herberekent correctheid zelf bij het indienen
    const next = [...answers, { exerciseId: current.id, given }];
    setAnswers(next);
    if (index + 1 < exercises.length) {
      setIndex(index + 1);
    } else {
      finish(next);
    }
  }

  if (summary) {
    return (
      <FocusLayout className="max-w-2xl items-center gap-4 py-4 text-center animate-pop sm:py-8">
        <LessonResultMascot scorePercent={summary.total > 0 ? Math.round((summary.correctCount / summary.total) * 100) : 100} />
        <h2 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">
          {t("readingLesson.score", { correct: summary.correctCount, total: summary.total })}
        </h2>
        <p className="text-gold-600 dark:text-gold-400 font-extrabold text-lg">+{summary.xpEarned} XP</p>
        <StreakContinuationCard />
        {summary.freezeUsed && (
          <p className="text-sm bg-ice-50 dark:bg-slate-700 text-ice-600 dark:text-ice-400 rounded-xl px-3 py-2">
            {t("lesson.freezeUsed")}
          </p>
        )}
        {summary.freezesEarned > 0 && (
          <p className="text-sm bg-gold-50 dark:bg-slate-700 text-gold-600 dark:text-gold-400 rounded-xl px-3 py-2">
            {t(summary.freezesEarned > 1 ? "lesson.freezesEarnedMany" : "lesson.freezesEarnedOne", { n: summary.freezesEarned })}
          </p>
        )}

        <Link href="/dashboard" className="btn-primary mt-2">
          {t("misc.backToDashboard")}
        </Link>
      </FocusLayout>
    );
  }

  return (
    <FocusLayout className="max-w-2xl gap-6">
      <ExerciseCard
        key={current.id}
        exercise={current}
        onDone={onDone}
        disabled={submitting}
        focus
        progress={{ current: index, total: exercises.length }}
        feedbackContext={{ source: "SCRIPTURE", questionId: current.id, verseRef: current.verseRef }}
      />
    </FocusLayout>
  );
}
