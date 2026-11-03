"use client";
import { useEffect, useMemo, useRef } from "react";
import { focusNativeRouteHeading } from "@/lib/native/routeFocus";
import NativeCfmCourseView from "./NativeCfmCourseView";
import { isStudyCourseType } from "@/lib/readingCourses";
import CoursesView from "@/components/CoursesView";
import ReadingCourseView from "@/components/ReadingCourseView";
import ChapterListCourseView from "@/components/ChapterListCourseView";
import { ConfirmProvider, useConfirm } from "@/components/ConfirmProvider";
import { useT } from "@/components/I18nProvider";
import { AppNavigationProvider, useAppNavigationAdapter, type AppLinkProps } from "@/components/navigation/AppNavigation";
import { nativeLearningQueryKey, nativeLearningTransientError } from "@/lib/data/native";
import { useNativeData, useNativeLiveQuery } from "@/lib/data/nativeHooks";
import { nativeTodayImageSource } from "@/lib/native/todayAssets";
import NativeReaderView from "./NativeReaderView";
import { nativeReaderRoute, nativeReaderDestination } from "@/lib/native/readerNavigation";
import { nativeRoute } from "@/lib/native/navigation";
import type { NativeContentState } from "@/lib/native/contract";
import { NativeClientError } from "@/lib/native/client";
import NativeStudyImage, { NativeStudyMediaProvider } from "./NativeStudyImage";
import { studyMediaIdFromSource } from "@/lib/native/studyMediaContract";

