"use client";
import type { ReactNode } from "react";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { useT } from "@/components/I18nProvider";
import { translateOr } from "@/lib/i18n/core";
import type { ChapterTerm } from "@/lib/chapterTerm";
import type { ReadState } from "./ContentStatus";
import { ContentStatusLine } from "./ContentStatus";
import { LessonResultMascot } from "./ExerciseSessionQuestions";
import FocusLayout from "@/components/versado/FocusLayout";
import SystemIcon from "@/components/versado/SystemIcon";
import AchievementIcon from "@/components/versado/AchievementIcon";
import { ACHIEVEMENT_DISPLAY } from "@/lib/achievementDisplay";
export interface SummaryResult {
  correctCount: number;
  total: number;
  xpEarned: number;
  baseXp: number;
  bonusXp: number;
  repeatXp: number;
  content: {
    read: ReadState;
    exercisesAnswered: number;
    exercisesTotal: number;
  };
  scorePercent: number;
  currentStreak: number;
  longestStreak: number;
  streakBroken: boolean;
  freezeUsed: boolean;
  freezesEarned: number;
  freezeCount: number;
  newAchievements: string[];
  alreadyStudiedToday: boolean;
  dayEarned?: boolean;
}

export interface SummaryScreenProps {
  summary: SummaryResult;
  nextChapterId: string | null;
  term: ChapterTerm;
  courseId?: string;
  returnHref?: string;
  /** Eén bestaande resultaatvervolgactie, zonder tussenliggende terugkeer naar de leesstap. */
  continuation?: { label: string; onContinue: () => void };
  streakContinuation?: ReactNode;
  actions?: ReactNode;
  successThreshold?: number;
}
export function SummaryScreen({
  summary,
  nextChapterId,
  term,
  courseId,
  returnHref,
  continuation,
  streakContinuation,
  actions,
  successThreshold = 50,
}: SummaryScreenProps) {
  const t = useT();
  return (
    <FocusLayout className="max-w-2xl items-center gap-4 py-4 text-center animate-pop sm:py-8">
      <LessonResultMascot
        successThreshold={successThreshold}
        scorePercent={summary.scorePercent}
        celebrate={summary.newAchievements.length > 0}
      />
      <h2 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">
        {t("lesson.score", {
          correct: summary.correctCount,
          total: summary.total,
          pct: summary.scorePercent,
        })}
      </h2>
      <p className="text-gold-600 dark:text-gold-400 font-extrabold text-lg">
        +{summary.xpEarned} XP
      </p>
      {summary.baseXp + summary.bonusXp === 0 && summary.total > 0 && (
        <p className="-mt-2 text-sm text-vs-fg-2">{t("progress.repeatNote")}</p>
      )}
      {summary.content && (
        <ContentStatusLine
          read={summary.content.read}
          exercisesAnswered={summary.content.exercisesAnswered}
          exercisesTotal={summary.content.exercisesTotal}
          className="justify-center"
        />
      )}

      <div className="mt-2 flex flex-wrap justify-center gap-x-6 gap-y-3">
        {streakContinuation}
        <div>
          <div className="flex items-center gap-1 text-xl font-extrabold text-ice-600">
            <SystemIcon kind="freeze" className="h-5 w-5" aria-hidden />
            {summary.freezeCount}
          </div>
          <div className="text-xs text-slate-400 dark:text-slate-500 font-bold uppercase">
            {t("lesson.freezes")}
          </div>
        </div>
      </div>

      {summary.freezeUsed && (
        <p className="text-sm bg-ice-50 dark:bg-slate-700 text-ice-600 dark:text-ice-400 rounded-xl px-3 py-2">
          {t("lesson.freezeUsed")}
        </p>
      )}
      {summary.streakBroken && !summary.freezeUsed && (
        <p className="text-sm bg-red-50 dark:bg-slate-700 text-red-500 dark:text-red-400 rounded-xl px-3 py-2">
          {t("lesson.streakBroken")}
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
            {summary.newAchievements.length > 1
              ? t("lesson.newAchievementsMany")
              : t("lesson.newAchievementsOne")}
          </p>
          <div className="flex justify-center gap-3 flex-wrap">
            {summary.newAchievements.map((slug) => {
              const display = ACHIEVEMENT_DISPLAY[slug];
              if (!display) return null;
              return (
                <div key={slug} className="flex flex-col items-center gap-1">
                  <AchievementIcon
                    slug={slug}
                    fallbackIcon={display.icon}
                    className="h-9 w-9"
                  />
                  <span className="text-xs font-bold dark:text-slate-200">
                    {translateOr(t, `achievements.${slug}.name`, display.name)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-3 mt-4">
        {actions ?? (
          <>
            {continuation ? (
              <button
                type="button"
                data-study-result-continue
                className="btn-primary"
                onClick={continuation.onContinue}
              >
                {continuation.label}
              </button>
            ) : (
              <Link
                href={returnHref ?? "/dashboard"}
                replace={!!returnHref}
                className="btn-secondary"
              >
                {t(returnHref ? "misc.backToLesson" : "lesson.backToLessons")}
              </Link>
            )}
            {nextChapterId && (
              <Link
                href={`/lesson/${nextChapterId}${courseId ? `?cursus=${courseId}` : ""}`}
                className="btn-primary"
              >
                {t(`terms.${term.kind}.next`)}
              </Link>
            )}
          </>
        )}
      </div>
    </FocusLayout>
  );
}
