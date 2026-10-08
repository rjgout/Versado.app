"use client";

import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { shellModeForRoute } from "@/lib/focusMode";
import { recordKompasState } from "@/lib/kompas/client";
import { getTour, type KompasTour } from "@/lib/kompas/tours";
import { getTopic } from "@/lib/kompas/registry";
import TourOverlay, { type TourResult } from "@/components/kompas/TourOverlay";

// Versado Kompas voor de hele app: één plek die rondleidingen start en toont.
// Een rondleiding start alleen na een bewuste actie van de gebruiker (een knop
// in Ontdek Versado of in de kennismaking), nooit vanzelf, en is nooit
// verplicht. De param ?kompas=<rondleiding> is het adres van zo'n actie: hij
// wordt direct uit de adresbalk gehaald.

export const KOMPAS_TOUR_PARAM = "kompas";

interface KompasApi {
  /** Start een rondleiding; staat de gebruiker niet op de juiste pagina, dan gaat hij daar eerst heen. */
  startTour: (tourId: string) => void;
  activeTourId: string | null;
}

const KompasContext = createContext<KompasApi>({ startTour: () => {}, activeTourId: null });

export function useKompas(): KompasApi {
  return useContext(KompasContext);
}

export default function KompasProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [started, setActive] = useState<{ tour: KompasTour; pathname: string } | null>(null);
  // Een rondleiding hoort bij één pagina: navigeren (ook met terug) sluit hem zonder iets vast te leggen.
  const active = started && started.pathname === pathname ? started : null;
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  });

  const open = useCallback((tour: KompasTour, at: string) => {
    // Alleen op een gewone pagina: in een activiteit of spel is geen plek voor een rondleiding.
    if (shellModeForRoute(at) !== "normal") return;
    setActive({ tour, pathname: at });
  }, []);

  const startTour = useCallback(
    (tourId: string) => {
      const tour = getTour(tourId);
      if (!tour) return;
      if (tour.route && tour.route !== pathnameRef.current) {
        router.push(`${tour.route}?${KOMPAS_TOUR_PARAM}=${encodeURIComponent(tour.id)}`);
        return;
      }
      open(tour, pathnameRef.current);
    },
    [open, router],
  );

  // Een rondleiding via het adres: starten en de param meteen weghalen, zodat terug, vernieuwen of delen hem niet opnieuw start.
  const startFromAddress = useCallback(
    (tourId: string, at: string) => {
      const url = new URL(window.location.href);
      url.searchParams.delete(KOMPAS_TOUR_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
      const tour = getTour(tourId);
      if (tour && (!tour.route || tour.route === at)) open(tour, at);
    },
    [open],
  );

  const handleEnd = useCallback(
    (tour: KompasTour, result: TourResult) => {
      setActive(null);
      if (result === "ABORTED") return;
      const topic = getTopic(tour.topicId);
      if (topic) void recordKompasState({ topicId: tour.topicId, scope: "", kind: "TOUR", status: result });
    },
    [],
  );

  const handleStarted = useCallback((tour: KompasTour) => {
    void recordKompasState({ topicId: tour.topicId, scope: "", kind: "TOUR", status: "VIEWED" });
  }, []);

  const value = useMemo(() => ({ startTour, activeTourId: active?.tour.id ?? null }), [startTour, active]);

  return (
    <KompasContext.Provider value={value}>
      {children}
      <Suspense fallback={null}>
        <TourFromAddress onTour={startFromAddress} />
      </Suspense>
      {active && (
        <TourOverlay
          key={active.tour.id}
          tour={active.tour}
          onEnd={(result) => handleEnd(active.tour, result)}
          onStarted={() => handleStarted(active.tour)}
        />
      )}
    </KompasContext.Provider>
  );
}

/** Leest ?kompas=<rondleiding> uit het adres; apart zodat alleen dit deel op de zoekparameters wacht. */
function TourFromAddress({ onTour }: { onTour: (tourId: string, pathname: string) => void }) {
  const param = useSearchParams().get(KOMPAS_TOUR_PARAM);
  // Het pad komt mee uit dezelfde render als de param: een effect van een kind loopt vóór dat van de provider.
  const pathname = usePathname();
  useEffect(() => {
    if (param) onTour(param, pathname);
  }, [param, pathname, onTour]);
  return null;
}
