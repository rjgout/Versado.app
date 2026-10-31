"use client";
import { useEffect, useMemo, useRef } from "react";
import { focusNativeRouteHeading } from "@/lib/native/routeFocus";
import CoursesView from "@/components/CoursesView";
import ReadingCourseView from "@/components/ReadingCourseView";
import ChapterListCourseView from "@/components/ChapterListCourseView";
import { ConfirmProvider, useConfirm } from "@/components/ConfirmProvider";
import { useT } from "@/components/I18nProvider";
import { AppNavigationProvider, useAppNavigationAdapter, type AppLinkProps } from "@/components/navigation/AppNavigation";
import { useNativeData, useNativeLiveQuery } from "@/lib/data/nativeHooks";
import { nativeTodayImageSource } from "@/lib/native/todayAssets";
import { nativeRoute } from "@/lib/native/navigation";
import type { NativeContentState } from "@/lib/native/contract";
import { NativeClientError } from "@/lib/native/client";
import NativeStudyImage, { NativeStudyMediaProvider } from "./NativeStudyImage";
import { studyMediaIdFromSource } from "@/lib/native/studyMediaContract";

export default function NativeLearningView(props: { userId: string; language: string; content?: NativeContentState; enabled: boolean; mediaEnabled: boolean; onError: (error: unknown) => void }) {
 return <ConfirmProvider><Learning {...props}/></ConfirmProvider>;
}
function Learning({ userId, language, content, enabled, mediaEnabled, onError }: Parameters<typeof NativeLearningView>[0]) {
 const navigation=useAppNavigationAdapter(),runtime=useNativeData(),t=useT(),confirm=useConfirm();
 const courseId=/^\/courses\/([A-Za-z0-9_-]{1,128})(?:\/pad)?$/.exec(navigation.pathname)?.[1];
 const query=useNativeLiveQuery(["courses",userId,language,content?.picker.activeCollectionId,content?.picker.selectionVersion,courseId ?? "list"],async()=>{const result=await runtime.learning(userId,content!.picker,courseId);if(result.language!==language)throw new NativeClientError("content_context_changed",409);return result;},{
   enabled:enabled && !!content,scopes:["courses","progress","content","studyContext","studyContent","studySteps"],staleTime:60_000,pollMs:60_000,
 });
 useEffect(()=>{if(query.error instanceof NativeClientError && (query.error.status===401 || query.error.code.startsWith("access_") || query.error.code==="content_context_changed"))onError(query.error);},[query.error,onError]);
 const adapter=useMemo(()=>{
  function LearningLink({href,...props}:AppLinkProps){
   if(nativeRoute(href) && /^\/courses(?:\/|$)/.test(href)){const Link=navigation.Link;return <Link {...props} href={href}/>;}
   const {replace,prefetch,onNavigate,...anchor}=props;void replace;void prefetch;void onNavigate;
   const notice=()=>{void confirm(t("nativeToday.unavailable"),{native:true,notice:true,title:t("nav.learn"),confirmLabel:t("common.close")});};
   return <a {...anchor} role="button" tabIndex={props.tabIndex??0} data-native-unavailable-href={href} onClick={e=>{e.preventDefault();notice();}} onKeyDown={e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();notice();}}}/>;
  }
  return {...navigation,Link:LearningLink,...(mediaEnabled?{Image:NativeStudyImage}:{}),imageSource:(src:string)=>mediaEnabled&&studyMediaIdFromSource(src)?src:nativeTodayImageSource(src)};
 },[navigation,mediaEnabled,confirm,t]);
 const data=query.data;
 const focusedIdentity=useRef("");
 const focusIdentity=data ? `${userId}:${data.selectionVersion}:${navigation.pathname}` : "";
 useEffect(()=>{
  if(!focusIdentity || focusedIdentity.current===focusIdentity)return;
  focusedIdentity.current=focusIdentity;
  return focusNativeRouteHeading();
 },[focusIdentity]);
 useEffect(()=>{if(data && "courseId" in data && !navigation.pathname.endsWith("/pad"))navigation.replace(`/courses/${data.courseId}/pad`);},[data,navigation]);
 if(!enabled || !content || !data || query.error || ("chapters" in data && data.chapters.length===0))return <section aria-busy={query.isFetching}><h1 tabIndex={-1} className="text-2xl font-extrabold">{t("pages.courses")}</h1><p role="status">{t(!enabled?"nativeLearning.unsupported":query.error instanceof NativeClientError && query.error.status === 404 ? "nativeLearning.pathUnavailable" : data && "chapters" in data && data.chapters.length===0 ? "nativeLearning.pathUnavailable" : query.error?"nativeFoundation.error":"nativeFoundation.loading")}</p>{enabled&&<button className="btn-secondary" onClick={()=>{void query.refetch();}}>{t("nativeFoundation.retry")}</button>}<button className="btn-secondary" onClick={()=>navigation.back("/dashboard")}>{t("common.back")}</button></section>;
 return <NativeStudyMediaProvider state={data}><AppNavigationProvider adapter={adapter}>
 {"courses" in data ? <><p role="note" className="mx-auto w-full max-w-5xl text-sm text-vs-fg-2">{t("nativeLearning.readOnly")}</p><CoursesView courses={data.courses} catalog={data.catalog}/></> : data.kind==="steps" ? <ReadingCourseView key={`${userId}:${data.courseId}:${data.selectionVersion}`} courseName={data.courseName} unitPlural={data.unitPlural} today={data.todayId?{id:data.todayId}:null} chapters={data.chapters}/> : <ChapterListCourseView key={`${userId}:${data.courseId}:${data.selectionVersion}`} {...data}/>}
 </AppNavigationProvider></NativeStudyMediaProvider>;
}
