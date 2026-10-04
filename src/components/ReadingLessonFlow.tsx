"use client";

import SystemIcon from "@/components/versado/SystemIcon";
import { StreakContinuationCard } from "@/components/StreakContinuation";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ACHIEVEMENT_DISPLAY } from "@/lib/achievementDisplay";
import { announceXpChanged } from "@/lib/xpBroadcast";
import { ExerciseCard, LessonResultMascot, ReaderView, type ChapterAudio, type Exercise } from "@/components/LessonFlow";
import type { ChapterTerm } from "@/lib/chapterTerm";
import { useT } from "@/components/I18nProvider";
import { translateOr } from "@/lib/i18n/core";
import PersonalMascot from "@/components/versado/PersonalMascot";

interface VerseView {
  id: string;
  number: number;
  text: string;
  bookmarked: boolean;
  highlighted: boolean;
  note: string;
  audioStart?: number | null;
}

interface Props {
  lessonId: string;
  chapterId: string;
  bookName: string;
  chapterNumber: number;
  lessonNumber: number;
  totalLessons: number;
  startVerse: number;
  endVerse: number;
  nextLessonId: string | null;
  verses: VerseView[];
  audio?: ChapterAudio | null;
  term?: ChapterTerm;
  exercises: Exercise[];
  /** De door de server uitgedeelde vragen van deze stap; null zonder vragen (dan alleen lezen). */
  sessionId: string | null;
  /** Taal van de uitgave, voor de voorleesstem. */
  language?: string;
}

interface Result {
  /** Een stap zonder vragen: alleen gelezen, geen XP en geen reeks. */
  readOnly?: boolean;
  correctCount: number;
  total: number;
  xpEarned: number;
  baseXp: number;
  bonusXp: number;
  scorePercent: number;
  currentStreak: number;
  alreadyStudiedToday: boolean;
  dayEarned?: boolean;
  newAchievements: string[];
  nextLessonId: string | null;
}

type Phase = "read" | "exercises" | "summary";

