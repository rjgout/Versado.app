"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { scrollDelta } from "./viewModel";

// Rustig meescrollen met de actieve regel, zonder de pagina te laten springen. Scrolt de gebruiker zelf
// (wiel, vinger, toetsen), dan stopt het meescrollen tot "Volgen hervatten"; de muziekengine merkt hier niets
// van. Is het hele couplet in beeld, dan wordt er nooit gescrold.

interface Options {
  /** Meescrollen aan (voorkeur) en een weergave waarin dat zin heeft. */
  enabled: boolean;
  /** Verandert dit, dan sluit het scrollen weer aan (bijvoorbeeld een nieuw couplet). */
  resetKey: string;
  /** Index van de actieve regel (-1 = geen). */
  activeIndex: number;
  containerRef: RefObject<HTMLElement | null>;
  activeRef: RefObject<HTMLElement | null>;
  /** De onderste bediening (hoogte telt af van het zichtbare gebied). */
  barRef: RefObject<HTMLElement | null>;
  smooth: boolean;
}

const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);

function cssPx(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function useFollowScroll({ enabled, resetKey, activeIndex, containerRef, activeRef, barRef, smooth }: Options) {
  const [detachedFor, setDetachedFor] = useState<string | null>(null);
  const detached = enabled && detachedFor === resetKey;
  const resetRef = useRef(resetKey);
  useEffect(() => {
    resetRef.current = resetKey;
  }, [resetKey]);

  // Eigen scrollgebaar van de gebruiker: alleen als de pagina echt kan scrollen.
  useEffect(() => {
    if (!enabled) return;
    const canScroll = () => document.documentElement.scrollHeight > window.innerHeight + 4;
    const detach = () => {
      if (canScroll()) setDetachedFor(resetRef.current);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.key)) return;
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName)) return;
      detach();
    };
    window.addEventListener("wheel", detach, { passive: true });
    window.addEventListener("touchmove", detach, { passive: true });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", detach);
      window.removeEventListener("touchmove", detach);
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || detached || activeIndex < 0) return;
    const frame = requestAnimationFrame(() => {
      const line = activeRef.current;
      const container = containerRef.current;
      if (!line || !container) return;
      const r = line.getBoundingClientRect();
      const c = container.getBoundingClientRect();
      const viewTop = cssPx("--header-height", 56) + 12;
      const bar = barRef.current?.getBoundingClientRect();
      const viewBottom = (bar ? bar.top : window.innerHeight) - 12;
      const delta = scrollDelta({ lineTop: r.top, lineBottom: r.bottom, viewTop, viewBottom, contentHeight: c.height });
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (delta !== 0) window.scrollBy({ top: delta, behavior: smooth && !reduce ? "smooth" : "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, detached, activeIndex, activeRef, containerRef, barRef, smooth]);

  const resume = useCallback(() => setDetachedFor(null), []);
  return { detached, resume };
}
