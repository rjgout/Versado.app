"use client";

import { useT } from "@/components/I18nProvider";
import { SharedProgressHint } from "@/components/learning/ContentStatus";
import ReadingPath from "@/components/reading/ReadingPath";
import { surfaceCard } from "@/components/versado/styles";
import type { PathChapter } from "@/lib/readingPath";

interface Props {
  /** Ingang naar Samen studeren, naast de titel (zie StudyTogetherButton). */
  studyAction?: React.ReactNode;
  courseName: string;
  /** De eerste stap die nog niet af is (de bestaande voortgangscursor), of null als alles af is. */
  today: { id: string } | null;
  /** Elk schriftuurlijk hoofdstuk met zijn echte stappen en statussen, in cursusvolgorde. */
  chapters: PathChapter[];
  /** "hoofdstukken", of "afdelingen" bij Leer en Verbonden (zie src/lib/chapterTerm.ts). */
  unitPlural?: string;
}

export default function ReadingCourseView({ today, chapters, courseName, unitPlural = "hoofdstukken", studyAction }: Props) {
  const t = useT();
  const allDone = chapters.length > 0 && chapters.every((chapter) => chapter.completedLessons === chapter.lessonCount);
  const currentChapterIndex = today ? chapters.findIndex((chapter) => chapter.steps.some((step) => step.id === today.id)) : -1;
  const progressPosition = currentChapterIndex >= 0 ? currentChapterIndex + 1 : chapters.length;
  const progressPercent = chapters.length > 0 ? Math.round((progressPosition / chapters.length) * 100) : 0;
  const anyProgress = chapters.some((chapter) => chapter.read !== "UNREAD" || chapter.exercisesAnswered > 0);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 sm:gap-8">
      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="vs-wrap text-2xl font-extrabold text-vs-fg">{courseName}</h1>
          {studyAction}
        </div>

        {chapters.length > 0 && (
          <div className="flex flex-col gap-2 border-y border-vs-line py-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs font-bold text-vs-fg-3">
              <span>{t("courseView.progress")}</span>
              <span>{t("courseView.progressCount", { pos: progressPosition, total: chapters.length, unit: unitPlural, pct: progressPercent })}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-vs-subtle">
              <div className="vs-motion h-full rounded-full bg-vs-accent transition-all" style={{ width: progressPercent + "%" }} />
            </div>
          </div>
        )}

        <SharedProgressHint show={anyProgress} />

        {allDone && (
          <div className={`${surfaceCard} p-4 text-center`}>
            <p className="text-lg font-extrabold text-vs-fg">{t("courseView.allDone")}</p>
          </div>
        )}
      </div>

      <ReadingPath chapters={chapters} currentStepId={today?.id ?? null} />
    </div>
  );
}
