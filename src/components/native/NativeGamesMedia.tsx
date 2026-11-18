"use client";
import {AnnotationTransportContext} from "@/components/annotations/AnnotationTransport";
import {useNativeData} from "@/lib/data/nativeHooks";
import {nativeAnnotationQueryKey} from "@/lib/data/native";
import {NativeClientError} from "@/lib/native/client";
import {useAppNavigationAdapter} from "@/components/navigation/AppNavigation";
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ComponentProps,type ReactNode} from "react";
import type ReadAloudPlayer from "@/components/ReadAloudPlayer";
import type IntroAudioButton from "@/components/IntroAudioButton";
import {GameMediaContext} from "@/components/games/GameMediaContext";
import {useT} from "@/components/I18nProvider";
import {useReadAloudPlayer} from "@/lib/readAloudPlayerContext";
import {gameAudioIntroId,nativeGameAudioSelection} from "@/lib/native/gamesAudioContract";
import type {NativeGamePage} from "@/lib/native/gamesPageContract";
import type {ReadAloudControl,ReadAloudStatus} from "@/components/ReadAloudPlayer";
import NativeReadAloudPlayer from "./NativeReadAloudPlayer";
const Page=createContext<NativeGamePage|null>(null);
function base(page:NativeGamePage){return {version:1,userId:page.userId,activeCollectionId:page.activeCollectionId,selectionVersion:page.selectionVersion,language:page.language};}
function NativeReading(props:ComponentProps<typeof ReadAloudPlayer>){
 const page=useContext(Page)!,t=useT(),control=useRef<ReadAloudControl|null>(null);
 const reader=useMemo(()=>{
  if(page.result.kind!=="screen"||page.result.screen.view!=="chapterLesson")return null;
  const data=page.result.screen.data;
  if(data.chapterId!==props.sourceId||!Array.isArray(data.verses))return null;
  const verses=data.verses.map(row=>row&&typeof row==="object"&&!Array.isArray(row)?{id:row.id,number:row.number,text:row.text}:null);
  if(JSON.stringify(verses.map(row=>row&&({number:row.number,text:row.text})))!==JSON.stringify(props.verses.map(({number,text})=>({number,text}))))return null;
  const result=nativeGameAudioSelection.safeParse({...base(page),game:{kind:"reading",id:props.sourceId},chapterId:props.sourceId,bookName:data.bookName,chapterNumber:data.chapterNumber,sourceLanguage:props.language,startVerse:props.verses[0]?.number,endVerse:props.verses.at(-1)?.number,focusVerse:props.startVerse??props.verses[0]?.number,verses});
  return result.success?result.data:null;
 },[page,props.sourceId,props.language,props.verses,props.startVerse]);
 if(!reader)return <p role="alert">{t("player.nativeUnavailable")}</p>;
 return <NativeReadAloudPlayer reader={reader} controlRef={props.controlRef??control} onStatusChange={props.onStatusChange??(()=>{})}/>;
}
function NativeIntro({audio,nativeTarget,text}:ComponentProps<typeof IntroAudioButton>){
 const page=useContext(Page)!,t=useT(),control=useRef<ReadAloudControl|null>(null),player=useReadAloudPlayer();
 const[status,setStatus]=useState<ReadAloudStatus>("loading");
 const reader=useMemo(()=>{
  if(!nativeTarget||!text)return null;
  const opaque=gameAudioIntroId(nativeTarget);
  const result=nativeGameAudioSelection.safeParse({...base(page),game:nativeTarget,chapterId:opaque,bookName:t("pages.chapterGuess"),chapterNumber:nativeTarget.index+1,sourceLanguage:"nl",startVerse:1,endVerse:1,focusVerse:1,verses:[{id:opaque+"-intro",number:1,text}]});
  return result.success?result.data:null;
 },[page,nativeTarget,text,t]);
 if(!audio)return null;
 if(!reader)return <p role="alert">{t("player.nativeUnavailable")}</p>;
 const playing=player.source?.id===reader.chapterId&&(player.isPlaying||player.isPreparing);
 return <>
  <div hidden><NativeReadAloudPlayer reader={reader} controlRef={control} onStatusChange={setStatus}/></div>
  <button type="button" className="btn-secondary !px-4 !py-2 self-start inline-flex items-center gap-2" disabled={status==="loading"&&!playing} onClick={()=>{if(playing)player.stop();else if(status==="error")control.current?.retry();else control.current?.startAtVerse(1);}}>
   {t(playing?"chapterGuess.stopAudio":status==="error"?"nativeFoundation.retry":status==="loading"?"common.loading":"chapterGuess.listenIntro")}
  </button>
 </>;
}
type SpeechRequest={id:number;text:string;language:string;index:number;onDone?:()=>void};
function NativeListening({request}:{request:SpeechRequest}){
 const page=useContext(Page)!,t=useT(),control=useRef<ReadAloudControl|null>(null),player=useReadAloudPlayer();
 const [status,setStatus]=useState<ReadAloudStatus>("loading");
 const started=useRef(false),heard=useRef(false),finished=useRef(false);
 const reader=useMemo(()=>{
  const solo=/^\/alleskenner\/alleen\/([A-Za-z0-9_-]{1,128})$/.exec(page.path),live=/^\/live\/([A-Za-z0-9_-]{1,128})$/.exec(page.path);
  const id=solo?.[1]??live?.[1];if(!id)return null;
  const game={kind:solo?"ak-solo" as const:"ak-live" as const,id,index:request.index},opaque=gameAudioIntroId(game);
  const result=nativeGameAudioSelection.safeParse({...base(page),game,chapterId:opaque,bookName:t("pages.alleskenner"),chapterNumber:request.index,sourceLanguage:request.language,startVerse:1,endVerse:1,focusVerse:1,verses:[{id:opaque+"-intro",number:1,text:request.text}]});
  return result.success?result.data:null;
 },[page,request,t]);
 useEffect(()=>{if(reader&&status==="ready"&&!started.current)started.current=control.current?.startAtVerse(1)===true;},[reader,status]);
 useEffect(()=>{
  if(!reader||!started.current||finished.current)return;
  if(player.source?.id===reader.chapterId&&(player.isPlaying||player.isPreparing))heard.current=true;
  if(heard.current&&!player.isPreparing&&(player.source===null||player.error)){
   finished.current=true;
   // Alleen echte voltooiing; een ingetrokken/verlopen lease voltooit geen beurt.
   if(!player.error)request.onDone?.();
  }
 },[reader,player.source,player.isPlaying,player.isPreparing,player.error,request]);
 if(!reader)return <p role="alert">{t("player.nativeUnavailable")}</p>;
 return <>
  <div hidden><NativeReadAloudPlayer reader={reader} controlRef={control} onStatusChange={setStatus}/></div>
  {(status==="error"||player.error)&&<p role="alert">{t("player.nativeUnavailable")}<button onClick={()=>{started.current=false;heard.current=false;finished.current=false;control.current?.retry();}}>{t("nativeFoundation.retry")}</button></p>}
 </>;
}
export default function NativeGamesMedia({page,children}:{page:NativeGamePage;children:ReactNode}){
 const runtime=useNativeData(),navigation=useAppNavigationAdapter();
 const [speech,setSpeech]=useState<SpeechRequest|null>(null),speechId=useRef(0);
 const speak=useCallback((text:string,language:string,index:number,onDone?:()=>void)=>setSpeech({id:++speechId.current,text,language,index,onDone}),[]);
 const media=useMemo(()=>({Reading:NativeReading,Intro:NativeIntro,speak}),[speak]);
 const reader=useMemo(()=>{
  if(page.result.kind!=="screen"||page.result.screen.view!=="chapterLesson")return null;
  const data=page.result.screen.data;
  const verses=Array.isArray(data.verses)?data.verses.map(row=>row&&typeof row==="object"&&!Array.isArray(row)?{id:row.id,number:row.number,text:row.text}:null):[];
  const result=nativeGameAudioSelection.safeParse({...base(page),game:{kind:"reading",id:data.chapterId},chapterId:data.chapterId,bookName:data.bookName,chapterNumber:data.chapterNumber,sourceLanguage:data.language,startVerse:verses[0]?.number,endVerse:verses.at(-1)?.number,focusVerse:data.focusVerse??verses[0]?.number,verses});
  return result.success?result.data:null;
 },[page]);
 const annotations=useMemo(()=>reader?{
  chapterId:reader.chapterId,key:nativeAnnotationQueryKey(reader),load:()=>runtime.readerAnnotations(reader),
  adapter:{
   async load(target:import("@/lib/annotations/contract").AnnotationTarget,signal?:AbortSignal){if(target.type!=="verse")throw new NativeClientError("content_unavailable",404);const result=await runtime.readerAnnotations(reader,target.verseId);if(signal?.aborted)throw new NativeClientError("session_changed",409);return result;},
   mutate:(action:import("@/lib/annotations/contract").AnnotationAction,method:"PUT"|"DELETE")=>runtime.mutateReaderAnnotation(reader,action,method),
   status:(error:unknown)=>error instanceof NativeClientError?error.status:undefined,
   registerNavigationGuard:navigation.registerNavigationGuard,
  },
 }:null,[reader,runtime,navigation.registerNavigationGuard]);
 return <Page.Provider value={page}><GameMediaContext.Provider value={media}><AnnotationTransportContext.Provider value={annotations}>{children}{speech&&<NativeListening key={speech.id} request={speech}/>}</AnnotationTransportContext.Provider></GameMediaContext.Provider></Page.Provider>;
}
