"use client";

import Image from "next/image";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { focusRing, primaryButton, secondaryButton } from "@/components/versado/styles";
import { weekLabelKey } from "@/lib/studyContent/weekLabels";
import type { ResumeReason } from "@/lib/studyContent/weekSelection";
import { formatWeekPeriod, lessonBase } from "./PersonalStudyParts";

export interface TodayWeek {
  lessonId: string;
  collectionId: string;
  title: string;
  startsOn: string | null;
  endsOnExclusive: string | null;
  imageMediaId: string | null;
  /** Er is al gestudeerd of de week is bewust gekozen: dan heet de hoofdactie "Verder met studeren". */
  started: boolean;
}

/** Haalt het merk- en jaarvoorvoegsel van de collectienaam; zonder dat patroon blijft de collectienaam staan. */
function collectionLabel(name: string): string {
  return name.replace(/^Kom dan en volg Mij\s*\d*\s*[—–-]\s*/i, "").trim() || name;
}

/**
 * De CFM-kaart op Vandaag: een uitnodiging voor de studie van deze week, geen cursusoverzicht. Bewust zonder totaalvoortgang
 * (CFM is deelname, geen cursus om te voltooien). Eén primaire actie naar de studieles volgens de gekozen leeswijze (de stappenroute
 * hervat zelf bij de juiste stap, `/stappen`), één secundaire naar het weekpad. De terugknop van de les gaat naar Vandaag terug:
 * dat volgt uit de browsergeschiedenis, niet uit een vaste bestemming (docs/CFM-PERSOONLIJKE-STUDIE.md §18).
 * Zonder kalenderweek heet de hervatweek nergens "Deze week".
 */
export default function CfmTodayCard({
  programName,
  mode,
  weeksHref,
  resumeReason,
  week,
}: {
  programName: string;
  mode: "FREE" | "STEPS";
  weeksHref: string;
  resumeReason: ResumeReason | null;
  week: TodayWeek | null;
}) {
  const t = useT();
  const language = useUiLanguage();
  const labelKey = weekLabelKey(resumeReason);
  const period = week ? formatWeekPeriod(week.startsOn, week.endsOnExclusive, language) : null;
  const base = week ? lessonBase(week.lessonId, week.collectionId) : null;
  const studyHref = base ? (mode === "STEPS" ? `${base}/stappen` : base) : null;
  const imageSrc = week?.imageMediaId ? `/api/study-media/${encodeURIComponent(week.imageMediaId)}` : null;
  const heading = week ? week.title : t("cfmToday.noWeekTitle");
  return (
    <section data-cfm-today aria-label={t("cfmToday.brand")} className="min-w-0 overflow-hidden rounded-2xl border border-vs-line bg-vs-surface">
      <div className={`relative flex flex-col justify-end ${imageSrc ? "min-h-[8.5rem] bg-vs-overlay" : "min-h-[5.5rem] bg-gradient-to-br from-vs-accent-soft to-vs-surface"}`}>
        {imageSrc ? (
          <>
            <Image unoptimized src={imageSrc} alt="" fill sizes="(min-width: 1024px) 640px, 100vw" className="vs-decor object-cover" />
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-vs-overlay/90 via-vs-overlay/40 to-transparent" />
          </>
        ) : (
          <BookOpen aria-hidden className="pointer-events-none absolute right-3 top-3 h-12 w-12 text-vs-accent opacity-15" strokeWidth={1.5} />
        )}
        <p className={`relative px-4 pb-3 pt-10 text-xs font-extrabold uppercase tracking-wide ${imageSrc ? "text-white" : "text-vs-accent"}`}>
          {t("cfmToday.brand")}
          {programName ? <span className="font-semibold normal-case tracking-normal"> · {collectionLabel(programName)}</span> : null}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-3 p-4">
        <div className="min-w-0">
          {week && (
            <p className="text-xs font-extrabold uppercase tracking-wide text-vs-accent">
              {labelKey ? t(labelKey) : null}
              {period ? <span className="font-semibold normal-case tracking-normal text-vs-fg-2"> · {period}</span> : null}
            </p>
          )}
          <h2 className="vs-wrap text-lg font-extrabold leading-snug text-vs-fg">{heading}</h2>
          <p className="mt-1 text-sm text-vs-fg-2">{week ? t(resumeReason === "calendar" ? "cfmToday.invite" : "cfmToday.inviteResume") : t("cfmToday.noWeekText")}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {studyHref ? (
            <>
              <Link href={studyHref} prefetch={false} data-cfm-today-primary className={`${primaryButton} min-h-12 flex-1 ${focusRing}`}>
                {week?.started ? t("cfmToday.continue") : t("cfmToday.start")}
              </Link>
              <Link href={weeksHref} prefetch={false} data-cfm-today-secondary className={`${secondaryButton} min-h-12 flex-1`}>
                {t("cfmToday.viewSteps")}
              </Link>
            </>
          ) : (
            <Link href={weeksHref} prefetch={false} data-cfm-today-primary className={`${primaryButton} min-h-12 flex-1`}>
              {t("cfmToday.viewWeeks")}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
