"use client";
import type { ReactNode } from "react";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { useT } from "@/components/I18nProvider";
import FocusLayout from "@/components/versado/FocusLayout";

/** De bestaande leesafronding: geen verzonnen score of oefen-XP. */
export default function ReadingCompletionSummary({
  lessonNumber,
  nextHref,
  heading,
  description,
  actions,
}: {
  lessonNumber?: number;
  nextHref?: string | null;
  heading?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const t = useT();
  return (
    <FocusLayout className="max-w-2xl items-center gap-4 py-4 text-center animate-pop sm:py-8">
      {lessonNumber !== undefined && (
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {t("readingLesson.stepDone", { n: lessonNumber })}
        </p>
      )}
      <h2 className="text-2xl font-extrabold text-brand-800 dark:text-brand-300">
        {heading ?? t("progress.stepRead")}
      </h2>
      <p className="text-sm text-vs-fg-2">
        {description ?? t("progress.stepReadText")}
      </p>
      <div className="flex flex-wrap justify-center gap-3 mt-2">
        {actions ?? (
          <>
            <Link href="/courses" className="btn-secondary">
              {t("readingLesson.stop")}
            </Link>
            {nextHref && (
              <Link href={nextHref} className="btn-primary">
                {t("readingLesson.nextStep")}
              </Link>
            )}
          </>
        )}
      </div>
    </FocusLayout>
  );
}
