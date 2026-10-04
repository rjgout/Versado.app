"use client";

import { useEffect } from "react";
import { isNativeApp } from "@/lib/platform";

// Binnen deze afstand (px) van de linker-/rechterschermrand telt een touch-
// start als "edge swipe" — vergelijkbaar met de aangrijpingszone die iOS zelf
// voor de terug/verder-gebaren gebruikt.
const EDGE_ZONE_PX = 24;

/**
 * Vangnet bovenop de CSS-aanpak in globals.css (touch-action/overscroll-
 * behavior): die dekt de meeste browsers, maar iOS Safari's edge-swipe-terug/
 * verder-gebaar wordt op sommige iOS-versies nog los van die CSS-eigenschappen
 * herkend zodra een aanraking dicht genoeg bij de schermrand begint. Dit
 * onderdrukt zo'n aanraking alleen als hij (a) binnen de randzone start én
 * (b) overwegend horizontaal beweegt — een gewone verticale scroll die toevallig
 * bij de rand begint, blijft dus intact. Geregistreerd op document-niveau met
 * passive:false, want alleen dan werkt preventDefault() hier daadwerkelijk.
 */
export default function EdgeSwipeGuard() {
  useEffect(() => {
    // In native Android hoort de systeem-back gesture bij Capacitor's App
    // listener; in iOS mag WKWebView zijn eigen teruggebaar afhandelen.
    if (isNativeApp()) return;

    let startX = 0;
    let startY = 0;
    let fromEdge = false;

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (!t) return;
      startX = t.clientX;
      startY = t.clientY;
      fromEdge = startX <= EDGE_ZONE_PX || startX >= window.innerWidth - EDGE_ZONE_PX;
    }

    function onTouchMove(e: TouchEvent) {
      if (!fromEdge) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        e.preventDefault();
      }
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);

  return null;
}
