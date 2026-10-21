"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { primaryButton } from "@/components/versado/styles";
import { currentEntryKey } from "@/lib/navigationHistory";
import { requestScrollRestore } from "@/lib/scrollRestore";
import { myStepDirection, pathScrollTarget, type MyStepDirection } from "@/lib/readingPath";

// Gedeelde positionering voor de leespaden (Stap voor stap, Hoofdstuk voor hoofdstuk): de eerstvolgende activiteit
// staat bij het openen in beeld, en "Naar mijn stap/hoofdstuk" brengt de gebruiker er later terug, met een pijl in de
// richting waar de activiteit zit. Het doel is het element [data-current-step] binnen [data-path-current].

function cssPx(name: string): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
}

/** Waar het venster moet staan om de actieve activiteit (en het hoofdstuk ervoor) te tonen; null zolang die er niet is. */
export function currentScrollTarget(): number | null {
  const current = document.querySelector<HTMLElement>("[data-path-current]");
  const step = current?.querySelector<HTMLElement>("[data-current-step]");
  if (!current || !step) return null;
  const doc = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
  // het vorige hoofdstuk: de kaart vóór de huidige (het verbindingsstuk ertussen is geen kaart)
  const previous = current.previousElementSibling?.previousElementSibling as HTMLElement | null | undefined;
  const stepTop = doc(step);
  return pathScrollTarget({
    previousTop: previous ? doc(previous) : null,
    cardTop: doc(current),
    stepTop,
    stepBottom: stepTop + step.getBoundingClientRect().height,
    header: cssPx("--header-offset"),
    nav: cssPx("--nav-height"),
    viewport: window.innerHeight,
  });
}

/**
 * @param currentKey id van de actieve stap of het actieve hoofdstuk; null = niets te positioneren (alles af of Vrije keuze)
 * @param revealKey wijzigt wanneer het doel kan verschijnen of verdwijnen (bv. een boek dat wordt in- of uitgeklapt)
 */
export default function MyStepNav({ currentKey, revealKey = "", kind = "step" }: { currentKey: string | null; revealKey?: string; kind?: "step" | "chapter" | "week" | "chosenWeek" | "studiedWeek" }) {
  const t = useT();
  const sig = `${currentKey ?? ""}|${revealKey}`;
  const [seen, setSeen] = useState<{ sig: string; direction: MyStepDirection | null }>({ sig: "", direction: null });
  const [settled, setSettled] = useState(false);
  const direction = seen.sig === sig ? seen.direction : null;

  // Bij het openen staat de actieve activiteit in beeld. Het scrollcoördinatiepunt (NavigationScroll) bepaalt of
  // dat mag: terug/vooruit herstelt de oude positie en wie al scrolde of tikte wordt nooit overschreven.
  useEffect(() => {
    if (!currentKey) return;
    requestScrollRestore(currentEntryKey(), "position", currentScrollTarget);
  }, [currentKey]);

  // De knop pas na de eerste positionering, en alleen als de actieve activiteit buiten beeld is geraakt.
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), 1200);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!currentKey) return;
    const step = document.querySelector<HTMLElement>("[data-current-step]");
    if (!step || typeof IntersectionObserver === "undefined") return;
    // Het zichtbare gebied is het scherm tussen de vaste balken; de richting volgt uit de werkelijke plek van het doel.
    const header = cssPx("--header-offset");
    const nav = cssPx("--nav-height");
    const observer = new IntersectionObserver(
      ([entry]) => {
        const r = entry.boundingClientRect;
        setSeen({ sig, direction: entry.isIntersecting ? null : myStepDirection({ top: r.top, bottom: r.bottom, header, nav, viewport: window.innerHeight }) });
      },
      { threshold: 0, rootMargin: `-${Math.round(header)}px 0px -${Math.round(nav)}px 0px` },
    );
    observer.observe(step);
    return () => observer.disconnect();
  }, [currentKey, sig]);

  function goToMyStep() {
    const top = currentScrollTarget();
    if (top === null) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
  }

  if (!settled || !direction) return null;
  return (
    <button
      type="button"
      onClick={goToMyStep}
      aria-label={t(kind === "chapter" ? "courseView.path.myChapterAria" : kind === "week" ? "courseView.path.myWeekAria" : kind === "chosenWeek" ? "courseView.path.myChosenWeekAria" : kind === "studiedWeek" ? "courseView.path.myStudiedWeekAria" : "courseView.path.myStepAria")}
      data-my-step
      data-direction={direction}
      className={`${primaryButton} vs-rise fixed right-3 z-20 !min-h-8 !gap-1 !px-2.5 !py-1 !text-xs shadow-md bottom-[calc(var(--nav-height,0px)+var(--vs-safe-area-bottom,0px)+0.75rem)]`}
    >
      {direction === "down" ? <ArrowDown size={14} className="shrink-0" aria-hidden /> : <ArrowUp size={14} className="shrink-0" aria-hidden />}
      {t(kind === "chapter" ? "courseView.path.myChapter" : kind === "week" ? "courseView.path.myWeek" : kind === "chosenWeek" ? "courseView.path.myChosenWeek" : kind === "studiedWeek" ? "courseView.path.myStudiedWeek" : "courseView.path.myStep")}
    </button>
  );
}
