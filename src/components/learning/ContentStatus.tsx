"use client";

import { useEffect, useState } from "react";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { BookOpenCheck, BookOpenText, Clock, Info, ListChecks } from "lucide-react";
import { useT } from "@/components/I18nProvider";

export type ReadState = "UNREAD" | "READING" | "READ";

/**
 * Lezen en oefenen naast elkaar, zoals in elke leesroute: "✓ Gelezen ·
 * Oefeningen 8/12". Lezen en oefenen zijn aparte dingen (zie
 * docs/LEERVOORTGANG.md), dus ze staan ook apart.
 */
export function ContentStatusLine({
  read,
  exercisesAnswered,
  exercisesTotal,
  minutes,
  className = "",
}: {
  read: ReadState;
  exercisesAnswered: number;
  exercisesTotal: number;
  minutes?: number;
  className?: string;
}) {
  const t = useT();
  const chip = "inline-flex items-center gap-1 rounded-full bg-vs-subtle px-2.5 py-1 text-xs font-bold";
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {read === "READ" && (
        <span className={`${chip} text-vs-accent`}>
          <BookOpenCheck className="h-3.5 w-3.5" aria-hidden />
          {t("progress.read")}
        </span>
      )}
      {read === "READING" && (
        <span className={`${chip} text-vs-fg-2`}>
          <BookOpenText className="h-3.5 w-3.5" aria-hidden />
          {t("progress.reading")}
        </span>
      )}
      {exercisesTotal > 0 && (
        <span className={`${chip} ${exercisesAnswered >= exercisesTotal ? "text-vs-accent" : "text-vs-fg-2"}`}>
          <ListChecks className="h-3.5 w-3.5" aria-hidden />
          {read === "READ" && exercisesAnswered === 0
            ? t("progress.exercisesNotDone")
            : t("progress.exercises", { done: exercisesAnswered, total: exercisesTotal })}
        </span>
      )}
      {minutes !== undefined && minutes > 0 && (
        <span className={`${chip} text-vs-fg-2`}>
          <Clock className="h-3.5 w-3.5" aria-hidden />
          {t("progress.minutes", { n: minutes })}
        </span>
      )}
    </div>
  );
}

/**
 * Tip bij een uitzonderlijk lang hoofdstuk (zie isLongChapter): Stap voor
 * stap aanraden, nooit afdwingen.
 */
export function LongChapterNotice({ minutes, stepsHref, onReadFull }: { minutes: number; stepsHref: string; onReadFull: () => void }) {
  const t = useT();
  return (
    <section className="rounded-2xl border border-vs-line bg-vs-surface p-4 sm:p-5" aria-labelledby="long-chapter-title">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-vs-accent" aria-hidden />
        <div className="min-w-0">
          <h2 id="long-chapter-title" className="font-extrabold text-vs-fg">
            {t("progress.longTitle")} <span className="font-bold text-vs-fg-2">· {t("progress.minutes", { n: minutes })}</span>
          </h2>
          <p className="mt-1 text-sm text-vs-fg-2">{t("progress.longText")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={stepsHref} className="btn-primary !px-4 !py-2 !text-sm">
              {t("progress.longSteps")}
            </Link>
            <button type="button" onClick={onReadFull} className="btn-secondary !px-4 !py-2 !text-sm">
              {t("progress.longFull")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Compacte variant voor een regel in een hoofdstukkenlijst. */
export function ContentStatusInline({ read, exercisesAnswered, exercisesTotal }: { read: ReadState; exercisesAnswered: number; exercisesTotal: number }) {
  const t = useT();
  if (read === "UNREAD" && exercisesAnswered === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs font-semibold">
      {read === "READ" && (
        <span className="inline-flex items-center gap-1 text-vs-accent">
          <BookOpenCheck className="h-3.5 w-3.5" aria-hidden />
          {t("progress.read")}
        </span>
      )}
      {read === "READING" && (
        <span className="inline-flex items-center gap-1 text-vs-fg-2">
          <BookOpenText className="h-3.5 w-3.5" aria-hidden />
          {t("progress.reading")}
        </span>
      )}
      {exercisesTotal > 0 && (
        <span className={`inline-flex items-center gap-1 ${exercisesAnswered >= exercisesTotal ? "text-vs-accent" : "text-vs-fg-2"}`}>
          <ListChecks className="h-3.5 w-3.5" aria-hidden />
          {read === "READ" && exercisesAnswered === 0
            ? t("progress.exercisesNotDone")
            : t("progress.exercises", { done: exercisesAnswered, total: exercisesTotal })}
        </span>
      )}
    </span>
  );
}

const SHARED_HINT_KEY = "vs-shared-progress-hint";

/**
 * Eenmalige uitleg waarom iets in een andere route al gelezen staat. Per
 * apparaat onthouden; geen pop-up, en weg na één tik.
 */
export function SharedProgressHint({ show }: { show: boolean }) {
  const t = useT();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!show) return;
    try {
      setVisible(window.localStorage.getItem(SHARED_HINT_KEY) !== "1");
    } catch {
      setVisible(false);
    }
  }, [show]);
  if (!visible) return null;
  function dismiss() {
    setVisible(false);
    try {
      window.localStorage.setItem(SHARED_HINT_KEY, "1");
    } catch {
      // Opslag geblokkeerd: dan alleen voor nu weg.
    }
  }
  return (
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1 rounded-xl bg-vs-subtle px-3 py-2.5 text-sm text-vs-fg-2">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-vs-accent" aria-hidden />
      {/* basis: bij 320 px en 200% tekst springt de knop naar een eigen regel in plaats van de tekst te kneden */}
      <span className="min-w-0 flex-1 basis-[8rem]">{t("progress.sharedInfo")}</span>
      <button type="button" onClick={dismiss} className="shrink-0 font-bold text-vs-accent hover:underline">
        {t("progress.dismiss")}
      </button>
    </div>
  );
}
