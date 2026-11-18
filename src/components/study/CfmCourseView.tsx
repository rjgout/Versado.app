"use client";

import MyStepNav from "@/components/reading/MyStepNav";
import type { PersonalStudyModeValue } from "@/lib/studyContent/personalStudyMode";
import { myWeekKind } from "@/lib/studyContent/weekLabels";
import type { ResumeReason } from "@/lib/studyContent/weekSelection";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import type { ComponentType } from "react";
import { Archive } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { focusRing, secondaryButton } from "@/components/versado/styles";
import CfmWeekPath, { type WeekRow, type WeekStepsProps } from "./CfmWeekPath";

// Het pad van een studiecursus (CFM): een lichte kop (geen totaalvoortgang: CFM is deelname, geen cursus om te voltooien),
// dezelfde leerlijn en "Naar mijn week"-knop als de leescursussen, met de weken als kaarten. De leeswijze is die van de cursus (Stap voor stap of Vrije studie); een week openen bewaart die keuze als voorkeur
// en maakt de week de actieve les via de webadapter. Native levert alleen read-only data.
export default function CfmCourseView({
  courseName,
  studyAction,
  mode,
  weeks,
  activeWeekId,
  resumeReason,
  sessionKey,
  onOpenWeek,
  StepContent,
  truncated = false,
  archiveHref,
}: {
  courseName: string;
  studyAction?: React.ReactNode;
  mode: PersonalStudyModeValue;
  weeks: WeekRow[];
  activeWeekId: string | null;
  /** Waarom de actieve week de actieve week is (kalenderweek, laatst gekozen, laatst bestudeerd); bepaalt het label. */
  resumeReason: ResumeReason | null;
  sessionKey: string;
  onOpenWeek?: (lessonKey: string, workKey?: string) => void;
  StepContent?: ComponentType<WeekStepsProps>;
  truncated?: boolean;
  /** Alleen als er gearchiveerde lessen zijn; het archief is geen tweede cursus maar een weergave van dezelfde lessen. */
  archiveHref?: string | null;
}) {
  const t = useT();

  return (
    <div className="mx-auto flex w-full min-w-0 max-w-2xl flex-col gap-6 sm:gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 tabIndex={-1} className="vs-wrap text-2xl font-extrabold text-vs-fg">{courseName}</h1>
        {studyAction}
      </div>
      {archiveHref && (
        <Link href={archiveHref} prefetch={false} data-cfm-archive-link className={`${secondaryButton} min-h-12 w-full ${focusRing}`}>
          <Archive aria-hidden size={18} className="shrink-0" />
          {t("cfmProgramme.archiveLink")}
        </Link>
      )}
      {truncated && <p role="status">{t("nativeLearning.catalogueTruncated")}</p>}
      {weeks.length === 0 && <p role="status">{t("programPicker.empty")}</p>}
      <CfmWeekPath weeks={weeks} mode={mode} activeWeekId={activeWeekId} resumeReason={resumeReason} sessionKey={sessionKey} onOpenWeek={onOpenWeek} StepContent={StepContent} />
      <MyStepNav currentKey={activeWeekId} kind={myWeekKind(resumeReason)} />
    </div>
  );
}
