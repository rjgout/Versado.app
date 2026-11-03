"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import ReadAloudPlayer, {type ReadAloudControl, type ReadAloudStatus} from "@/components/ReadAloudPlayer";
import {useReadAloudPlayer} from "@/lib/readAloudPlayerContext";
import {useNativeData,useNativeLiveQuery} from "@/lib/data/nativeHooks";
import {nativePlaybackQueryKey} from "@/lib/data/native";
import {serializeKey} from "@/lib/data/store";
import {NativeReadAloudOutput,loadNativeAudioMetadata,type NativeAudioTarget} from "@/lib/native/audioOutput";
import {nativeAudioSelector} from "@/lib/native/audioBridge";
import {NativeClientError} from "@/lib/native/client";
import type {NativeReader} from "@/lib/native/readerContract";
import type {NativePlayback} from "@/lib/native/audioPlaybackContract";
import {useT} from "@/components/I18nProvider";

/** Metadata leeft uitsluitend in LiveDataStore. De eigenaar bindt alleen de
 * bestaande sessie en leesroute aan de native decoder; nooit bytes of secrets. */
export default function NativeReadAloudPlayer({reader,controlRef,onStatusChange,onReadDenied}:{reader:NativeReader;controlRef:RefObject<ReadAloudControl|null>;onStatusChange:(status:ReadAloudStatus)=>void;onReadDenied?:(error:unknown)=>void}) {
 const runtime=useNativeData(),player=useReadAloudPlayer(),t=useT();
 const output=player.output instanceof NativeReadAloudOutput?player.output:null;
 const epoch=runtime.getSnapshot(),stamp=runtime.client.getSessionStamp();
 const identity=JSON.stringify([stamp,epoch,...nativePlaybackQueryKey(reader)]);
 const live=useRef(identity);
 useLayoutEffect(()=>{live.current=identity;},[identity]);
 const loadRef=useRef<(renew:boolean)=>Promise<NativePlayback>>(async()=>{throw new NativeClientError("audio_changed");});
 const target=useMemo<NativeAudioTarget>(()=>({ownerId:crypto.randomUUID(),sessionStamp:stamp,scope:nativeAudioSelector(reader),sourceLanguage:reader.sourceLanguage,current:()=>live.current===identity&&runtime.getSnapshot()===epoch&&runtime.client.getSessionStamp()===stamp,load:renew=>loadRef.current(renew)}),[identity]); // eslint-disable-line react-hooks/exhaustive-deps
 const bound=useRef(false),renewRequested=useRef(false);
 useLayoutEffect(()=>{bound.current=true;const release=output?.bind(target);return()=>{bound.current=false;release?.();};},[output,target]);
 const key=nativePlaybackQueryKey(reader);
 const query=useNativeLiveQuery(key,async()=>{
   if(!output||!bound.current||!target.current())throw new NativeClientError("audio_changed");
   const renew=renewRequested.current;renewRequested.current=false;
   return loadNativeAudioMetadata(output.bridge,target,refresh=>runtime.readerPlayback(reader,refresh),renew);
 },{enabled:!!output?.enabled,scopes:["content","courses"],staleTime:30000,discardOnRevalidate:true,pollMs:player.isPlaying?30000:undefined});
 useLayoutEffect(()=>{loadRef.current=async renew=>{
   if(!target.current())throw new NativeClientError("audio_changed");
   if(renew)renewRequested.current=true;
   await query.refetch();
   // Een bestaande GET kan gededupliceerd zijn. De expliciete read-vernieuwing
   // volgt dan erna, via dezelfde query en de bestaande refreshqueue.
   if(renewRequested.current)await query.refetch();
   if(!target.current())throw new NativeClientError("audio_changed");
   const snapshot=runtime.store.getSnapshot<NonNullable<typeof query.data>>(serializeKey(["native",epoch,...key]));
   if(!snapshot.data||snapshot.error)throw snapshot.error??new NativeClientError("audio_unavailable");
   return snapshot.data.playback;
 };});
 const denied=useRef(onReadDenied);useLayoutEffect(()=>{denied.current=onReadDenied;});
 useEffect(()=>{
   const error=query.error;if(!target.current()||!(error instanceof NativeClientError))return;
   if(["content_unavailable","content_context_changed"].includes(error.code)||error.status===401||error.status===403||error.code.startsWith("access_")&&error.code!=="access_network_unavailable")denied.current?.(error);
 },[query.error,target]);
 const value=query.data;
 const native={ownerId:target.ownerId,contextEpoch:value?.status.contextEpoch??0,readerHash:value?.playback.audio.readerHash??"0".repeat(64)};
 return <div data-native-read-aloud>
 <ReadAloudPlayer sourceId={reader.chapterId} title={`${reader.bookName} ${reader.chapterNumber}`} language={reader.sourceLanguage} verses={reader.verses} controlRef={controlRef} onStatusChange={onStatusChange} adapter={{native,status:value?"ready":query.error?"error":"loading",retry:()=>{void query.refetch();},voices:value?.voices??[],editions:value?.playback.audio.sources.filter(source=>!source.fallbackFor).map(source=>({language:source.language,url:null,verses:source.verses.map(verse=>({number:verse.number,text:reader.verses.find(item=>item.number===verse.number)?.text??"",audioStart:verse.start})),native:{...native,sourceId:source.id}}))??[]}}/>
 {player.error&&<p role="status">{t("player.nativeUnavailable")}</p>}
 </div>;
}
