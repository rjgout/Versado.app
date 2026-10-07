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

export type DeathOptionView = "free" | "stock" | "buy" | "none";

export interface DeathChoiceView {
  deathOption: DeathOptionView;
  geneesBalance: number;
  geneesPriceXp: number;
  canAffordGenees: boolean;
}

/**
 * Het keuzescherm na een botsing. Gratis Genees eerst, daarna Genees uit voorraad,
 * en bij lege voorraad (één keer per run) de noodkoop. Alle regels komen van de
 * server (deathOption); dit scherm toont ze alleen. Zonder keuze ("none") wordt de
 * run door de aanroeper al beëindigd.
 */
export function DeathPanel({ score, choice, busy, error, onUse, onBuy, onEnd }: {
  score: number;
  choice: DeathChoiceView;
  busy: boolean;
  error: string | null;
  onUse: () => void;
  onBuy: () => void;
  onEnd: () => void;
}) {
  const t = useT();
  const buying = choice.deathOption === "buy";
  const intro = choice.deathOption === "free" ? t("quickMissionary.healFreeIntro") : choice.deathOption === "stock" ? t("quickMissionary.healStockIntro") : t("quickMissionary.healBuyIntro");
  return (
    <>
      <p className="text-2xl font-black">{t("quickMissionary.heal")}</p>
      <p>{t("quickMissionary.scoreLabel", { n: score })}</p>
      {choice.deathOption === "stock" && <p className="rounded-full bg-white/15 px-3 py-1 text-sm font-black" data-genees-stock>{t("quickMissionary.healStockCount", { n: choice.geneesBalance })}</p>}
      <p className="max-w-sm text-sm">{intro}</p>
      {buying && !choice.canAffordGenees && <p className="max-w-sm text-sm font-bold text-amber-200" data-genees-insufficient>{t("quickMissionary.healBuyNotEnough", { xp: choice.geneesPriceXp })}</p>}
      {error && <p className="max-w-sm text-sm font-bold text-red-200" role="alert">{error}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        {buying ? (
          <button type="button" className="btn-primary" disabled={busy || !choice.canAffordGenees} onClick={onBuy} data-genees-buy>
            {busy ? t("quickMissionary.healBuying") : t("quickMissionary.healBuy", { xp: choice.geneesPriceXp })}
          </button>
        ) : (
          <button type="button" className="btn-primary" disabled={busy} onClick={onUse}>
            {choice.deathOption === "free" ? t("quickMissionary.healFree") : t("quickMissionary.healFromStock")}
          </button>
        )}
        <button type="button" className="btn-secondary" disabled={busy} onClick={onEnd}>{t("quickMissionary.endRun")}</button>
      </div>
    </>
  );
}
