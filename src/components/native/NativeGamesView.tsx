"use client";
import {useSetBackTarget} from "@/lib/backTarget";
import type {NativeGameScreen} from "@/lib/native/gamesPageContract";
import NativeGamesMedia from "./NativeGamesMedia";
import {createElement,useEffect,useMemo,useRef,type ComponentType} from "react";
import {ConfirmProvider} from "@/components/ConfirmProvider";
import {useT} from "@/components/I18nProvider";
import {AppNavigationProvider,useAppNavigationAdapter} from "@/components/navigation/AppNavigation";
import {GameNavigationProvider} from "@/components/games/GameNavigation";
import {GAME_VIEWS} from "@/components/games/GameViews";
import {nativeTodayImageSource} from "@/lib/native/todayAssets";
import FocusLayout from "@/components/versado/FocusLayout";
import {decodeGameProps} from "@/lib/native/gamesPageContract";
import type {NativeContentState} from "@/lib/native/contract";
import {ContentScopeContext} from "@/lib/data/queryHooks";
import {useNativeData,useNativeLiveQuery} from "@/lib/data/nativeHooks";
import {nativeLearningTransientError} from "@/lib/data/native";
import {focusNativeRouteHeading} from "@/lib/native/routeFocus";

function GameBackTarget({href,back}:{href:string;back:NativeGameScreen["back"]}){
 useSetBackTarget(href.split("?")[0],back?.href??"/live",back?.parent??"",undefined,!!back,back?.soft);
 return null;
}
export default function NativeGamesView({userId,language,content,enabled,onError}:{userId:string;language:string;content?:NativeContentState;enabled:boolean;onError(error:unknown):void}) {
 const runtime=useNativeData(),nav=useAppNavigationAdapter(),t=useT();
 const adapter=useMemo(()=>({...nav,imageSource:(src:string)=>nativeTodayImageSource(src)??src}),[nav]);
 const collectionId=content?.picker.activeCollectionId??"",sourceLanguage=content?.picker.selection.contentLanguage??language;
 const scope=useMemo(()=>({collectionId,language:sourceLanguage}),[collectionId,sourceLanguage]);
 const query=useNativeLiveQuery(["games","page",userId,language,content?.picker.activeCollectionId,content?.picker.selectionVersion,nav.pathname],()=>runtime.gamePage(userId,language,content!.picker,nav.pathname),{
  enabled:enabled&&!!content,scopes:["content"],staleTime:Infinity,
 });
 const {refetch}=query;
 const revision=useRef(nav.revision);
 useEffect(()=>{if(revision.current!==nav.revision){revision.current=nav.revision;void refetch();}},[nav.revision,refetch]);
 const failure=query.error, data=query.data;
 useEffect(()=>{if(failure&&!nativeLearningTransientError(failure))onError(failure);},[failure,onError]);
 useEffect(()=>{if(data?.result.kind==="redirect")nav.replace(data.result.href);},[data,nav]);
 const screen=data?.result.kind==="screen"?data.result.screen:null;
 const props=useMemo(()=>screen?decodeGameProps(screen.data):null,[screen]);
 const identity=screen?`${nav.pathname.split("?")[0]}:${screen.view}`:"";
 useEffect(()=>{if(identity)return focusNativeRouteHeading();},[identity]);
 // Een bestaande kamer blijft bij gewone hervalidatie of tijdelijk netwerkverlies
 // gemount; alleen een autorisatie-/contextfout verwijdert haar gegevens.
 if(!enabled)return <p role="status">{t("nativeToday.unavailable")}</p>;
 if(failure&&!nativeLearningTransientError(failure))return <div role="alert"><button onClick={()=>void query.refetch()}>{t("nativeFoundation.retry")}</button></div>;
 if(!screen||!props||!data)return <p role="status">{t(failure?"nativeFoundation.offline":"nativeFoundation.loading")}{!!failure&&<button onClick={()=>void query.refetch()}>{t("nativeFoundation.retry")}</button>}</p>;
 const View=GAME_VIEWS[screen.view] as ComponentType<object>;
 const element=createElement(View,props);
 const scene=screen.frame==="focus"?<FocusLayout className="max-w-5xl">{element}</FocusLayout>:screen.frame==="hub"?<div className="min-w-0 space-y-6">{element}</div>:element;
 return <ContentScopeContext.Provider value={scope}><AppNavigationProvider adapter={adapter}><GameNavigationProvider href={data.path} shareOrigin={data.shareOrigin}><ConfirmProvider nativeDialogs><NativeGamesMedia page={data}>
  {!!failure&&<p role="status">{t("nativeFoundation.offline")} <button onClick={()=>void query.refetch()}>{t("nativeFoundation.retry")}</button></p>}
  <GameBackTarget href={data.path} back={screen.back}/>{scene}
 </NativeGamesMedia></ConfirmProvider></GameNavigationProvider></AppNavigationProvider></ContentScopeContext.Provider>;
}
