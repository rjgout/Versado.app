"use client";
import { useEffect, useRef, useState } from "react";
import type { NativeReader } from "@/lib/native/readerContract";
import type { ReaderPositionInput } from "@/lib/native/readerPositionContract";

/** Een hervatpunt vereist echte scroll-/toetsinteractie én een stabiel zichtbaar
 * vers. Mount, GET, focus, programmatisch scrollen en app-hervatten schrijven niet.
 * Alleen een mislukte intentie blijft in werkgeheugen voor expliciete retry. */
export function useNativeReaderPosition(reader: NativeReader | undefined, version:number, enabled:boolean,
  save:(input:ReaderPositionInput)=>Promise<{version:number}>, onError:(error:unknown)=>void) {
  const [status,setStatus]=useState<"idle"|"saving"|"saved"|"error">("idle");
  const reset=useRef<()=>void>(()=>{});
  const retry=useRef<()=>void>(()=>{});
  const callbacks=useRef({save,onError});
  useEffect(()=>{callbacks.current={save,onError};});
  const latestVersion=useRef(version);
  useEffect(()=>{latestVersion.current=Math.max(latestVersion.current,version);},[version]);
  useEffect(()=>{
    if(!reader||!enabled)return;
    latestVersion.current=version;
    let disposed=false, busy=false, failed:ReaderPositionInput|null=null, queued:number|null=null;
    let armed=false, timer:ReturnType<typeof setTimeout>|undefined, lastSent=-Infinity, lastVerse:number|null=null, lastVersion:number|null=null;
    const cancel=()=>{clearTimeout(timer);timer=undefined;};
    const visibleVerse=()=>{
      if(document.querySelector("dialog[open]"))return null;
      const header=document.querySelector("[data-sticky-header]")?.getBoundingClientRect().bottom??0;
      const top=Math.max(header,0), bottom=innerHeight;
      const candidates=reader.verses.map(v=>({number:v.number,rect:document.getElementById(`vers-${v.number}`)?.getBoundingClientRect()}))
        .filter(v=>v.rect&&Math.min(v.rect.bottom,bottom)-Math.max(v.rect.top,top)>=Math.min(40,v.rect.height));
      // Het vers op 40% van de leesruimte; ook lange verzen blijven bruikbaar.
      const anchor=top+(bottom-top)*0.4;
      candidates.sort((a,b)=>Math.abs(Math.max(a.rect!.top,Math.min(anchor,a.rect!.bottom))-anchor)-Math.abs(Math.max(b.rect!.top,Math.min(anchor,b.rect!.bottom))-anchor));
      return candidates[0]?.number??null;
    };
    const send=async(input:ReaderPositionInput)=>{
      if(disposed||busy)return;
      busy=true;setStatus("saving");lastSent=performance.now();
      try {
        const result=await callbacks.current.save(input);
        if(disposed)return;
        latestVersion.current=Math.max(latestVersion.current,result.version);lastVerse=input.verse;lastVersion=result.version;failed=null;setStatus("saved");
      } catch(error) {
        if(disposed)return;
        failed=input;queued=null;setStatus("error");callbacks.current.onError(error);
      } finally {
        busy=false;
        if(!disposed&&!failed&&queued!==null)settle();
      }
    };
    const makeInput=(verse:number):ReaderPositionInput=>({chapterId:reader.chapterId,startVerse:reader.startVerse,endVerse:reader.endVerse,actionId:crypto.randomUUID(),expectedVersion:latestVersion.current,activeCollectionId:reader.activeCollectionId,selectionVersion:reader.selectionVersion,language:reader.language,verse});
    function settle() {
      cancel();
      if(disposed||failed||document.visibilityState!=="visible"||!armed)return;
      timer=setTimeout(()=>{
        const verse=visibleVerse();
        if(verse===null||(verse===lastVerse&&latestVersion.current===lastVersion))return;
        queued=verse;
        // Nog 1,5 seconde dezelfde zichtbare coördinaat, niet slechts scroll-einde.
        timer=setTimeout(()=>{
          if(disposed||failed||document.visibilityState!=="visible"||visibleVerse()!==verse)return;
          if(busy)return;
          queued=null;void send(makeInput(verse));
        },1500);
      },Math.max(1000,8000-(performance.now()-lastSent)));
    }
    const interact=(event:Event)=>{
      if(!event.isTrusted||document.querySelector("dialog[open]")||(event.target instanceof Element&&event.target.closest("[data-read-aloud-controls],[role=listbox],[role=option]")))return;
      if(event instanceof KeyboardEvent&&!['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(event.key))return;
      armed=true;settle();
    };
    const scrolled=()=>{if(armed)settle();};
    const visibility=()=>{cancel();armed=false;queued=null;};
    window.addEventListener("versado:read-aloud-interaction",visibility);
    const events=["wheel","touchmove","keydown"] as const;
    for(const event of events)window.addEventListener(event,interact,{passive:true});
    window.addEventListener("scroll",scrolled,{passive:true});
    document.addEventListener("visibilitychange",visibility);
    reset.current=()=>{failed=null;queued=null;lastVerse=null;lastVersion=null;armed=false;cancel();setStatus("idle");};
    retry.current=()=>{if(failed&&!busy&&!disposed){const input=failed;failed=null;void send(input);}};
    return ()=>{window.removeEventListener("versado:read-aloud-interaction",visibility);disposed=true;cancel();retry.current=()=>{};for(const event of events)window.removeEventListener(event,interact);window.removeEventListener("scroll",scrolled);document.removeEventListener("visibilitychange",visibility);};
    // De reader-identiteit komt van de gemounte route; cacheverversing mag geen
    // observaties, focus, pending intentie of opgeloste versie terugzetten.
  },[enabled,reader?.userId,reader?.activeCollectionId,reader?.selectionVersion,reader?.language,reader?.courseId,reader?.kind,reader?.targetId,reader?.chapterId,reader?.startVerse,reader?.endVerse]); // eslint-disable-line react-hooks/exhaustive-deps
  return {status,retry:()=>retry.current(),reset:()=>reset.current()};
}
