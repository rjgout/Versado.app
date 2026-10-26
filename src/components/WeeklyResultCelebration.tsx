"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import PersonalMascot from "@/components/versado/PersonalMascot";
import DivisionEmblem from "@/components/versado/DivisionEmblem";
import { getSocket } from "@/lib/socketClient";
import { celebrationDeferredOn, visibleCelebration } from "@/lib/celebrationGate";
import type { WeeklyResult } from "@/lib/weeklyResult";

/** De server bewaart bekeken; alleen de open presentatie is lokaal. */
export default function WeeklyResultCelebration() {
  const pathname = usePathname();
  const t = useT();
  const [result, setResult] = useState<WeeklyResult | null>(null);
  const dismissed = useRef(new Set<string>());
  const dialog = useRef<HTMLDialogElement>(null);
  const shown = visibleCelebration(result, pathname);

  useEffect(() => {
    if (celebrationDeferredOn(pathname)) return;
    let cancelled = false;
    let busy = false;
    async function refresh() {
      if (document.visibilityState !== "visible" || busy || cancelled) return;
      busy = true;
      try {
        const response = await fetch("/api/competition/result", { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const data: { result: WeeklyResult | null } = await response.json();
        if (!cancelled) setResult(data.result && !dismissed.current.has(data.result.weekStart) ? data.result : null);
      } catch { /* Bij heropenen of netwerkherstel opnieuw proberen, zonder navigatie te blokkeren. */ }
      finally { busy = false; }
    }
    void refresh();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", refresh);
    // Ook bij een al geopende app: het bestaande meldingssignaal ververst direct.
    // Polling vangt een weekgrens of gemist signaal zonder pushvoorkeur op.
    const socket = getSocket();
    socket.on("notifications_changed", refresh);
    socket.on("connect", refresh);
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", refresh);
      socket.off("notifications_changed", refresh);
      socket.off("connect", refresh);
      window.clearInterval(timer);
    };
  }, [pathname]);

  useEffect(() => {
    const element = dialog.current;
    if (shown && element && !element.open) element.showModal();
    if (!shown && element?.open) element.close();
  }, [shown]);

  function close() {
    if (!shown) return;
    dismissed.current.add(shown.weekStart);
    void fetch("/api/competition/result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekStart: shown.weekStart }), keepalive: true }).catch(() => {});
    setResult(null);
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