export default function NativeLearningView(props: { userId: string; language: string; content?: NativeContentState; enabled: boolean; studyEnabled?: boolean; readerEnabled?: boolean; positionEnabled?: boolean; annotationsEnabled?: boolean; audioEnabled?: boolean; mediaEnabled: boolean; onError: (error: unknown) => void }) {
 return <ConfirmProvider><Learning {...props}/></ConfirmProvider>;
}
function Learning({ userId, language, content, enabled, studyEnabled = false, readerEnabled = false, positionEnabled = false, annotationsEnabled = false, audioEnabled = false, mediaEnabled, onError }: Parameters<typeof NativeLearningView>[0]) {
 const navigation=useAppNavigationAdapter(),runtime=useNativeData(),t=useT(),confirm=useConfirm();
 const readerRoute=nativeReaderRoute(navigation.pathname);
 const readerPage=readerRoute!==null;
 const readerAvailable=readerEnabled&&!!content?.picker.works.some(work=>work.key==="bofm"&&work.editions.some(edition=>edition.id===content.picker.activeCollectionId&&edition.selectable));
 const courseId=readerRoute?.courseId??/^\/courses\/([A-Za-z0-9_-]{1,128})(?:\/(?:pad|archief))?$/.exec(navigation.pathname)?.[1];
 // Beide bestaande observers blijven tijdens lezen bestaan: GC mag het verborgen pad niet remounten.
 const catalogQuery=useNativeLiveQuery(nativeLearningQueryKey(userId,language,content?.picker),()=>runtime.learning(userId,content!.picker),{enabled:studyEnabled&&enabled&&!!courseId&&!!content,scopes:["courses","content","progress","studyContent"],staleTime:readerPage?Infinity:60000});
 const catalog=catalogQuery.data && "courses" in catalogQuery.data ? [...catalogQuery.data.courses,...catalogQuery.data.catalog] : [];
 const isStudy=!!courseId && studyEnabled && catalog.some(course=>course.id===courseId&&isStudyCourseType(course.type));
 const archiveRoute=navigation.pathname.endsWith("/archief");
 const resolving=!!courseId&&studyEnabled&&!catalogQuery.data;
 const query=useNativeLiveQuery(nativeLearningQueryKey(userId,language,content?.picker,courseId),async()=>{const result=await runtime.learning(userId,content!.picker,courseId);if(result.language!==language)throw new NativeClientError("content_context_changed",409);return result;},{
   enabled:enabled && !!content && !isStudy && !resolving && !archiveRoute,scopes:["courses","progress","content","studyContext","studyContent","studySteps"],staleTime:readerPage?Infinity:60_000,pollMs:readerPage?undefined:60_000,
 });
 useEffect(()=>{const error=catalogQuery.error??query.error;if(!(readerPage&&nativeLearningTransientError(error)) && error instanceof NativeClientError && (error.status===401 || error.code.startsWith("access_") || error.code==="content_context_changed"))onError(error);},[query.error,catalogQuery.error,onError,readerPage]);
 const adapter=useMemo(()=>{
  function LearningLink({href,...props}:AppLinkProps){
   const reader=readerAvailable&&courseId?nativeReaderDestination(href,courseId):null;
   if(reader){const Link=navigation.Link;return <Link {...props} href={reader}/>;}
   if(nativeRoute(href) && /^\/courses(?:\/|$)/.test(href)){const Link=navigation.Link;return <Link {...props} href={href}/>;}
   const {replace,prefetch,onNavigate,...anchor}=props;void replace;void prefetch;void onNavigate;
   const notice=()=>{void confirm(t("nativeToday.unavailable"),{native:true,notice:true,title:t("nav.learn"),confirmLabel:t("common.close")});};
   return <a {...anchor} role="button" tabIndex={props.tabIndex??0} data-native-unavailable-href={href} onClick={e=>{e.preventDefault();notice();}} onKeyDown={e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();notice();}}}/>;
  }
  return {...navigation,Link:LearningLink,...(mediaEnabled?{Image:NativeStudyImage}:{}),imageSource:(src:string)=>mediaEnabled&&studyMediaIdFromSource(src)?src:nativeTodayImageSource(src)};
 },[navigation,mediaEnabled,confirm,t,readerAvailable,courseId]);
 const data=query.data;
 const failure=catalogQuery.error??query.error;
 const transientFailure = nativeLearningTransientError(query.error);
 const focusedIdentity=useRef("");
 const focusIdentity=data && !isStudy && !readerRoute ? `${userId}:${data.selectionVersion}:${navigation.pathname}` : "";
 useEffect(()=>{
  if(readerPage){focusedIdentity.current="";return;}
  if(!focusIdentity || focusedIdentity.current===focusIdentity)return;
  focusedIdentity.current=focusIdentity;
  return focusNativeRouteHeading();
 },[focusIdentity,readerPage]);
 useEffect(()=>{if(!readerPage && !isStudy && !archiveRoute && data && "courseId" in data && !navigation.pathname.endsWith("/pad"))navigation.replace(`/courses/${data.courseId}/pad`);},[data,navigation,isStudy,archiveRoute,readerPage]);
 const readerParentError=[catalogQuery.error,query.error].find(error=>error&&!nativeLearningTransientError(error))??catalogQuery.error??query.error;
 const reader=readerRoute?<NativeReaderView key={`${userId}:${runtime.getSnapshot()}:${language}:${content?.picker.selectionVersion}:${navigation.pathname}`} userId={userId} language={language} content={content} enabled={readerEnabled} positionEnabled={positionEnabled} annotationsEnabled={annotationsEnabled} audioEnabled={audioEnabled} route={readerRoute} onError={onError} parentError={readerParentError} retryParent={()=>{if(catalogQuery.error)void catalogQuery.refetch();if(query.error)void query.refetch();}}/>:null;
 if(!readerRoute && isStudy && content && (!catalogQuery.error || nativeLearningTransientError(catalogQuery.error)))return <AppNavigationProvider adapter={adapter}><NativeCfmCourseView userId={userId} language={language} content={content} courseId={courseId!} onError={onError}/></AppNavigationProvider>;
 if(!readerRoute&&((archiveRoute&&!isStudy) || resolving || (catalogQuery.error && !nativeLearningTransientError(catalogQuery.error)) || !enabled || !content || !data || (query.error && !transientFailure) || ("chapters" in data && data.chapters.length===0)))return <section aria-busy={query.isFetching}><h1 tabIndex={-1} className="text-2xl font-extrabold">{t("pages.courses")}</h1><p role="status">{t(!enabled?"nativeLearning.unsupported":archiveRoute&&!isStudy?"nativeLearning.pathUnavailable":failure instanceof NativeClientError && failure.status === 404 ? "nativeLearning.pathUnavailable" : data && "chapters" in data && data.chapters.length===0 ? "nativeLearning.pathUnavailable" : failure?"nativeFoundation.error":"nativeFoundation.loading")}</p>{enabled&&(!archiveRoute||resolving)&&<button className="btn-secondary" onClick={()=>{void (resolving||catalogQuery.error?catalogQuery.refetch():query.refetch());}}>{t("nativeFoundation.retry")}</button>}<button className="btn-secondary" onClick={()=>navigation.back("/dashboard")}>{t("common.back")}</button></section>;
 return <NativeStudyMediaProvider state={data??{userId,activeCollectionId:content?.picker.activeCollectionId??null,selectionVersion:content?.picker.selectionVersion??0}}><AppNavigationProvider adapter={adapter}><div hidden={!!readerRoute}>
 {data && ("courses" in data ? <><p role="note" className="mx-auto w-full max-w-5xl text-sm text-vs-fg-2">{t("nativeLearning.readOnly")}</p><CoursesView courses={data.courses} catalog={data.catalog}/></> : data.kind==="steps" ? <ReadingCourseView key={`${userId}:${data.courseId}:${data.selectionVersion}`} courseName={data.courseName} unitPlural={data.unitPlural} today={data.todayId?{id:data.todayId}:null} chapters={data.chapters}/> : <ChapterListCourseView key={`${userId}:${data.courseId}:${data.selectionVersion}`} {...data}/>)}
 {!!query.error && transientFailure && <section role="status" className="mx-auto flex w-full max-w-5xl flex-col items-start gap-3 rounded-xl border border-vs-line bg-vs-surface p-3"><p className="w-full text-sm">{t("nativeLearning.refreshFailed")}</p><button type="button" className="btn-secondary" disabled={query.isFetching} onClick={()=>{void query.refetch();}}>{t("nativeFoundation.retry")}</button></section>}
 </div>{reader}</AppNavigationProvider></NativeStudyMediaProvider>;
}
