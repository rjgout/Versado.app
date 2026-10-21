"use client";

import MyStepNav from "@/components/reading/MyStepNav";
import { jsonMutation } from "@/lib/data/mutation";
import type { PersonalStudyModeValue } from "@/lib/studyContent/personalStudyMode";
import { rememberMode } from "@/lib/studyContent/personalStudyModeClient";
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
  activeIsCalendar,
  sessionKey,
  context,
}: {
  courseName: string;
  studyAction?: React.ReactNode;
  mode: PersonalStudyModeValue;
  weeks: WeekRow[];
  activeWeekId: string | null;
  /** True als de actieve week de werkelijke kalenderweek is; anders is het de hervatweek en heet hij nergens "deze week". */
  activeIsCalendar: boolean;
  sessionKey: string;
  context: { workKey: string; version: number; activeLessonKey: string | null } | null;
}) {

  async function remember(lessonKey: string) {
    void rememberMode(mode);
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
      <CfmWeekPath weeks={weeks} mode={mode} activeWeekId={activeWeekId} activeIsCalendar={activeIsCalendar} sessionKey={sessionKey} onOpenWeek={(key) => void remember(key)} />
      <MyStepNav currentKey={activeWeekId} kind={activeIsCalendar ? "week" : "resumeWeek"} />
    </div>
  );
}
