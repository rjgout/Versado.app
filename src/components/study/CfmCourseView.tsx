"use client";

import MyStepNav from "@/components/reading/MyStepNav";
import { jsonMutation } from "@/lib/data/mutation";
import type { PersonalStudyModeValue } from "@/lib/studyContent/personalStudyMode";
import { rememberMode } from "@/lib/studyContent/personalStudyModeClient";
import { myWeekKind } from "@/lib/studyContent/weekLabels";
import type { ResumeReason } from "@/lib/studyContent/weekSelection";
import Link from "next/link";
import { Archive } from "lucide-react";
import { useT } from "@/components/I18nProvider";
import { focusRing, secondaryButton } from "@/components/versado/styles";
import CfmWeekPath, { type WeekRow } from "./CfmWeekPath";

// Het pad van een studiecursus (CFM): een lichte kop (geen totaalvoortgang: CFM is deelname, geen cursus om te voltooien),
// dezelfde leerlijn en "Naar mijn week"-knop als de leescursussen, met de weken als kaarten. De leeswijze is die van de cursus (Stap voor stap of Vrije studie); een week openen bewaart die keuze als voorkeur
// en maakt de week de actieve les (bestaande studiecontext).
export default function CfmCourseView({
  courseName,
  studyAction,
  mode,
  weeks,
  activeWeekId,
  resumeReason,
  sessionKey,
  contexts,
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
  /** De studiecontext per jaargang (werk): een week van een andere jaargang bewaart zijn keuze bij zijn eigen werk. */
  contexts: Record<string, { workKey: string; version: number; activeLessonKey: string | null }>;
  /** Alleen als er gearchiveerde lessen zijn; het archief is geen tweede cursus maar een weergave van dezelfde lessen. */
  archiveHref?: string | null;
}) {
  const t = useT();

  async function remember(lessonKey: string, workKey?: string) {
    void rememberMode(mode);
    const context = workKey ? contexts[workKey] : Object.values(contexts)[0];
    if (!context || lessonKey === context.activeLessonKey) return;
    try {
      await jsonMutation("/api/study-context", { method: "PUT", json: { workKey: context.workKey, activeLessonKey: lessonKey, expectedVersion: context.version, actionId: crypto.randomUUID() } }, { invalidates: "studyContextChanged" });
    } catch {
      /* de keuze blijft dan zoals ze was; de navigatie wacht hier nooit op */
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 sm:gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="vs-wrap text-2xl font-extrabold text-vs-fg">{courseName}</h1>
        {studyAction}
      </div>
      {archiveHref && (
        <Link href={archiveHref} prefetch={false} data-cfm-archive-link className={`${secondaryButton} min-h-12 w-full ${focusRing}`}>
          <Archive aria-hidden size={18} className="shrink-0" />
          {t("cfmProgramme.archiveLink")}
        </Link>
      )}
      <CfmWeekPath weeks={weeks} mode={mode} activeWeekId={activeWeekId} resumeReason={resumeReason} sessionKey={sessionKey} onOpenWeek={(key, workKey) => void remember(key, workKey)} />
      <MyStepNav currentKey={activeWeekId} kind={myWeekKind(resumeReason)} />
    </div>
  );
}
