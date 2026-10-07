"use client";

import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { chapterReadHref } from "@/lib/navigation";

export interface ReviveQuestionView {
  exerciseId: string;
  context: { kind: "chapter"; label: string } | null;
  prompt: string;
  options: { id: string; label: string }[];
}

export interface ReviveReadingView {
  chapterId: string;
  label: string;
}

/**
 * De Genees-vraag. Het hoofdstuk staat groot boven alles, want zonder te
 * weten waarover de vraag gaat is hij niet te beantwoorden. De opties dragen
 * geen enkele aanwijzing over het goede antwoord: de server stuurt dat niet mee.
 */
export function ReviveQuestionPanel({ question, onAnswer }: { question: ReviveQuestionView; onAnswer: (optionId: string) => void }) {
  const t = useT();
  const chapter = question.context?.label ?? null;
  return (
    <>
      <div className="flex flex-col items-center gap-1" data-revive-header>
        <p className="text-xs font-black uppercase tracking-[0.22em] text-white/70">{t("quickMissionary.heal")}</p>
        {chapter && <h2 className="text-3xl font-black leading-tight sm:text-4xl" data-revive-chapter>{chapter}</h2>}
      </div>
      <p className="max-w-sm text-sm font-semibold">{chapter ? t("quickMissionary.reviveQuestionAbout", { chapter }) : t("quickMissionary.reviveQuestion")}</p>
      <p className="max-w-sm text-base font-bold leading-snug" data-revive-prompt>{question.prompt}</p>
      <div className="grid w-full max-w-sm gap-3">
        {question.options.map((option) => (
          <button key={option.id} type="button" className="btn-secondary min-h-12 w-full !h-auto !justify-start !whitespace-normal !px-4 !py-3 !text-left !text-sm !leading-snug !normal-case" onClick={() => onAnswer(option.id)}>
            {option.label}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * Na een fout antwoord: terug naar de brontekst. Bewust zonder het juiste
 * antwoord; de speler ontdekt dat zelf in het hoofdstuk.
 */
export function ReviveFailurePanel({ reading }: { reading: ReviveReadingView }) {
  const t = useT();
  return (
    <div className="w-full max-w-sm rounded-2xl bg-white/15 p-4 text-center" data-revive-reading>
      <p className="text-xl font-black">{t("quickMissionary.reviveWrong")}</p>
      <p className="mt-1 text-sm font-semibold">{t("quickMissionary.reviveReadHint", { chapter: reading.label })}</p>
      <Link replace href={chapterReadHref(reading.chapterId)} className="btn-primary mt-3 w-full">
        {t("quickMissionary.reviveRead", { chapter: reading.label })}
      </Link>
    </div>
  );
}
