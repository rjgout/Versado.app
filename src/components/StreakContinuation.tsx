"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import StreakContinuationCardView, { ReturnProgress } from "@/components/today/StreakContinuationCardView";
import { useT } from "@/components/I18nProvider";
import MascotSlot from "@/components/versado/MascotSlot";
import { onXpChanged } from "@/lib/xpBroadcast";
import { getSocket } from "@/lib/socketClient";
import type { StreakContinuationView } from "@/lib/learning/streakReturnRules";
import StreakCelebrationFlow, { type StreakCelebrationValue } from "@/components/StreakCelebrationFlow";
import StreakEarnedBanner from "@/components/StreakEarnedBanner";
import { earnedStreakBanner, type EarnedStreakBanner } from "@/lib/streakBanner";
import { celebrationDeferredOn, shouldClaimStreakCelebration, visibleCelebration } from "@/lib/celebrationGate";

const Context = createContext<StreakContinuationView | null>(null);
export const useStreakContinuation = () => useContext(Context);

export function StreakContinuationCard() { return <StreakContinuationCardView value={useStreakContinuation()}/>; }

export function StreakContinuationProvider({ userId, children }: { userId?: string; children: ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const [value, setValue] = useState<StreakContinuationView | null>(null);
  const [welcome, setWelcome] = useState(false);
  const [banner, setBanner] = useState<(EarnedStreakBanner & { userId: string }) | null>(null);
  const pendingEarnedEvent = useRef(false);
  const bannerOwner = useRef(userId);
  const shownBanners = useRef(new Set<string>());
  const dismissBanner = useCallback(() => setBanner(null), []);
  const [celebration, setCelebration] = useState<StreakCelebrationValue | null>(null);
  const latest = useRef<StreakContinuationView | null>(null);
  const shown = useRef(new Set<string>());
  const dialog = useRef<HTMLDialogElement>(null);
  const claimingCelebration = useRef(false);
  const pathnameRef = useRef(pathname);

  // De viering wordt pas geclaimd en getoond buiten een activiteit; zie celebrationGate.
  const claimCelebration = useCallback(async () => {
    const view = latest.current;
    if (!userId || !shouldClaimStreakCelebration({
      pathname: pathnameRef.current,
      status: view?.status ?? null,
      studiedToday: view?.studiedToday ?? false,
      claiming: claimingCelebration.current,
    })) return;
    claimingCelebration.current = true;
    try {
      const response = await fetch("/api/streak/celebration", { method: "POST", cache: "no-store" });
      if (!response.ok) return;
      const result = (await response.json()) as { show: boolean; streak: number | null; dayKey: string | null };
      if (result.show && result.streak !== null && result.dayKey) {
        setBanner(null);
        setCelebration({ streak: result.streak, dayKey: result.dayKey });
      }
    } catch {
      // Een tijdelijke netwerkfout mag de leeractiviteit niet blokkeren.
    } finally {
      claimingCelebration.current = false;
    }
  }, [userId]);

  // Staat vóór het verversen, zodat claimen altijd de actuele route leest. Bij elke
  // routewissel ververst het effect hieronder opnieuw: verlaat de gebruiker een
  // activiteit, dan wordt een openstaande viering op dat moment geclaimd.
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!userId) return;
    const accountId = userId;
    if (bannerOwner.current !== userId) {
      bannerOwner.current = userId;
      latest.current = null;
      pendingEarnedEvent.current = false;
    }
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
          setWelcome(false);
        }
        const earned = earnedStreakBanner(latest.current, next, pendingEarnedEvent.current);
        pendingEarnedEvent.current = false;
        if (earned && celebrationDeferredOn(pathnameRef.current)) {
          const key = `streak-earned-banner:${userId}:${earned.dayKey}`;
          let alreadyShown = shownBanners.current.has(key);
          try { alreadyShown ||= sessionStorage.getItem(key) === "1"; } catch { /* Geheugenfallback bij geblokkeerde opslag. */ }
          if (!alreadyShown) {
            shownBanners.current.add(key);
            try { sessionStorage.setItem(key, "1"); } catch { /* Geen opslag vereist voor spelen. */ }
            setBanner({ ...earned, userId: accountId });
          }
        }
        latest.current = next;
        setValue(next);
        void claimCelebration();
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
    const onStreakChanged = (event?: { dayEarned?: boolean }) => {
      if (event?.dayEarned === true) pendingEarnedEvent.current = true;
      void refresh();
    };
    socket.on("streak_changed", onStreakChanged);
    document.addEventListener("visibilitychange", refresh);
    // Ook de lokale dag kan veranderen zonder navigatie of nieuwe XP.
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      unsubscribe();
      socket.off("st:awarded", refresh);
      socket.off("streak_changed", onStreakChanged);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [claimCelebration, userId, pathname]);

  useEffect(() => {
    const element = dialog.current;
    if (welcome && element && !element.open) element.showModal();
    if (!welcome && element?.open) element.close();
  }, [welcome]);

  const shownCelebration = visibleCelebration(celebration, pathname);

  return <Context.Provider value={value}>
    {children}
    {banner && banner.userId === userId && <StreakEarnedBanner key={`${banner.userId}:${banner.dayKey}`} streak={banner.streak}
      visible={celebrationDeferredOn(pathname) && !shownCelebration} onDismiss={dismissBanner} />}
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
    {shownCelebration && <StreakCelebrationFlow value={shownCelebration} onDone={() => setCelebration(null)} />}
  </Context.Provider>;
}
