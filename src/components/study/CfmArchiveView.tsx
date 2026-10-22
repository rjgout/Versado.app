"use client";

import Link from "next/link";
import { useT, useUiLanguage } from "@/components/I18nProvider";
import { focusRing } from "@/components/versado/styles";
import { CFM_SCRIPTURE_LABEL_KEY } from "@/lib/studyContent/cfmProgramme";
import type { CfmScripture } from "@/lib/studyContent/cfmVolumes";
import type { PersonalStudyModeValue } from "@/lib/studyContent/personalStudyMode";
import { formatWeekPeriod, lessonBase } from "./PersonalStudyParts";

export interface ArchiveWeek {
  id: string;
  lessonId: string;
  collectionId: string;
  title: string;
  startsOn: string | null;
  endsOnExclusive: string | null;
  read: boolean;
  stepsDone: number;
}
export interface ArchiveGroupView { workKey: string; year: number; scripture: CfmScripture | null; weeks: ArchiveWeek[] }

/**
 * Het archief van "Kom dan en volg Mij": eerdere lessen per officiële jaargang, chronologisch. Dezelfde lessen en dezelfde
 * leeswijze als het leerpad (geen kopieën): een les openen toont zijn bestaande voortgang, aantekeningen en markeringen.
 * Bewust zonder totaalpercentage: CFM is deelname, geen cursus om te voltooien.
 */
export default function CfmArchiveView({ courseName, mode, groups }: { courseName: string; mode: PersonalStudyModeValue; groups: ArchiveGroupView[] }) {
  const t = useT();
  const language = useUiLanguage();
  return (
    <div data-cfm-archive className="mx-auto flex max-w-2xl flex-col gap-6 sm:gap-8">
      <div className="min-w-0">
        <h1 className="vs-wrap text-2xl font-extrabold text-vs-fg">{courseName}</h1>
        <p className="mt-1 text-sm text-vs-fg-2">{t("cfmProgramme.archiveIntro")}</p>
      </div>
      {groups.length === 0 && <p role="status" className="text-sm text-vs-fg-2">{t("cfmProgramme.archiveEmpty")}</p>}
      {groups.map((group) => (
        <section key={group.workKey} data-archive-year={group.year} aria-labelledby={`archive-${group.workKey}`} className="min-w-0">
          <h2 id={`archive-${group.workKey}`} className="vs-wrap mb-2 text-lg font-extrabold text-vs-fg">
            {t("cfmProgramme.yearHeading", { year: group.year, scripture: group.scripture ? t(CFM_SCRIPTURE_LABEL_KEY[group.scripture] as Parameters<typeof t>[0]) : "" })}
          </h2>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {group.weeks.map((week) => {
              const base = lessonBase(week.lessonId, week.collectionId);
              const period = formatWeekPeriod(week.startsOn, week.endsOnExclusive, language);
              return (
                <li key={week.id} data-archive-week={week.id}>
                  <Link
                    href={mode === "STEPS" ? `${base}/stappen` : base}
                    prefetch={false}
                    className={`flex min-h-12 w-full min-w-0 flex-col rounded-2xl border border-vs-line bg-vs-surface px-3 py-2 text-left hover:bg-vs-subtle ${focusRing}`}
                  >
                    <span className="vs-wrap text-sm font-extrabold text-vs-fg">{week.title}</span>
                    {period && <span className="text-xs text-vs-fg-3">{period}</span>}
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
