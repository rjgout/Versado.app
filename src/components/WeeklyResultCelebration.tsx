"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import PersonalMascot from "@/components/versado/PersonalMascot";
import DivisionEmblem from "@/components/versado/DivisionEmblem";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { jsonMutation } from "@/lib/data/mutation";
import { celebrationDeferredOn, visibleCelebration } from "@/lib/celebrationGate";
import type { WeeklyResult } from "@/lib/weeklyResult";

/** De server bewaart bekeken; alleen de open presentatie is lokaal. */
export default function WeeklyResultCelebration({ userId }: { userId: string }) {
  const pathname = usePathname();
  const t = useT();
  const query = useLiveQuery<{ result: WeeklyResult | null }>(
    ["competition", "weekly-result", userId],
    () => fetchJson("/api/competition/result"),
    { scopes: ["notifications"], enabled: !celebrationDeferredOn(pathname), staleTime: 0, pollMs: 30_000 },
  );
  const result = query.data?.result ?? null;
  const [dismissed, setDismissed] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const shown = visibleCelebration(result && !dismissed.includes(result.weekStart) ? result : null, pathname);

  useEffect(() => {
    const element = dialog.current;
    if (shown && element && !element.open) element.showModal();
    if (!shown && element?.open) element.close();
  }, [shown]);

  function close() {
    if (!shown) return;
    setDismissed(current => [...current, shown.weekStart]);
    query.setData({ result: null });
    void jsonMutation("/api/competition/result", { json: { weekStart: shown.weekStart }, keepalive: true }, { invalidates: ["notifications"] }).catch(() => {});
  }

  return <dialog ref={dialog} data-weekly-result aria-labelledby="weekly-result-title" aria-describedby="weekly-result-body"
    onCancel={event => { event.preventDefault(); close(); }}
    className="fixed inset-0 m-0 h-[100dvh] max-h-none w-full max-w-none overflow-y-auto border-0 bg-vs-app p-0 text-vs-fg backdrop:bg-vs-app">
    {shown && <div className="vs-motion flex min-h-[100dvh] flex-col px-4 pb-[calc(1rem+var(--vs-safe-area-bottom))] pt-[calc(1rem+var(--vs-safe-area-top))] sm:px-8">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3">
        <p className="text-sm font-bold text-vs-fg-2">{t("weeklyResult.label")}</p>
        <button type="button" autoFocus onClick={close} aria-label={t("common.close")} className="flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-vs-subtle"><X aria-hidden className="h-5 w-5" /></button>
      </header>
      <section className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center py-6 text-center">
        <DivisionEmblem tier={shown.tier} className="h-24 w-24" />
        <h1 id="weekly-result-title" className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">{t(`weeklyResult.${shown.outcome}`)}</h1>
        <p id="weekly-result-body" className="mt-3 text-lg text-vs-fg-2">{t(`weeklyResult.${shown.outcome}Body`, { tier: t(`tiers.${shown.tier}`) })}</p>
        <PersonalMascot state={shown.outcome === "demoted" ? "encourage" : shown.outcome === "promoted" ? "celebrate" : "success"} size={192} className="mt-6 w-[192px] max-w-full sm:w-[224px]" />
      </section>
      <footer className="mx-auto w-full max-w-2xl"><button type="button" onClick={close} className="btn-primary min-h-12 w-full">{t("weeklyResult.continue")}</button></footer>
    </div>}
  </dialog>;
}
