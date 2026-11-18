"use client";
import { useRef, useState, type PointerEvent, type MouseEvent } from "react";
import { Bookmark, Highlighter, StickyNote } from "lucide-react";
import { useT } from "@/components/I18nProvider";

/** De bestaande webversbediening, rechtstreeks gedeeld met de lokale lezer. */
export function useVerseAnnotationMenu(enabled:boolean,colorForVerse:(id:string)=>string|undefined) {
  const t=useT();
  const [target,setTarget]=useState<{verseId:string;element:HTMLElement}|null>(null);
  const pointerStart=useRef<{x:number;y:number;hadSelection:boolean}|null>(null);
  function rememberPointer(event:PointerEvent) {
    pointerStart.current={x:event.clientX,y:event.clientY,hadSelection:!(window.getSelection()?.isCollapsed??true)};
  }
  function tapVerse(event:MouseEvent<HTMLElement>,verseId:string) {
    const start=pointerStart.current;pointerStart.current=null;
    if((event.target as HTMLElement).closest("button, a, input, textarea, select"))return;
    if(start?.hadSelection || !(window.getSelection()?.isCollapsed??true))return;
    if(start&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>10)return;
    const number=event.currentTarget.querySelector<HTMLElement>("[data-annotation-trigger]");
    setTarget({verseId,element:number??event.currentTarget});
  }
  function renderVerseNumber(v:{id:string;number:number;bookmarked?:boolean;note?:string}) {
    return <button type="button" data-annotation-trigger aria-haspopup="dialog"
      aria-label={t("annotations.verseActions",{number:v.number})}
      onClick={event=>{event.stopPropagation();setTarget({verseId:v.id,element:event.currentTarget});}}
      className="mr-2 inline cursor-pointer select-none align-baseline font-bold text-brand-400 dark:text-brand-500 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vs-accent">
      {v.number}
      {(v.bookmarked||v.note||colorForVerse(v.id))&&<span className="ml-0.5 inline-flex gap-0.5 align-[-0.1em] text-vs-accent">
        {colorForVerse(v.id)&&<Highlighter aria-hidden className="h-[0.8em] w-[0.8em]" style={{color:"rgb(var(--m))"}}/>}
        {v.bookmarked&&<Bookmark aria-hidden className="h-[0.8em] w-[0.8em] fill-current"/>}
        {v.note&&<StickyNote aria-hidden className="h-[0.8em] w-[0.8em]"/>}
      </span>}
    </button>;
  }
  return {target,close:()=>setTarget(null),props:{activeVerseId:target?.verseId,colorForVerse,
    onPointerDown:enabled?rememberPointer:undefined,onVerseClick:enabled?tapVerse:undefined,
    renderVerseNumber:enabled?renderVerseNumber:undefined}};
}
