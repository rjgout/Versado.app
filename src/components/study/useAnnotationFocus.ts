"use client";
import { useEffect, type RefObject } from "react";
import { currentEntryKey } from "@/lib/navigationHistory";
import { requestScrollRestore } from "@/lib/scrollRestore";
import type { AnnotationFocus } from "@/lib/annotations/studyFocus";

const HIGHLIGHT_MS = 4500;

function headerHeight() {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-height")) || 0;
}

/**
 * Scrolt naar de exact teruggevonden opgeslagen passage en laat die even rustig opvallen.
 * Gebruikt het bestaande scrollcoördinatiepunt (geen eigen window.scrollTo); bij terug/vooruit
 * blijft de historische positie leidend. Staat bewust ná de leespositiehook, zodat deze de herstelde leespositie vervangt.
 */
export function useAnnotationFocus(root: RefObject<HTMLElement | null>, focus: AnnotationFocus | null | undefined) {
  useEffect(() => {
    const element = root.current;
    if (!element || focus?.status !== "exact") return;
    const section = Array.from(element.querySelectorAll<HTMLElement>("[data-study-section]")).find((node) => node.dataset.studySection === focus.sectionAnchor);
    const marked = section
      ? focus.blockIds.flatMap((id) => Array.from(section.querySelectorAll<HTMLElement>("[data-study-text]")).filter((node) => node.dataset.studyText === id))
      : [];
    if (!section || marked.length === 0) return;
    for (const node of marked) node.setAttribute("data-annotation-focus", "true");
    requestScrollRestore(currentEntryKey(), "explicit", () =>
      Math.max(0, marked[0].getBoundingClientRect().top + window.scrollY - headerHeight() - 24));
    const timer = window.setTimeout(() => { for (const node of marked) node.removeAttribute("data-annotation-focus"); }, HIGHLIGHT_MS);
    return () => {
      window.clearTimeout(timer);
      for (const node of marked) node.removeAttribute("data-annotation-focus");
    };
  }, [root, focus]);
}