export default function ReadingLessonFlow({
  lessonId,
  chapterId,
  bookName,
  chapterNumber,
  lessonNumber,
  totalLessons,
  startVerse,
  endVerse,
  nextLessonId,
  verses,
  audio,
  term,
  exercises,
  sessionId,
  language,
}: Props) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("read");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<{ exerciseId: string; given: string[]; correct: boolean }[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = exercises[index];
  const exerciseById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  async function finish(finalAnswers: { exerciseId: string; given: string[]; correct: boolean }[]) {
    setSubmitting(true);
    const res = await fetch("/api/reading-lessons/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonId, sessionId, answers: finalAnswers }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setError(data.error ?? t("courses.error"));
      return;
    }
    setResult(data);
    setPhase("summary");
    announceXpChanged();
  }

  function onDone(given: string[], correct: boolean) {
    const next = [...answers, { exerciseId: current.id, given, correct }];
    setAnswers(next);
    if (index + 1 < exercises.length) {
      setIndex(index + 1);
    } else {
      finish(next);
    }
  }

  if (phase === "read") {
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {t("readingLesson.stepOf", { n: lessonNumber, total: totalLessons })}
            </p>
            <p className="mt-1 text-xs font-bold text-slate-400 dark:text-slate-500">
              {startVerse}–{endVerse}
            </p>
          </div>
          <div className="aspect-square w-[clamp(5.5rem,24vw,6.75rem)] shrink-0 sm:w-28 lg:w-32">
            <PersonalMascot state="reading" size={128} fill />
          </div>
        </div>
        <ReaderView
          chapterId={chapterId}
          bookName={bookName}
          chapterNumber={chapterNumber}
          verses={verses}
          audio={audio}
          term={term}
          language={language}
        />
        <button
          className="btn-primary self-start"
          disabled={submitting}
          onClick={() => {
            if (sessionId === null || exercises.length === 0) finish([]);
            else setPhase("exercises");
          }}
        >
          {sessionId === null || exercises.length === 0 ? t("readingLesson.finishStep") : t("readingLesson.toQuestions")}
        </button>
        {error && <p className="text-sm font-bold text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  if (phase === "exercises" && current) {
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
            {t("readingLesson.stepVerses", { n: lessonNumber, start: startVerse, end: endVerse })}
          </p>
          <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className="h-full bg-brand-500 transition-all duration-300" style={{ width: `${Math.round((index / exercises.length) * 100)}%` }} />
          </div>
        </div>
        <ExerciseCard
          key={current.id}
          exercise={current}
          onDone={onDone}
          disabled={submitting}
        />
        {error && <p className="text-sm font-bold text-red-600 dark:text-red-400">{error}</p>}
      </div>
    );
  }

  if (phase === "summary" && result) {
    const effectiveNextLessonId = result.nextLessonId ?? nextLessonId;
    if (result.readOnly) {
      return (
        <div className="max-w-md mx-auto card flex flex-col items-center gap-4 text-center animate-pop">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {t("readingLesson.stepDone", { n: lessonNumber })}
          </p>
          <h2 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{t("progress.stepRead")}</h2>
          <p className="text-sm text-vs-fg-2">{t("progress.stepReadText")}</p>
          <div className="flex flex-wrap justify-center gap-3 mt-2">
            <Link href="/courses" className="btn-secondary">{t("readingLesson.stop")}</Link>
            {effectiveNextLessonId && (
              <Link href={`/reading-lesson/${effectiveNextLessonId}`} className="btn-primary">{t("readingLesson.nextStep")}</Link>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="max-w-md mx-auto card flex flex-col items-center gap-4 text-center animate-pop">
        <LessonResultMascot scorePercent={result.scorePercent} celebrate={result.newAchievements.length > 0} successThreshold={60} />
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {t("readingLesson.stepDone", { n: lessonNumber })}
        </p>
        <h2 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">
          {t("readingLesson.score", { correct: result.correctCount, total: result.total })}
        </h2>

        <p className="text-gold-600 dark:text-gold-400 font-extrabold text-lg">
          +{result.xpEarned} XP
        </p>
        {result.baseXp + result.bonusXp === 0 && result.total > 0 && (
          <p className="-mt-2 text-sm text-vs-fg-2">{t("progress.repeatNote")}</p>
        )}
        {result.scorePercent < 60 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("readingLesson.lowScore")}
          </p>
        )}

        <StreakContinuationCard />
        {result.dayEarned && (
          <div className="mt-2">
            <div className="flex items-center gap-1 text-xl font-extrabold text-orange-500"><SystemIcon kind="streak" className="h-5 w-5" fill="currentColor" aria-hidden />{result.currentStreak}</div>
            <div className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase">{t("lesson.streak")}</div>
          </div>
        )}

        {result.newAchievements.length > 0 && (
          <div className="flex flex-col gap-2 w-full">
            <p className="text-sm font-bold text-brand-700 dark:text-brand-300">
              {result.newAchievements.length > 1 ? t("lesson.newAchievementsMany") : t("lesson.newAchievementsOne")}
            </p>
            <div className="flex justify-center gap-3 flex-wrap">
              {result.newAchievements.map((slug) => {
                const display = ACHIEVEMENT_DISPLAY[slug];
                return display ? (
                  <div key={slug} className="flex flex-col items-center gap-1">
                    <span className="text-3xl">{display.icon}</span>
                    <span className="text-xs font-bold dark:text-slate-200">{translateOr(t, `achievements.${slug}.name`, display.name)}</span>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-3 mt-4">
          <Link href="/courses" className="btn-secondary">
            {t("readingLesson.stop")}
          </Link>
          {effectiveNextLessonId && (
            <Link href={`/reading-lesson/${effectiveNextLessonId}`} className="btn-primary">
              <span className="inline-flex items-center gap-1"><SystemIcon kind="streak" className="h-4 w-4" fill="currentColor" aria-hidden />{t("readingLesson.nextStep")}</span>
            </Link>
          )}
        </div>
      </div>
    );
  }

  return null;
}
