"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import SystemIcon from "@/components/versado/SystemIcon";

/** Een lokale, wegveegbare melding. Neemt geen focus over en pauzeert geen activiteit. */
export default function StreakEarnedBanner({ streak, visible, onDismiss }: {
  streak: number;
  visible: boolean;
  onDismiss: () => void;
}) {
  const t = useT();
  const [paused, setPaused] = useState(false);
  const [offset, setOffset] = useState(0);
  const surface = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dismiss = useCallback(() => {
    if (surface.current?.contains(document.activeElement) && previousFocus.current?.isConnected) {
      previousFocus.current.focus({ preventScroll: true });
    }
    onDismiss();
  }, [onDismiss]);
  useEffect(() => {
    if (visible && document.activeElement instanceof HTMLElement && !surface.current?.contains(document.activeElement)) previousFocus.current = document.activeElement;
  }, [visible]);
  const start = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (paused && visible) return;
    const timer = window.setTimeout(dismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [dismiss, paused, visible]);

  function finish(event: PointerEvent<HTMLElement>) {
    if (start.current?.id !== event.pointerId) return;
    event.stopPropagation();
    const deltaY = event.clientY - start.current.y;
    const deltaX = event.clientX - start.current.x;
    start.current = null;
    setPaused(false);
    setOffset(0);
    if (deltaY <= -40 && Math.abs(deltaY) > Math.abs(deltaX)) dismiss();
  }

  if (!visible) return null;
  return <div className="pointer-events-none fixed left-[calc(var(--vs-safe-area-left)+0.75rem)] right-[calc(var(--vs-safe-area-right)+0.75rem)] top-[calc(var(--vs-safe-area-top)+0.75rem)] z-[85] mx-auto max-w-lg" data-streak-earned-banner>
    <section ref={surface} role="status" aria-live="polite" aria-atomic="true"
      className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-2xl border border-vs-line bg-vs-elevated p-3 text-vs-fg shadow-lg"
      style={{ touchAction: "pan-x", transform: offset ? `translateY(${offset}px)` : undefined }}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => { if (!start.current) setPaused(false); }}
      onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
      onPointerDown={(event) => {
        event.stopPropagation();
        if ((event.target as HTMLElement).closest("button")) return;
        event.preventDefault();
        start.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        setPaused(true);
      }}
      onPointerMove={(event) => {
        if (start.current?.id !== event.pointerId) return;
        event.stopPropagation();
        setOffset(Math.min(0, event.clientY - start.current.y));
      }}
      onPointerUp={finish}
      onPointerCancel={() => { start.current = null; setOffset(0); setPaused(false); }}>
      <SystemIcon kind="streak" className="h-[32px] w-[32px]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-extrabold">{t("streakCelebration.bannerTitle")}</p>
        <p className="text-sm font-semibold text-vs-fg-2">{t(streak === 1 ? "streakCelebration.bannerDay" : "streakCelebration.bannerDays", { n: streak })}</p>
      </div>
      <button type="button" aria-label={t("common.close")}
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-vs-fg-2 hover:bg-vs-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-vs-accent"
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); dismiss(); }}>
        <X className="h-5 w-5" aria-hidden />
      </button>
    </section>
  </div>;
}
