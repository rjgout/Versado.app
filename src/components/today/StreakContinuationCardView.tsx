"use client";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { useT } from "@/components/I18nProvider";
import SystemIcon from "@/components/versado/SystemIcon";
import type { StreakContinuationView } from "@/lib/learning/streakReturnRules";
export function ReturnProgress({ value }: { value: StreakContinuationView }) {
  const t = useT();
  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm font-semibold">
      <span>{t("streakReturn.progress", { done: value.completed, total: value.required })}</span>
      <span className="text-vs-fg-2">{t("streakReturn.remaining", { n: Math.max(0, value.required - value.completed) })}</span>
    </div>
    <progress className="block h-2 w-full overflow-hidden rounded-full accent-vs-streak" value={value.completed} max={value.required}
      aria-label={t("streakReturn.title")} />
  </div>;
}

export default function StreakContinuationCardView({ value }: { value: StreakContinuationView | null }) {
  const t = useT();
  if (value?.status !== "INTERRUPTED") return null;
  return <section className="w-full rounded-2xl border border-vs-line bg-vs-surface p-4 text-left text-vs-fg" aria-label={t("streakReturn.title")}>
    <h2 className="mb-2 flex items-center gap-2 text-base font-bold">
      <SystemIcon kind="streak" className="h-5 w-5 shrink-0 text-vs-streak" aria-hidden />
      <Link href="/streak" className="rounded focus-visible:outline focus-visible:outline-2">{t("streakReturn.title")}</Link>
    </h2>
    <ReturnProgress value={value} />
    <p className="mt-2 text-xs leading-relaxed text-vs-fg-2">{t("streakReturn.saved", { n: value.currentStreak })}</p>
  </section>;
}

