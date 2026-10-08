"use client";

// Browserhulpen voor rondleidingen en uitnodigingen: een doel opzoeken en
// meten waar de vaste balken zitten. Alleen in de browser gebruiken.

import type { Insets } from "@/lib/kompas/tourLayout";

/** Is dit element echt zichtbaar (niet verborgen met display:none, zoals de onderbalk op desktop)? */
function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return getComputedStyle(element).visibility !== "hidden";
}

/**
 * Het zichtbare element met deze data-kompas-target. Een doel mag op meerdere
 * plekken staan (de navigatie staat op telefoon onderaan en op desktop in de
 * header); het eerste zichtbare telt.
 */
export function findTarget(name: string): HTMLElement | null {
  const candidates = document.querySelectorAll<HTMLElement>(`[data-kompas-target="${CSS.escape(name)}"]`);
  for (const element of candidates) if (isVisible(element)) return element;
  return null;
}

/** Zit het doel vast aan het scherm (header, onderbalk), zodat scrollen het niet verplaatst? */
export function isFixedTarget(element: HTMLElement): boolean {
  for (let node: HTMLElement | null = element; node && node !== document.body; node = node.parentElement) {
    const position = getComputedStyle(node).position;
    if (position === "fixed" || position === "sticky") return true;
  }
  return false;
}

let safeBottomProbe: HTMLDivElement | null = null;

function safeAreaBottom(): number {
  if (!safeBottomProbe) {
    safeBottomProbe = document.createElement("div");
    safeBottomProbe.setAttribute("aria-hidden", "true");
    safeBottomProbe.style.cssText = "position:fixed;left:0;bottom:0;width:0;height:var(--vs-safe-area-bottom,0px);visibility:hidden;pointer-events:none";
    document.body.appendChild(safeBottomProbe);
  }
  return safeBottomProbe.getBoundingClientRect().height;
}

/**
 * Waar de vaste balken zitten, uit dezelfde elementen die de app zelf gebruikt:
 * de vaste bovenbalk (header, terugbalk, spelers; zie StickyHeader) en de
 * onderbalk (BottomNav, alleen zichtbaar onder lg). Geen eigen aannames over hoogtes.
 */
export function measureInsets(): Insets {
  const header = document.querySelector<HTMLElement>("[data-sticky-header]");
  const nav = document.querySelector<HTMLElement>("[data-main-nav]");
  const top = header ? header.getBoundingClientRect().bottom : 0;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const navVisible = nav && isVisible(nav);
  const bottom = navVisible ? Math.max(viewportHeight - nav.getBoundingClientRect().top, 0) : safeAreaBottom();
  return { top: Math.max(top, 0), bottom };
}

/**
 * Wacht tot dit doel er is, hoogstens `ms` milliseconden, en geeft de pagina
 * daarna een korte adempauze zodat naastgelegen onderdelen van dezelfde
 * render (bijvoorbeeld een lijst en zijn toevoegknop) er ook zijn.
 */
export function waitForTarget(name: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      observer.disconnect();
      window.clearTimeout(timer);
      window.setTimeout(resolve, 150);
    };
    const observer = new MutationObserver(() => {
      if (findTarget(name)) finish();
    });
    const timer = window.setTimeout(() => {
      observer.disconnect();
      resolve();
    }, ms);
    if (findTarget(name)) {
      finish();
      return;
    }
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-kompas-target"] });
  });
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
