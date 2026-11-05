"use client";
import { useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { focusRing, iconButton } from "@/components/versado/styles";
import type { WeekContext } from "@/lib/studyContent/weekContext";

export type PersonalMode = "free" | "steps" | "full";

import { lessonBase } from "@/lib/studyContent/presentation";
export { lessonBase } from "@/lib/studyContent/presentation";

/** Compact menu voor secundaire acties (opnieuw bovenaan, volledige les). Geen eigen laag buiten de pagina. */
export function HeaderMenu({ children }: { children: ReactNode }) {
  const t = useT();
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      const element = details.current;
      if (!element?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        element.open = false;
        element.querySelector("summary")?.focus();
      } else if (!element.contains(event.target as Node)) element.open = false;
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, []);
  return (
    <details ref={details} className="relative" onClick={(e) => { if ((e.target as HTMLElement).closest("a,button[data-menu-item]")) e.currentTarget.open = false; }}>
      <summary aria-label={t("cfmStudy.menu")} className={`${iconButton} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}>
        <MoreHorizontal aria-hidden className="h-5 w-5" />
      </summary>
      <div className="absolute right-0 z-20 mt-1 flex w-64 max-w-[calc(100vw-2rem)] flex-col rounded-xl border border-vs-line bg-vs-elevated p-1 shadow-lg">{children}</div>
    </details>
  );
}
export const menuItem = `flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-vs-fg hover:bg-vs-subtle disabled:opacity-50 ${focusRing}`;

/** Vorige en volgende gepubliceerde week van hetzelfde programma; nooit een verzonnen of overgeslagen week. */
export function WeekNav({ week, suffix = "" }: { week: WeekContext; suffix?: string }) {
  const t = useT();
  if (!week.prev && !week.next) return null;
  const href = (link: { lessonId: string; collectionId: string }) => `${lessonBase(link.lessonId, link.collectionId)}${suffix}`;
  const cell = `flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border border-vs-line px-3 py-2 text-sm hover:bg-vs-subtle ${focusRing}`;
  return (
    <nav aria-label={t("cfmStudy.chooseWeek")} className="flex gap-2">
      {week.prev ? (
        <Link href={href(week.prev)} prefetch={false} className={cell}>
          <ChevronLeft aria-hidden className="h-5 w-5 shrink-0" />
          <span className="min-w-0"><span className="block font-bold">{t("cfmStudy.previousWeek")}</span><span className="block break-words text-vs-fg-2">{week.prev.title}</span></span>
        </Link>
      ) : <span className="flex-1" />}
      {week.next ? (
        <Link href={href(week.next)} prefetch={false} className={`${cell} justify-end text-right`}>
          <span className="min-w-0"><span className="block font-bold">{t("cfmStudy.nextWeek")}</span><span className="block break-words text-vs-fg-2">{week.next.title}</span></span>
          <ChevronRight aria-hidden className="h-5 w-5 shrink-0" />
        </Link>
      ) : <span className="flex-1" />}
    </nav>
  );
}

/** "2–8 maart" in de taal van de gebruiker, uit officiële kalenderdagen (eind exclusief); zonder tijdzonerekensom. */
export { formatWeekPeriod } from "@/lib/studyContent/presentation";

/** Zeven blokjes met de status per stap; de status staat ook als tekst (aria-label), nooit alleen als kleur. */
export function StepDots({ statuses, current }: { statuses: ReadonlyArray<"NOT_STARTED" | "IN_PROGRESS" | "COMPLETED">; current: number }) {
  const t = useT();
  const done = statuses.filter((s) => s === "COMPLETED").length;
  return (
    <div role="img" aria-label={t("cfmStudy.stepsDots", { done, total: statuses.length, n: current })} className="flex gap-1">
      {statuses.map((status, i) => (
        <span
          key={i}
          aria-hidden
          className={`h-1.5 flex-1 rounded-full ${status === "COMPLETED" ? "bg-vs-accent" : status === "IN_PROGRESS" ? "bg-vs-accent/50" : "bg-vs-subtle"} ${i + 1 === current ? "ring-2 ring-vs-accent ring-offset-1 ring-offset-vs-app" : ""}`}
        />
      ))}
    </div>
  );
}
