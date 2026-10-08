"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { findTarget, isFixedTarget, measureInsets, waitForTarget } from "@/lib/kompas/dom";
import { nextTourIndex, planTour, tourStepKeys, type KompasTour, type KompasTourStep } from "@/lib/kompas/tours";
import { computeTourLayout, scrollDeltaFor, type TourLayout } from "@/lib/kompas/tourLayout";
import { focusRing, primaryButton, secondaryButton } from "@/components/versado/styles";

export type TourResult = "COMPLETED" | "SKIPPED" | "ABORTED";

const CARD_MAX_WIDTH = 380;
// Hoe lang we op een doel wachten dat nog laadt (bijvoorbeeld een lijst die zijn gegevens ophaalt).
const WAIT_FOR_TARGET_MS = 3000;

/**
 * Een rondleiding over echte interfaceonderdelen. De rondleiding markeert een
 * doel en toont een kaart; ze klikt, navigeert en wijzigt nooit iets. De
 * achtergrond is tijdens de rondleiding niet bedienbaar (een tik erop doet
 * niets), zodat niemand per ongeluk de gemarkeerde knop gebruikt; sluiten kan
 * altijd, met de knop, met Escape of met Overslaan. Ontbreekt een doel, dan
 * wordt de stap overgeslagen; blijft er niets over, dan stopt de rondleiding.
 */
