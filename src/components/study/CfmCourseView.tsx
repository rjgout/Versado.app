"use client";

import { useT } from "@/components/I18nProvider";
import CoursePathHeader from "@/components/reading/CoursePathHeader";
import MyStepNav from "@/components/reading/MyStepNav";
import { jsonMutation } from "@/lib/data/mutation";
import { PERSONAL_STUDY_STEPS } from "@/lib/studyContent/personalStudy";
import type { PersonalStudyModeValue } from "@/lib/studyContent/personalStudyMode";
import { rememberMode } from "@/lib/studyContent/personalStudyModeClient";
import CfmWeekPath, { type WeekRow } from "./CfmWeekPath";

// Het pad van een studiecursus (CFM): dezelfde kop, leerlijn en "Naar mijn week"-knop als de leescursussen, met de weken als
// kaarten. De leeswijze is die van de cursus (Stap voor stap of Vrije studie); een week openen bewaart die keuze als voorkeur
// en maakt de week de actieve les (bestaande studiecontext).
export default function CfmCourseView({
  courseName,
  studyAction,
  mode,
  weeks,
  activeWeekId,
  sessionKey,
  context,
}: {
  courseName: string;
  studyAction?: React.ReactNode;
  mode: PersonalStudyModeValue;
  weeks: WeekRow[];
  activeWeekId: string | null;
  sessionKey: string;
  context: { workKey: string; version: number; activeLessonKey: string | null } | null;
}) {
  const t = useT();
  const isDone = (week: WeekRow) => week.read || week.stepsDone >= PERSONAL_STUDY_STEPS;
  const completed = weeks.filter(isDone).length;

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
      <CoursePathHeader
        courseName={courseName}
        studyAction={studyAction}
        completed={completed}
        total={weeks.length}
        unitPlural={t("cfmStudy.weekUnit")}
        anyProgress={weeks.some((week) => week.read || week.stepsDone > 0)}
        allDone={weeks.length > 0 && completed === weeks.length}
      />
      <CfmWeekPath weeks={weeks} mode={mode} activeWeekId={activeWeekId} sessionKey={sessionKey} onOpenWeek={(key) => void remember(key)} />
      <MyStepNav currentKey={activeWeekId} kind="week" />
    </div>
  );
}
