"use client";
import CfmCourseView from "./CfmCourseView";
import { WebWeekSteps } from "./WebWeekSteps";
import { jsonMutation } from "@/lib/data/mutation";
import { rememberMode } from "@/lib/studyContent/personalStudyModeClient";
export default function WebCfmCourseView({contexts,...props}: Parameters<typeof CfmCourseView>[0] & {contexts:Record<string,{workKey:string;version:number;activeLessonKey:string|null}>}) {
  async function remember(lessonKey:string,workKey?:string) {
    void rememberMode(props.mode);
    const context=workKey?contexts[workKey]:Object.values(contexts)[0];
    if(!context || lessonKey===context.activeLessonKey)return;
    try { await jsonMutation("/api/study-context",{method:"PUT",json:{workKey:context.workKey,activeLessonKey:lessonKey,expectedVersion:context.version,actionId:crypto.randomUUID()}},{invalidates:"studyContextChanged"}); } catch { /* Bestaande keuze behouden; navigatie wacht niet. */ }
  }
  return <CfmCourseView {...props} StepContent={WebWeekSteps} onOpenWeek={(key,work)=>void remember(key,work)}/>;
}
