"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  currentEntryKey,
  noteInAppNavigation,
  onTraverseStart,
  persistScrollPositions,
  saveScrollPosition,
  savedScrollPosition,
  bindContentDepartureEntry,
} from "@/lib/navigationHistory";

// Hoe lang we na terug/vooruit blijven proberen de oude positie te halen:
// veel pagina's halen hun inhoud pas na het tonen op, en tot die er staat is
// de pagina te kort om ver genoeg te kunnen scrollen.
const RESTORE_TIMEOUT_MS = 3000;
const RESTORE_STABLE_MS = 500;
const USER_INPUT_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

function locationKey(pathname: string, search: string): string {
  return `${pathname}?${search}`;
}

function browserLocationKey(): string {
  return locationKey(window.location.pathname, new URLSearchParams(window.location.search).toString());
}

/**
 * Scrollgedrag bij navigatie, voor de hele app op één plek (staat in
 * layout.tsx), zodat geen pagina zelf naar boven hoeft te scrollen:
 *
 * - Een nieuwe pagina (link, onderbalk, router.push/replace, een
 *   profielonderdeel) begint bovenaan. Next.js doet dat zelf alleen als de
 *   bovenkant van de nieuwe pagina buiten beeld valt, en daardoor kwam je
 *   soms halverwege een nieuwe pagina binnen.
 * - Terug en vooruit (browser of eigen terugknop) zetten de pagina terug op
 *   de positie van toen. De browser kan dat zelf niet betrouwbaar: hij
 *   herstelt vóórdat de inhoud die de pagina zelf ophaalt er staat, en komt
 *   dan op een te korte pagina uit. Daarom staat scrollRestoration op
 *   "manual" en proberen we het hier opnieuw zodra de pagina groeit.
 */
export default function NavigationScroll() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const location = locationKey(pathname, search);

  const lastLocation = useRef<string | null>(null);
  // Gezet tussen popstate en het moment dat de pagina van dat item er staat.
  const pendingPop = useRef<{ target: number | null } | null>(null);
  const cancelRestore = useRef<(() => void) | null>(null);

  function restore(target: number) {
    cancelRestore.current?.();
    const root = document.documentElement;
    const started = performance.now();
    let lastHeight = -1;
    let stableSince = started;
    let frame = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.cancelAnimationFrame(frame);
      root.style.overflowAnchor = "";
      for (const event of USER_INPUT_EVENTS) window.removeEventListener(event, finish);
      cancelRestore.current = null;
    };
    // Per frame opnieuw: inhoud die na het tonen nog binnenkomt (boven of
    // onder de doelpositie) mag de pagina niet meer verschuiven. Scroll-
    // anchoring van de browser staat zolang uit, anders schuift die er
    // juist overheen. Klaar zodra de pagina een halve seconde niet meer van
    // hoogte verandert en de positie gehaald is.
    const tick = () => {
      const now = performance.now();
      const height = root.scrollHeight;
      if (height !== lastHeight) {
        lastHeight = height;
        stableSince = now;
      }
      const top = Math.min(target, Math.max(0, height - window.innerHeight));
      if (Math.abs(window.scrollY - top) > 1) window.scrollTo({ top, behavior: "instant" });
      const reached = top >= target;
      if ((reached && now - stableSince > RESTORE_STABLE_MS) || now - started > RESTORE_TIMEOUT_MS) {
        finish();
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    cancelRestore.current = finish;
    root.style.overflowAnchor = "none";
    // Wie zelf gaat scrollen of tikken, neemt het over.
    for (const event of USER_INPUT_EVENTS) window.addEventListener(event, finish, { passive: true });
    tick();
  }

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    const onScroll = () => {
      // Tussen het begin van terug/vooruit en het neerzetten van die pagina
      // kan het adres al bij het nieuwe item horen terwijl de oude pagina nog
      // in beeld staat: die positie mag het nieuwe item niet krijgen.
      if (pendingPop.current) return;
      saveScrollPosition(currentEntryKey(), window.scrollY);
    };
    const startTraverse = (target: number | null, destination: string) => {
      if (destination === lastLocation.current) {
        // Zelfde adres (bv. alleen een #anker): er volgt geen nieuwe pagina.
        if (target !== null) window.setTimeout(() => restore(target), 0);
        return;
      }
      const pending = { target };
      pendingPop.current = pending;
      // Vangnet als er toch geen pagina volgt: dan niet blijvend het
      // bijhouden van scrollposities blokkeren.
      window.setTimeout(() => {
        if (pendingPop.current === pending) pendingPop.current = null;
      }, 5000);
    };
    const stopTraverse = onTraverseStart((key, url) =>
      startTraverse(savedScrollPosition(key), locationKey(url.pathname, url.searchParams.toString()))
    );
    // Zonder Navigation API: popstate. Next.js zet de pagina dan al neer
    // vóór deze listener (zie onTraverseStart), dus het layout-effect heeft
    // hem al als nieuwe pagina behandeld en hier volgt het herstel.
    const onPopState = () => {
      if (stopTraverse) return;
      startTraverse(savedScrollPosition(currentEntryKey()), browserLocationKey());
    };
    const onPageHide = () => persistScrollPositions();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("popstate", onPopState);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      stopTraverse?.();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pagehide", onPageHide);
      window.history.scrollRestoration = previous;
    };
  }, []);

  // Layout-effect: draait vóór de effecten van de nieuwe pagina, zodat een
  // pagina die zelf ergens naartoe scrolt (bv. een vers in een les) daarna
  // nog voorgaat.
  useLayoutEffect(() => {
    const previous = lastLocation.current;
    lastLocation.current = location;

    if (previous === null) {
      // Eerste keer laden. Bij herladen of terugkomen van een andere site
      // de laatst bekende positie van dit item terugzetten.
      const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (entry && (entry.type === "reload" || entry.type === "back_forward")) {
        const target = savedScrollPosition(currentEntryKey());
        if (target) restore(target);
      }
      return;
    }
    if (previous === location) return;
    bindContentDepartureEntry(previous.split("?")[0], pathname);

    const pop = pendingPop.current;
    pendingPop.current = null;
    if (pop) {
      restore(pop.target ?? 0);
      return;
    }

    noteInAppNavigation();
    cancelRestore.current?.();
    // Met een #anker scrolt Next.js zelf naar dat element.
    if (!window.location.hash) window.scrollTo({ top: 0, behavior: "instant" });
  }, [location, pathname]);

  return null;
}
