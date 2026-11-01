"use client";
import { useLiveQuery } from "@/lib/data/hooks";
import { fetchJson } from "@/lib/data/fetchJson";
import { useT } from "@/components/I18nProvider";
import { WeekStepCards } from "./CfmWeekStepsView";
import { type StepPlanResponse, type WeekStepsProps } from "./CfmWeekPath";
export function WebWeekSteps({week,sessionKey}:WeekStepsProps) {
 const t=useT();
 const query=useLiveQuery<StepPlanResponse>(["studySteps","plan",sessionKey,week.id],()=>fetchJson(`/api/study-steps?lessonEditionId=${encodeURIComponent(week.id)}`),{scopes:["studySteps"],staleTime:30000});
 if(query.error&&!query.data)return <p role="status" className="text-sm text-vs-fg-2">{t("cfmStudy.stepsFailed")}</p>;
 if(!query.data)return <p role="status" className="text-sm text-vs-fg-2">{t("cfmStudy.stepsLoading")}</p>;
 return <WeekStepCards week={week} data={query.data}/>;
}
