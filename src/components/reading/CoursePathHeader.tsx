"use client";

import { useT } from "@/components/I18nProvider";
import { SharedProgressHint } from "@/components/learning/ContentStatus";
import { surfaceCard } from "@/components/versado/styles";

/**
 * De kop van elk leespad: titel, Samen studeren, voortgang (voltooide hoofdstukken, nooit de positie in de cursus),
 * de eenmalige uitleg over gedeelde voortgang en de voltooiingsmelding. Gedeeld door de drie leescursussen.
 */
export default function CoursePathHeader({
  courseName,
  studyAction,
  completed,
  total,
  unitPlural,
  anyProgress,
  allDone,
}: {
  courseName: string;
  /** Ingang naar Samen studeren, naast de titel (zie StudyTogetherButton). */
  studyAction?: React.ReactNode;
  completed: number;
  total: number;
  /** "hoofdstukken", of "afdelingen" bij Leer en Verbonden (zie src/lib/chapterTerm.ts). */
  unitPlural: string;
  anyProgress: boolean;
  allDone: boolean;
}) {
  const t = useT();
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="vs-wrap text-2xl font-extrabold text-vs-fg">{courseName}</h1>
        {studyAction}
      </div>

      {total > 0 && (
        <div className="flex flex-col gap-2 border-y border-vs-line py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs font-bold text-vs-fg-3">
            <span>{t("courseView.progress")}</span>
            <span>{t("courseView.progressCount", { pos: completed, total, unit: unitPlural, pct: percent })}</span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={completed}
            aria-label={t("courseView.progress")}
            className="h-2 overflow-hidden rounded-full bg-vs-subtle"
          >
            <div className="vs-motion h-full rounded-full bg-vs-accent transition-all" style={{ width: percent + "%" }} />
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
  );
}
