"use client";
import {useCallback,useMemo,useState} from "react";
import {useT} from "@/components/I18nProvider";
import {ConfirmProvider,useConfirm} from "@/components/ConfirmProvider";
import {useAppNavigation} from "@/components/navigation/AppNavigation";
import StudyFolderClient,{restoreFolderFocus} from "@/components/study-folder/StudyFolderClient";
import AnnotationActionsView,{type AnnotationActionsAdapter} from "@/components/annotations/AnnotationActionsView";
import ScriptureReaderView from "@/components/reading/ScriptureReaderView";
import {secondaryButton,surfaceCard} from "@/components/versado/styles";
import {useNativeData,useNativeLiveQuery} from "@/lib/data/nativeHooks";
import {studyFolderQuery,folderRefPath,folderRef,type FolderRef} from "@/lib/native/studyFolderContract";
import {currentEntryKey} from "@/lib/navigationEntry";
import {requestScrollRestore,scrollRestoreContext} from "@/lib/scrollRestore";
import {NativeClientError} from "@/lib/native/client";
import type {StudyFolderItem} from "@/lib/annotations/studyFolder";
import type {AnnotationView} from "@/lib/annotations/clientContract";

export default function NativeStudyFolder(props:{userId:string;pathname:string;enabled:boolean;onError(error:unknown):void}){
  return <ConfirmProvider nativeDialogs><StudyFolder {...props}/></ConfirmProvider>;
}
function StudyFolder({userId,pathname,enabled,onError}:{userId:string;pathname:string;enabled:boolean;onError(error:unknown):void}){
  const runtime=useNativeData(),navigation=useAppNavigation(),t=useT(),confirm=useConfirm();
  const memory=useNativeLiveQuery<{query:string;scroll?:{key:string;y:number;ref:string}}>(["study-folder-view",userId],async()=>({query:""}),{scopes:["annotations"],enabled:false,initialData:{query:""}});
  const setMemory=memory.setData;
  const onOpenItem=useCallback((item:StudyFolderItem)=>setMemory(old=>({...old,query:old?.query??"",scroll:{key:currentEntryKey(),y:window.scrollY,ref:`${item.kind}:${item.id}`}})),[setMemory]);
  const savedScroll=memory.data?.scroll;
  const onReady=useCallback(()=>{
    const context=scrollRestoreContext();
    if(savedScroll&&context.history&&context.key===savedScroll.key&&!context.interacted){
      const row=Array.from(document.querySelectorAll<HTMLElement>("[data-folder-item]")).find(element=>element.dataset.folderItem===savedScroll.ref);
      row?.querySelector<HTMLAnchorElement>("[data-folder-open]")?.focus({preventScroll:true});
      requestScrollRestore(savedScroll.key,"history",()=>savedScroll.y);
    }
  },[savedScroll]);
  const handle=useCallback((error:unknown)=>{
    if(error instanceof NativeClientError&&(error.status===401||error.status===403||error.code.startsWith("access_")))onError(error);
    throw error;
  },[onError]);
  const request=useCallback(async<T,>(query:string):Promise<T>=>{
    try{return await runtime.studyFolder<T>(userId,studyFolderQuery.parse(Object.fromEntries(new URLSearchParams(query))));}catch(error){return handle(error);}
  },[runtime,userId,handle]);
  const ref=useMemo(()=>{
    const match=/^\/study-folder\/(bookmark|highlight|note)\/([A-Za-z0-9_-]{1,128})$/.exec(pathname);
    return match?folderRef.parse({kind:match[1],id:match[2]}):null;
  },[pathname]);
  const adapterFor=useCallback((anchor:FolderRef):AnnotationActionsAdapter=>({
    async load(){try{return await runtime.folderAnnotations(userId,anchor);}catch(error){return handle(error);}},
    async mutate(action,method){try{return {annotation:await runtime.mutateFolderAnnotation(userId,anchor,action,method)};}catch(error){return handle(error);}},
    status(error){return error instanceof NativeClientError?error.status:undefined;},
    registerNavigationGuard:navigation.registerNavigationGuard,
  }),[runtime,userId,handle,navigation.registerNavigationGuard]);
  const confirmRemove=useCallback(()=>confirm(t("studyFolder.removeConfirm"),{destructive:true,native:true}),[confirm,t]);
  if(!enabled)return <section role="status" className="flex flex-col gap-3"><h1 className="text-2xl font-extrabold">{t("studyFolder.title")}</h1><p>{t("nativeContentFallback.unsupported")}</p><button className={secondaryButton} onClick={()=>navigation.back("/content")}>{t("common.back")}</button></section>;
  if(ref)return <FolderPassage key={folderRefPath(ref)} userId={userId} anchor={ref} adapter={adapterFor(ref)} confirmRemove={confirmRemove} onError={handle}/>;
  return <StudyFolderClient discardOnRevalidate pathname="/study-folder" search={new URLSearchParams(memory.data?.query??"")} replace={href=>memory.setData(old=>({...old,query:href.split("?")[1]??""}))} onOpenItem={onOpenItem} onReady={onReady}
    request={request} itemHref={item=>`/study-folder/${folderRefPath(item)}`}
    renderEditor={(item,element,onClose,onChanged)=><FolderEditor key={`${item.kind}:${item.id}`} item={item} element={element} adapter={adapterFor(item)} confirmRemove={confirmRemove} onClose={onClose} onChanged={onChanged}/>}/>;
}
function FolderEditor({item,element,adapter,confirmRemove,onClose,onChanged}:{item:StudyFolderItem;element:HTMLElement|null;adapter:AnnotationActionsAdapter;confirmRemove:()=>Promise<boolean>;onClose():void;onChanged(row:AnnotationView):void}){
  return <AnnotationActionsView target={item.target} returnFocus={element} adapter={adapter} confirmRemove={confirmRemove} onClose={onClose} onChanged={onChanged}/>;
}
function FolderPassage({userId,anchor,adapter,confirmRemove,onError}:{userId:string;anchor:FolderRef;adapter:AnnotationActionsAdapter;confirmRemove:()=>Promise<boolean>;onError(error:unknown):never}){
  const runtime=useNativeData(),t=useT(),navigation=useAppNavigation();
  const query=useNativeLiveQuery(["study-folder-passage",userId,anchor.kind,anchor.id],async()=>{
    try{return await runtime.folderPassage(userId,anchor);}catch(error){return onError(error);}
  },{scopes:["annotations","content"],discardOnRevalidate:true});
  const [editing,setEditing]=useState<{item:StudyFolderItem;element:HTMLElement}|null>(null);
  const data=query.data,destination=data?.destination;
  return <section data-native-folder-passage className="flex min-w-0 flex-col gap-4 pb-6">
    <h1 className="text-2xl font-extrabold">{data?.item.source.status!=="unavailable"?data?.item.source.label??t("studyFolder.title"):t("studyFolder.sourceUnavailable")}</h1>
    {query.isLoading&&<p role="status">{t("studyFolder.loading")}</p>}
    {Boolean(query.error)&&<div role="alert"><p>{t("studyFolder.loadFailed")}</p><button className={secondaryButton} onClick={()=>void query.refetch()}>{t("studyFolder.retry")}</button></div>}
    {data&&destination?.status==="ready"&&<ScriptureReaderView bookName={destination.reader.bookName} chapterNumber={destination.reader.chapterNumber} verses={destination.reader.verses} language={destination.reader.language} focusVerse={destination.reader.focusVerse}
      colorForVerse={id=>data.item.target.type==="verse"&&data.item.target.verseId===id?data.item.color:undefined}/>}
    {destination&&destination.status!=="ready"&&<p role="status" className={`${surfaceCard} p-4`}>{t(destination.status==="unavailable"?"studyFolder.sourceUnavailableHelp":"studyFolder.nativeReaderUnsupported")}</p>}
    {data?.item.quote&&<blockquote className="whitespace-pre-wrap [overflow-wrap:anywhere]">{data.item.quote}</blockquote>}
    {data?.item.text&&<p className={`${surfaceCard} whitespace-pre-wrap p-4 [overflow-wrap:anywhere]`}>{data.item.text}</p>}
    {data&&<button data-folder-edit className={secondaryButton} aria-haspopup="dialog" onClick={event=>setEditing({item:data.item,element:event.currentTarget})}>{t("studyFolder.edit")}</button>}
    <button data-folder-return className={secondaryButton} onClick={()=>navigation.back("/study-folder")}>{t("studyFolder.title")}</button>
    {editing&&<FolderEditor item={editing.item} element={editing.element} adapter={adapter} confirmRemove={confirmRemove} onClose={()=>{setEditing(null);restoreFolderFocus(editing.item,true);}} onChanged={()=>void query.refetch()}/>}
  </section>;
}
