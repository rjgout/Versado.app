"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { HymnView } from "@/lib/hymnPrefs";
import { scrollDelta } from "./viewModel";

// Scrollen in de leesruimte (de scrollcontainer van de tekst). Het document zelf scrolt nooit: er is geen
// scroll-aanroep op het venster, dus ook een iPhone-browser verschuift de pagina niet.
//
// Drie dingen verschuiven de tekst:
//  - automatisch meelopen met de muziek (alleen in de stand "auto" en als de voorkeur aan staat);
//  - een bewuste navigatie van de gebruiker (regel aantikken, vorige/volgende, hervatten): altijd;
//  - een nieuw couplet of een andere weergave: één keer naar de juiste plek.
// Een eigen scrollgebaar (wiel, vinger, toetsen) meldt alleen `onUserScroll`; wat daarmee gebeurt beslist de
// leesstand (reading.ts). Er wordt nooit teruggescrold zolang de gebruiker zelf leest.

interface Options {
  boxRef: RefObject<HTMLElement | null>;
  view: HymnView;
  /** Er staat leesbare tekst (niet het keuze- of herkenningsscherm). */
  active: boolean;
  /** Automatisch meelopen is nu toegestaan (stand auto, voorkeur aan, de engine volgt). */
  autoFollow: boolean;
  /** Regel waar de automatische navigatie naartoe gaat (-1 = geen). */
  autoIndex: number;
  /** Regel waar een bewuste navigatie naartoe gaat (-1 = geen). */
  navIndex: number;
  /** Telt op bij elke bewuste navigatie (ook als de doelregel gelijk blijft). */
  navTick: number;
  /** Verandert bij een ander lofzang, couplet of weergave: dan sluit de tekst eenmalig aan. */
  placeKey: string;
  smooth: boolean;
  onUserScroll(): void;
}

const SCROLL_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);
// Karaoke: de actieve regel staat hoog op het scherm, zodat er ruim ruimte is voor de komende regels (en het volgende couplet).
const CENTER_AT = 0.28;

function lineEl(box: HTMLElement, index: number): HTMLElement | null {
  return box.querySelector<HTMLElement>(`[data-seq="${index}"]`);
}

/** Scrolt de regel naar de leesplek (karaoke: op ~28% van de hoogte) of, in het volledige couplet, alleen in beeld. */
function align(box: HTMLElement, index: number, view: HymnView, smooth: boolean): void {
  const el = lineEl(box, index);
  if (!el) return;
  const c = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  let delta = 0;
  if (view === "karaoke") delta = Math.round(r.top + r.height / 2 - (c.top + c.height * CENTER_AT));
  else delta = scrollDelta({ lineTop: r.top, lineBottom: r.bottom, viewTop: c.top, viewBottom: c.bottom, contentHeight: box.scrollHeight });
  if (Math.abs(delta) < 2) return;
  const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  box.scrollBy({ top: delta, behavior: smooth && !reduce ? "smooth" : "auto" });
}

export function useReadingScroll({ boxRef, view, active, autoFollow, autoIndex, navIndex, navTick, placeKey, smooth, onUserScroll }: Options): void {
  const onScrollRef = useRef(onUserScroll);
  useEffect(() => {
    onScrollRef.current = onUserScroll;
  });

  // Eigen scrollgebaar: alleen als er echt iets te scrollen valt.
  useEffect(() => {
    const el = boxRef.current;
    if (!active || !el) return;
    const detach = () => {
      if (el.scrollHeight > el.clientHeight + 4) onScrollRef.current();
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
  }, [active, boxRef]);

  // Een ander lofzang, couplet of weergave: eenmalig naar de juiste plek, zonder animatie.
  useEffect(() => {
    const box = boxRef.current;
    if (!active || !box) return;
    const frame = requestAnimationFrame(() => {
      const target = view === "karaoke" ? navIndex : autoFollow && autoIndex >= 0 ? autoIndex : navIndex;
      if (target >= 0) align(box, target, view, false);
      else box.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
    // alleen op placeKey: navIndex/autoIndex worden hier bewust niet gevolgd
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeKey, active]);

  // Automatisch meelopen met de muziek.
  useEffect(() => {
    const box = boxRef.current;
    if (!active || !autoFollow || autoIndex < 0 || !box) return;
    const frame = requestAnimationFrame(() => align(box, autoIndex, view, smooth));
    return () => cancelAnimationFrame(frame);
  }, [active, autoFollow, autoIndex, view, smooth, boxRef]);

  // Bewuste navigatie van de gebruiker (niet bij de eerste weergave).
  const lastTick = useRef(navTick);
  useEffect(() => {
    if (lastTick.current === navTick) return;
    lastTick.current = navTick;
    const box = boxRef.current;
    if (!active || !box || navIndex < 0) return;
    const frame = requestAnimationFrame(() => align(box, navIndex, view, smooth));
    return () => cancelAnimationFrame(frame);
  }, [navTick, navIndex, active, view, smooth, boxRef]);
}
