"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import MascotSlot from "@/components/versado/MascotSlot";
import SystemIcon from "@/components/versado/SystemIcon";
import { onXpChanged } from "@/lib/xpBroadcast";
import { getSocket } from "@/lib/socketClient";
import type { StreakContinuationView } from "@/lib/learning/streakReturnRules";
import StreakCelebrationFlow, { type StreakCelebrationValue } from "@/components/StreakCelebrationFlow";

const Context = createContext<StreakContinuationView | null>(null);
export const useStreakContinuation = () => useContext(Context);

function ReturnProgress({ value }: { value: StreakContinuationView }) {
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

export function StreakContinuationCard() {
  const value = useStreakContinuation();
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

export function StreakContinuationProvider({ userId, children }: { userId?: string; children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const [value, setValue] = useState<StreakContinuationView | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [success, setSuccess] = useState<number | null>(null);
  const [celebration, setCelebration] = useState<StreakCelebrationValue | null>(null);
  const latest = useRef<StreakContinuationView | null>(null);
  const shown = useRef(new Set<string>());
  const dialog = useRef<HTMLDialogElement>(null);
  const claimingCelebration = useRef(false);

  const claimCelebration = useCallback(async () => {
    if (!userId || claimingCelebration.current) return;
    claimingCelebration.current = true;
    try {
      const response = await fetch("/api/streak/celebration", { method: "POST", cache: "no-store" });
      if (!response.ok) return;
      const result = (await response.json()) as { show: boolean; streak: number | null; dayKey: string | null };
      if (result.show && result.streak !== null && result.dayKey) setCelebration({ streak: result.streak, dayKey: result.dayKey });
    } catch {
      // Een tijdelijke netwerkfout mag de leeractiviteit niet blokkeren.
    } finally {
      claimingCelebration.current = false;
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let busy = false;
    let pending = false;
    async function refresh() {
      if (document.visibilityState !== "visible" || cancelled) return;
      if (busy) { pending = true; return; }
      busy = true;
      try {
        const response = await fetch("/api/streak/continuation", { method: "POST", cache: "no-store" });
        if (!response.ok || cancelled) return;
        const next: StreakContinuationView = await response.json();
        if (cancelled) return;
        if (latest.current?.status === "INTERRUPTED" && next.status === "ACTIVE" && next.studiedToday) {
          setSuccess(next.currentStreak);
          setWelcome(false);
        }
        latest.current = next;
        setValue(next);
        if (next.status === "ACTIVE" && next.studiedToday) void claimCelebration();
        if (next.status === "INTERRUPTED") {
          const key = `streak-return:${userId}:${next.interruptedDay}`;
          let alreadyShown = shown.current.has(key);
          try { alreadyShown ||= sessionStorage.getItem(key) === "1"; } catch { /* Privémodus mag uitleg niet blokkeren. */ }
          if (!alreadyShown) {
            shown.current.add(key);
            try { sessionStorage.setItem(key, "1"); } catch { /* De geheugenfallback voorkomt herhalen tijdens navigatie. */ }
            setWelcome(true);
          }
        }
      } catch { /* Een tijdelijke netwerkfout verandert nooit de laatst bekende reeks. */ }
      finally {
        busy = false;
        if (pending) { pending = false; void refresh(); }
      }
    }
    void refresh();
    const unsubscribe = onXpChanged(refresh);
    const socket = getSocket();
    socket.on("st:awarded", refresh);
    socket.on("streak_changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    // Ook de lokale dag kan veranderen zonder navigatie of nieuwe XP.
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      unsubscribe();
      socket.off("st:awarded", refresh);
      socket.off("streak_changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [claimCelebration, userId, pathname]);

  useEffect(() => {
    const element = dialog.current;
    if (welcome && element && !element.open) element.showModal();
    if (!welcome && element?.open) element.close();
  }, [welcome]);

  return <Context.Provider value={value}>
    {children}
    {success !== null && <div role="status" className="fixed inset-x-4 top-[calc(var(--header-height,4.5rem)+1rem)] z-50 mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-vs-line bg-vs-surface p-4 text-vs-fg shadow-lg">
      <p className="flex-1 text-sm font-semibold">{t("streakReturn.success", { n: success })}</p>
      <button type="button" onClick={() => setSuccess(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full hover:bg-vs-subtle" aria-label={t("common.close")}><X className="h-5 w-5" /></button>
    </div>}
    <dialog ref={dialog} aria-labelledby="streak-return-title" onCancel={() => setWelcome(false)} onClose={() => setWelcome(false)}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-3xl border border-vs-line bg-vs-surface p-5 text-vs-fg shadow-xl backdrop:bg-black/50 sm:p-6">
      {value?.status === "INTERRUPTED" && <>
        <div className="flex items-start justify-between gap-3">
          <MascotSlot character="vera" state="encourage" size={128} className="w-28 sm:w-32" />
          <button type="button" autoFocus onClick={() => setWelcome(false)} aria-label={t("common.close")} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-vs-subtle"><X className="h-5 w-5" /></button>
        </div>
        <h2 id="streak-return-title" className="mt-3 text-xl font-extrabold">{t("streakReturn.welcome")}</h2>
        <p className="mt-2 text-sm font-semibold">{t("streakReturn.saved", { n: value.currentStreak })}</p>
        <p className="mb-4 mt-2 text-sm leading-relaxed text-vs-fg-2">{t("streakReturn.explain", { n: value.required })}</p>
        <ReturnProgress value={value} />
        <p className="mt-3 text-xs leading-relaxed text-vs-fg-2">{t("streakReturn.dayRule")}</p>
        <button type="button" className="btn-primary mt-5 w-full" onClick={() => setWelcome(false)}>{t("streakReturn.continue")}</button>
      </>}
    </dialog>
    {celebration && <StreakCelebrationFlow value={celebration} onDone={() => setCelebration(null)} />}
  </Context.Provider>;
}