export default function TourOverlay({ tour, onEnd, onStarted }: { tour: KompasTour; onEnd: (result: TourResult) => void; onStarted: () => void }) {
  const t = useT();
  const titleId = useId();
  const textId = useId();
  const cardRef = useRef<HTMLDivElement | null>(null);
  // De kaart bestaat pas na de eerste plaatsing; als state zodat meten en meekijken opnieuw beginnen zodra hij er is.
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const attachCard = useCallback((element: HTMLDivElement | null) => {
    cardRef.current = element;
    setCardEl(element);
  }, []);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const [plan, setPlan] = useState<KompasTourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  // measured: de plaatsing is met de echte hoogte van de kaart berekend; eerder blijft de kaart onzichtbaar (geen verspringen).
  const [layout, setLayout] = useState<(TourLayout & { measured: boolean }) | null>(null);

  const endRef = useRef(onEnd);
  const startedRef = useRef(onStarted);
  useEffect(() => {
    endRef.current = onEnd;
    startedRef.current = onStarted;
  });

  // Het plan: de stappen waarvan het doel er is, nadat het eerste doel kans had om te verschijnen.
  useEffect(() => {
    returnFocus.current = document.activeElement;
    let cancelled = false;
    // Het eerste doel is het kenmerk van de pagina zelf (bv. de kop van de cursuslijst): zodra dat er is, is de rest er ook.
    waitForTarget(tour.steps[0].target, WAIT_FOR_TARGET_MS).then(() => {
      if (cancelled) return;
      const steps = planTour(tour, (target) => findTarget(target) !== null);
      if (steps.length === 0) {
        endRef.current("ABORTED");
        return;
      }
      setPlan(steps);
      startedRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [tour]);

  const step = plan?.[index] ?? null;

  const measure = useCallback(() => {
    if (!step) return;
    const element = findTarget(step.target);
    if (!element) return;
    const card = cardEl;
    const viewport = { width: document.documentElement.clientWidth, height: window.visualViewport?.height ?? window.innerHeight };
    const insets = measureInsets();
    const fixed = isFixedTarget(element);
    const cardHeight = card?.offsetHeight ?? 180;
    const rect = element.getBoundingClientRect();
    // Eerst zichtbaar maken (het scrollen verplaatst het doel), dan pas plaatsen.
    const delta = scrollDeltaFor(rect, viewport, insets, cardHeight, fixed);
    if (Math.abs(delta) > 1) window.scrollBy({ top: delta, behavior: "auto" });
    const placed = delta !== 0 ? element.getBoundingClientRect() : rect;
    setLayout({
      ...computeTourLayout({
        target: { top: placed.top, left: placed.left, width: placed.width, height: placed.height },
        viewport,
        insets,
        card: { width: CARD_MAX_WIDTH, height: cardHeight },
        fixed,
      }),
      measured: card !== null,
    });
  }, [step, cardEl]);

  // Bij elke stap: meten, scrollen, plaatsen en de aandacht naar de kaart.
  useLayoutEffect(() => {
    if (!step) return;
    if (!findTarget(step.target)) {
      // Het doel verdween tussen twee stappen: veilig doorgaan of stoppen.
      const next = plan ? nextTourIndex(plan, index, 1, (target) => findTarget(target) !== null) : null;
      // Uitgesteld: een stap overslaan is een reactie op het DOM, geen gevolg van deze render.
      queueMicrotask(() => (next === null ? endRef.current("COMPLETED") : setIndex(next)));
      return;
    }
    // Meten leest de pagina (en scrolt); een frame uitstellen houdt dat los van de render.
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [step, index, plan, measure]);

  // De kaart bestaat pas als de plaatsing klaar is; dan krijgt de kop de aandacht (en leest een schermlezer hem voor).
  const placed = layout?.measured === true;
  useLayoutEffect(() => {
    if (!step || !placed) return;
    const heading = headingRef.current;
    heading?.focus({ preventScroll: true });
    // Een element dat nog niet zichtbaar is kan geen focus krijgen: probeer het een paar frames opnieuw.
    let frame = 0;
    let tries = 0;
    const retry = () => {
      if (!heading || document.activeElement === heading || tries++ > 20) return;
      heading.focus({ preventScroll: true });
      frame = requestAnimationFrame(retry);
    };
    if (heading && document.activeElement !== heading) frame = requestAnimationFrame(retry);
    return () => cancelAnimationFrame(frame);
  }, [step, placed]);

  // De markering volgt het doel bij scrollen, draaien, het toetsenbord en een kaart die van hoogte verandert.
  useEffect(() => {
    if (!step) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const element = findTarget(step.target);
        if (!element) return;
        const card = cardEl;
        const viewport = { width: document.documentElement.clientWidth, height: window.visualViewport?.height ?? window.innerHeight };
        const rect = element.getBoundingClientRect();
        setLayout({
          ...computeTourLayout({
            target: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
            viewport,
            insets: measureInsets(),
            card: { width: CARD_MAX_WIDTH, height: card?.offsetHeight ?? 180 },
            fixed: isFixedTarget(element),
          }),
          measured: card !== null,
        });
      });
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (cardEl) observer?.observe(cardEl);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [step, cardEl]);

  const finish = useCallback((result: TourResult) => {
    const target = returnFocus.current;
    if (target instanceof HTMLElement) target.focus({ preventScroll: true });
    endRef.current(result);
  }, []);

  const isLast = plan ? nextTourIndex(plan, index, 1, (target) => findTarget(target) !== null) === null : true;
  const go = useCallback(
    (direction: 1 | -1) => {
      if (!plan) return;
      const next = nextTourIndex(plan, index, direction, (target) => findTarget(target) !== null);
      if (next === null) {
        if (direction === 1) finish("COMPLETED");
        return;
      }
      setIndex(next);
    },
    [plan, index, finish],
  );

  // Escape sluit; Tab blijft in de kaart (de achtergrond is niet bedienbaar).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        finish("SKIPPED");
      } else if (event.key === "Tab" && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])");
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === headingRef.current)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        } else if (!cardRef.current.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [finish]);

  if (!plan || !step) return null;
  const keys = tourStepKeys(tour, step);
  const total = plan.length;

  return (
    <div data-kompas-tour className="vs-motion fixed inset-0 z-[70]" role="presentation">
      {/* Vangt tikken op, zodat de pagina eronder tijdens de rondleiding niets doet. */}
      <div className="absolute inset-0" aria-hidden="true" />
      {layout && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none fixed rounded-2xl ring-2 ring-vs-accent transition-all duration-200"
            style={{
              top: layout.highlight.top,
              left: layout.highlight.left,
              width: layout.highlight.width,
              height: layout.highlight.height,
              boxShadow: "0 0 0 100vmax rgb(var(--vs-overlay) / 0.55)",
            }}
          />
          <div
            ref={attachCard}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={textId}
            className="fixed flex flex-col gap-3 overflow-y-auto rounded-2xl border border-vs-line bg-vs-elevated p-4 text-vs-fg shadow-[0_12px_40px_-12px_rgb(var(--vs-shadow)/0.45)]"
            style={{ top: layout.card.top, left: layout.card.left, width: layout.card.width, maxHeight: layout.card.maxHeight, visibility: layout.measured ? "visible" : "hidden" }}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="pt-2.5 text-xs font-extrabold uppercase tracking-wide text-vs-fg-2" role="status">
                {t("kompas.tour.step", { n: index + 1, total })}
              </p>
              <button
                type="button"
                onClick={() => finish("SKIPPED")}
                aria-label={t("kompas.tour.close")}
                className={`-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-vs-fg-2 transition hover:bg-vs-subtle hover:text-vs-fg ${focusRing}`}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-lg font-extrabold leading-snug outline-none">
                {t(keys.title)}
              </h2>
              <p id={textId} className="text-base leading-relaxed text-vs-fg-2">
                {t(keys.text)}
              </p>
              {index === 0 && <p className="mt-1 text-xs text-vs-fg-3">{t("kompas.tour.hint")}</p>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {!isLast ? (
                <button type="button" onClick={() => finish("SKIPPED")} className={`min-h-11 rounded-full px-3 text-sm font-bold text-vs-fg-2 underline-offset-2 hover:underline ${focusRing}`}>
                  {t("kompas.tour.skip")}
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                {index > 0 && (
                  <button type="button" onClick={() => go(-1)} className={`${secondaryButton} !min-h-11`}>
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                    {t("kompas.tour.back")}
                  </button>
                )}
                <button type="button" onClick={() => go(1)} className={`${primaryButton} !min-h-11`}>
                  {isLast ? t("kompas.tour.done") : t("kompas.tour.next")}
                  {!isLast && <ChevronRight className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
