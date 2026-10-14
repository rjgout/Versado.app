"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { scrollDelta } from "./viewModel";

// Rustig meescrollen met de actieve regel binnen de leesruimte (de scrollcontainer van de tekst). Het document
// zelf scrolt nooit: er is geen element-scrollaanroep op het venster, dus ook een iPhone-browser verschuift de
// pagina niet. Scrolt de gebruiker zelf (wiel, vinger, toetsen in de leesruimte), dan stopt het meescrollen tot
// "Volgen hervatten"; de muziekengine merkt hier niets van. Past het hele couplet, dan wordt er nooit gescrold.

interface Options {
  /** Meescrollen aan (voorkeur) en een weergave waarin dat zin heeft. */
  enabled: boolean;
  /** Verandert dit, dan sluit het scrollen weer aan (bijvoorbeeld een nieuw couplet). */
  resetKey: string;
  /** Index van de actieve regel (-1 = geen). */
  activeIndex: number;
  /** De scrollcontainer van de tekst (de leesruimte). */
  scrollRef: RefObject<HTMLElement | null>;
  activeRef: RefObject<HTMLElement | null>;
  smooth: boolean;
}

const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);

export function useFollowScroll({ enabled, resetKey, activeIndex, scrollRef, activeRef, smooth }: Options) {
  const [detachedFor, setDetachedFor] = useState<string | null>(null);
  const detached = enabled && detachedFor === resetKey;
  const resetRef = useRef(resetKey);
  useEffect(() => {
    resetRef.current = resetKey;
  }, [resetKey]);

  // Eigen scrollgebaar van de gebruiker in de leesruimte: alleen als er echt iets te scrollen valt.
  useEffect(() => {
    const el = scrollRef.current;
    if (!enabled || !el) return;
    const detach = () => {
      if (el.scrollHeight > el.clientHeight + 4) setDetachedFor(resetRef.current);
    };
    const onKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) detach();
    };
    el.addEventListener("wheel", detach, { passive: true });
    el.addEventListener("touchmove", detach, { passive: true });
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("wheel", detach);
      el.removeEventListener("touchmove", detach);
      el.removeEventListener("keydown", onKey);
    };
  }, [enabled, scrollRef]);

  useEffect(() => {
    if (!enabled || detached || activeIndex < 0) return;
    const frame = requestAnimationFrame(() => {
      const box = scrollRef.current;
      const line = activeRef.current;
      if (!box || !line) return;
      const c = box.getBoundingClientRect();
      const r = line.getBoundingClientRect();
      const delta = scrollDelta({ lineTop: r.top, lineBottom: r.bottom, viewTop: c.top, viewBottom: c.bottom, contentHeight: box.scrollHeight });
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (delta !== 0) box.scrollBy({ top: delta, behavior: smooth && !reduce ? "smooth" : "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [enabled, detached, activeIndex, scrollRef, activeRef, smooth]);

  const resume = useCallback(() => setDetachedFor(null), []);
  return { detached, resume };
}
