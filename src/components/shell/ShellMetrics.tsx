"use client";

import { useEffect } from "react";
import { isEditableElement, isHeaderTall, isKeyboardOpen, isLargeText } from "@/lib/shellMetrics";

/**
 * De ene plek die de vaste delen van de shell meet en als CSS-variabelen en
 * data-attributen op <html> zet (docs/LAYOUT.md). Pagina's en componenten
 * rekenen met deze waarden en meten nooit zelf een header of onderbalk.
 *
 * - --header-height: hoogte van de vaste bovenbalk (header, terugbalk,
 *   spelers). <main> houdt er zijn bovenruimte mee vrij.
 * - --header-offset: waar iets dat tegen de bovenbalk plakt (sticky of fixed)
 *   moet beginnen. Gelijk aan --header-height, maar 0 zodra de bovenbalk
 *   `data-header-tall` krijgt en met de pagina meescrolt.
 * - --nav-height: hoogte van de onderbalk (0 als die er niet is, zoals op
 *   desktop en in focus mode). <main> houdt er zijn onderruimte mee vrij.
 * - data-header-tall: bij zeer grote tekst loopt de header over meerdere
 *   regels; dan scrolt hij mee in plaats van het scherm te vullen.
 * - data-text-large: de tekst staat op 140% of groter; decoratieve beelden
 *   (.vs-decor) maken dan plaats voor de tekst.
 * - data-keyboard: het schermtoetsenbord is open; de onderbalk verdwijnt dan
 *   (anders staat hij op iOS midden in beeld en op Android boven het toetsenbord).
 */
export default function ShellMetrics() {
  useEffect(() => {
    const root = document.documentElement;
    const header = document.querySelector<HTMLElement>("[data-sticky-header]");
    const nav = document.querySelector<HTMLElement>("[data-main-nav]");
    let maxHeight = window.innerHeight;
    let frame = 0;

    const visibleHeight = () => window.visualViewport?.height ?? window.innerHeight;

    const apply = () => {
      const headerPx = header ? header.offsetHeight : 0;
      const navPx = nav ? nav.offsetHeight : 0;
      // Een kleinere viewport zonder toetsenbord (draaien, adresbalk) moet de referentie niet blijven vasthouden.
      if (!isEditableElement(document.activeElement as HTMLElement | null)) maxHeight = Math.max(window.innerHeight, visibleHeight());
      else maxHeight = Math.max(maxHeight, window.innerHeight);
      const tall = isHeaderTall(headerPx, maxHeight);
      root.style.setProperty("--header-height", `${headerPx}px`);
      root.style.setProperty("--header-offset", tall ? "0px" : `${headerPx}px`);
      root.style.setProperty("--nav-height", `${navPx}px`);
      // Tekstgrootte van de gebruiker (root-font-size); vanaf 140% maken we ruimte voor de tekst.
      const textScale = parseFloat(getComputedStyle(root).fontSize) / 16;
      if (isLargeText(textScale)) root.setAttribute("data-text-large", "");
      else root.removeAttribute("data-text-large");
      if (tall) root.setAttribute("data-header-tall", "");
      else root.removeAttribute("data-header-tall");
      const keyboard = isKeyboardOpen({
        editableFocused: isEditableElement(document.activeElement as HTMLElement | null),
        visibleHeight: visibleHeight(),
        maxHeight,
      });
      if (keyboard) root.setAttribute("data-keyboard", "");
      else root.removeAttribute("data-keyboard");
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };

    apply();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (header) observer?.observe(header);
    if (nav) observer?.observe(nav);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    // Webfonts en late inhoud veranderen de hoogte na de eerste meting.
    void document.fonts?.ready.then(schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      root.removeAttribute("data-header-tall");
      root.removeAttribute("data-text-large");
      root.removeAttribute("data-keyboard");
    };
  }, []);
  return null;
}
