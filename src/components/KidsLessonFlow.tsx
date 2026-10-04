"use client";

import SystemIcon from "@/components/versado/SystemIcon";
import { nanoid } from "nanoid";
import { StreakContinuationCard } from "@/components/StreakContinuation";

import { useState } from "react";
import Link from "next/link";
import { ExerciseCard, LessonResultMascot, type Exercise } from "@/components/LessonFlow";
import { ACHIEVEMENT_DISPLAY } from "@/lib/achievementDisplay";
import { announceXpChanged } from "@/lib/xpBroadcast";
import { useT } from "@/components/I18nProvider";
import { translateOr } from "@/lib/i18n/core";

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

type Phase = "read" | "exercises" | "summary";

export default function KidsLessonFlow({
  storyId,
  title,
  text,
  images,
  exercises,
  courseHref,
  nextStoryHref,
}: {
  storyId: string;
  title: string;
  text: string;
  images: string[];
  exercises: Exercise[];
  courseHref: string;
  nextStoryHref: string | null;
}) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>("read");
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [activityId] = useState(() => nanoid());

  const current = exercises[index];

  async function finish(all: Answer[]) {
    setSubmitting(true);
    const res = await fetch(`/api/kids-stories/${storyId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-activity-id": activityId },
      body: JSON.stringify({ answers: all }),
    });
    const data = await res.json();
    setSubmitting(false);
    setSummary(data);
    announceXpChanged();
    setPhase("summary");
  }

  function onDone(given: string[]) {
    const next = [...answers, { exerciseId: current.id, given }];
    setAnswers(next);
    if (index + 1 < exercises.length) {
      setIndex(index + 1);
    } else {
      finish(next);
    }
  }

  if (phase === "read") {
    return (
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <h1 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">{title}</h1>
        {images.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {images.map((src) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={src} src={src} alt="" className="rounded-xl w-full h-auto" />
            ))}
          </div>
        )}
        <p className="text-lg leading-relaxed dark:text-slate-100 whitespace-pre-line">{text}</p>
        {exercises.length > 0 && (
          <button className="btn-primary self-start" onClick={() => setPhase("exercises")}>
            {t("lessonFlows.startQuestions")}
          </button>
        )}
      </div>
    );
  }

  if (phase === "summary" && summary) {
    return (
      <div className="max-w-md mx-auto card flex flex-col items-center gap-4 text-center animate-pop">
        <LessonResultMascot
          scorePercent={summary.total > 0 ? Math.round((summary.correctCount / summary.total) * 100) : 100}
          celebrate={summary.newAchievements.length > 0}
        />
        <h2 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">
          {t("readingLesson.score", { correct: summary.correctCount, total: summary.total })}
        </h2>
        <p className="text-gold-600 dark:text-gold-400 font-extrabold text-lg">+{summary.xpEarned} XP</p>
        <StreakContinuationCard />
        {summary.dayEarned && (
          <p className="flex items-center gap-1 text-orange-500 font-extrabold text-lg"><SystemIcon kind="streak" className="h-5 w-5" fill="currentColor" aria-hidden />{summary.currentStreak}</p>
        )}

        {summary.freezeUsed && (
          <p className="text-sm bg-ice-50 dark:bg-slate-700 text-ice-600 dark:text-ice-400 rounded-xl px-3 py-2">
            {t("lesson.freezeUsed")}
          </p>
        )}
        {summary.freezesEarned > 0 && (
          <p className="text-sm bg-gold-50 dark:bg-slate-700 text-gold-600 dark:text-gold-400 rounded-xl px-3 py-2">
            {summary.freezesEarned > 1
              ? t("lesson.freezesEarnedMany", { n: summary.freezesEarned })
              : t("lesson.freezesEarnedOne", { n: summary.freezesEarned })}
          </p>
        )}

        {summary.newAchievements.length > 0 && (
          <div className="flex flex-col gap-2 w-full">
            <p className="text-sm font-bold text-brand-700 dark:text-brand-300">
              {summary.newAchievements.length > 1 ? t("lesson.newAchievementsMany") : t("lesson.newAchievementsOne")}
            </p>
            <div className="flex justify-center gap-3 flex-wrap">
              {summary.newAchievements.map((slug) => {
                const display = ACHIEVEMENT_DISPLAY[slug];
                if (!display) return null;
                return (
                  <div key={slug} className="flex flex-col items-center gap-1">
                    <span className="text-3xl">{display.icon}</span>
                    <span className="text-xs font-bold dark:text-slate-200">{translateOr(t, `achievements.${slug}.name`, display.name)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex gap-3 flex-wrap justify-center">
          <Link href={courseHref} className={nextStoryHref ? "btn-secondary" : "btn-primary"}>
            {t("lessonFlows.toStories")}
          </Link>
          {nextStoryHref && (
            <Link href={nextStoryHref} className="btn-primary">
              {t("lessonFlows.nextStory")}
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <div className="h-3 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
        <div
          className="h-full bg-brand-500 transition-all duration-300"
          style={{ width: `${Math.round((index / exercises.length) * 100)}%` }}
        />
      </div>
      <ExerciseCard
        key={current.id}
        exercise={current}
        onDone={onDone}
        disabled={submitting}
        checkEndpoint={`/api/kids-exercises/${current.id}/check`}
      />
    </div>
  );
}
