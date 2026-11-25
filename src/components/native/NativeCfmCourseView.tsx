"use client";
import { createContext,useContext,useEffect,useRef } from "react";
import CfmCourseView from "@/components/study/CfmCourseView";
import CfmArchiveView from "@/components/study/CfmArchiveView";
import { WeekStepCards,type WeekStepsProps } from "@/components/study/CfmWeekPath";
import { useNativeData,useNativeLiveQuery } from "@/lib/data/nativeHooks";
import { nativeLearningTransientError } from "@/lib/data/native";
import { useAppNavigation } from "@/components/navigation/AppNavigation";
import { useT } from "@/components/I18nProvider";
import { NativeClientError } from "@/lib/native/client";
import { focusNativeRouteHeading } from "@/lib/native/routeFocus";
import type { NativeContentState } from "@/lib/native/contract";
import { localDayRange } from "@/lib/timeZone";
import { NativeStudyMediaProvider } from "./NativeStudyImage";

type Props={userId:string;language:string;content:NativeContentState;courseId:string;onError:(error:unknown)=>void};
const Context=createContext<Props|null>(null);
function useFailure(error:unknown,onError:Props["onError"]) {
 useEffect(()=>{if(error instanceof NativeClientError && (error.status===401 || error.code.startsWith("access_") || error.code==="content_context_changed"))onError(error);},[error,onError]);
}
function NativeWeekSteps({week}:WeekStepsProps) {
 const props=useContext(Context)!;const runtime=useNativeData(),t=useT(),revision=week.revisionId!;
 const query=useNativeLiveQuery(["studySteps","native-plan",props.userId,props.language,props.content.picker.activeCollectionId,props.content.picker.selectionVersion,props.courseId,week.id,revision],()=>runtime.studySteps(props.userId,props.language,props.content.picker,props.courseId,week.id,revision),{scopes:["studySteps","studyContent","content"],staleTime:30000,pollMs:60000});
 useFailure(query.error,props.onError);
 if(!query.data || (query.error&&!nativeLearningTransientError(query.error)))return <div><p role="status">{t(query.error?"cfmStudy.stepsFailed":"cfmStudy.stepsLoading")}</p>{!!query.error&&<button type="button" className="btn-secondary" disabled={query.isFetching} onClick={()=>{void query.refetch();}}>{t("nativeFoundation.retry")}</button>}</div>;
 return <><WeekStepCards week={week} data={query.data}/>{!!query.error&&<p role="status">{t("nativeLearning.refreshFailed")}</p>}</>;
}
export default function NativeCfmCourseView(props:Props) {
 const runtime=useNativeData(),navigation=useAppNavigation(),t=useT(),scope=navigation.pathname.endsWith("/archief")?"archive":"weeks";
 const query=useNativeLiveQuery(["courses","study",props.userId,props.language,props.content.picker.activeCollectionId,props.content.picker.selectionVersion,props.courseId,scope],()=>runtime.studyCourse(props.userId,props.language,props.content.picker,props.courseId,scope),{scopes:["courses","content","progress","studyContext","studySteps","studyContent"],staleTime:60000,pollMs:60000,validUntil:data=>localDayRange(data.today,data.timeZone).end.getTime()});
 useFailure(query.error,props.onError);
 const data=query.data,focused=useRef("");
 const identity=data?`${props.userId}:${data.selectionVersion}:${navigation.pathname}`:"";
 useEffect(()=>{if(identity&&focused.current!==identity){focused.current=identity;return focusNativeRouteHeading();}},[identity]);
 useEffect(()=>{if(data&&scope==="weeks"){
   if(!data.weeks.length&&data.archivedCount)navigation.replace(`/courses/${props.courseId}/archief`);
   else if(!navigation.pathname.endsWith("/pad"))navigation.replace(`/courses/${props.courseId}/pad`);
 }},[data,scope,props.courseId,navigation]);
 if(!data || (query.error&&!nativeLearningTransientError(query.error)))return <section><h1 tabIndex={-1}>{t("pages.courses")}</h1><p role="status">{t(query.error?"nativeLearning.pathUnavailable":"nativeFoundation.loading")}</p><button className="btn-secondary" onClick={()=>{void query.refetch();}}>{t("nativeFoundation.retry")}</button></section>;
 return <Context.Provider value={props}><NativeStudyMediaProvider state={data}>
 {scope==="archive"?<CfmArchiveView courseName={data.courseName} mode={data.mode} groups={data.groups} truncated={data.truncated}/>:<CfmCourseView courseName={data.courseName} mode={data.mode} weeks={data.weeks} activeWeekId={data.activeWeekId} resumeReason={data.resumeReason} sessionKey={`${props.userId}:${data.selectionVersion}`} archiveHref={data.archivedCount?`/courses/${props.courseId}/archief`:null} StepContent={NativeWeekSteps} truncated={data.truncated}/>}
 {!!query.error&&<section role="status"><p>{t("nativeLearning.refreshFailed")}</p><button className="btn-secondary" onClick={()=>{void query.refetch();}}>{t("nativeFoundation.retry")}</button></section>}
 </NativeStudyMediaProvider></Context.Provider>;
}
