"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useT,useUiLanguage} from '@/components/I18nProvider';
import {fsyLessonMetadata} from '@/lib/fsyPresentation';
import {jsonMutation} from '@/lib/data/mutation';
import {ApiRequestError} from '@/lib/data/fetchJson';
import {secondaryButton} from '@/components/versado/styles';
import type {getStudyCatalogue} from '@/lib/studyContent/catalogue';
import type {StudyContextAction,StudyContextView} from '@/lib/studyContextContract';
type Catalogue=Awaited<ReturnType<typeof getStudyCatalogue>>;
/** Alleen een bewuste klik kiest een les. Geen effect, kalenderreset of optimistische selectie. */
export default function ProgramLessonPicker({data,choose=false}:{data:Catalogue;choose?:boolean}) {
 const t=useT(),language=useUiLanguage(),router=useRouter(),pending=useRef<StudyContextAction|null>(null),locked=useRef(false);
 const latest=useRef(data.context);useEffect(()=>{latest.current=data.context;},[data.context]);
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[retry,setRetry]=useState(false);
 if(!data.context || !data.programName)return null;
 const context=data.context,active=data.lessons.find(l=>l.lessonKey===context.activeLessonKey||(l.legacyKey!==null&&l.legacyKey===context.activeLessonKey));
 async function select(lessonKey:string){
  if(locked.current)return;
  if(!pending.current && (lessonKey===context.activeLessonKey||(context.activeLessonKey!==null&&data.lessons.find(l=>l.lessonKey===lessonKey)?.legacyKey===context.activeLessonKey)) && context.lessonHref){router.push(context.lessonHref);return;}
  const request=pending.current??{workKey:context.workKey,activeLessonKey:lessonKey,expectedVersion:context.version,actionId:crypto.randomUUID()};
  pending.current=request;locked.current=true;setBusy(true);setError(null);
  try{
   const result=await jsonMutation<{context:StudyContextView}>('/api/study-context',{method:'PUT',json:request},{invalidates:'studyContextChanged'});
   if(!alive.current)return;
   if(!result?.context || result.context.workKey!==request.workKey)throw new Error("INVALID_RESPONSE");
   pending.current=null;setRetry(false);
   if(latest.current && latest.current.version>result.context.version){setError(t("programPicker.conflict"));return;}
   if(result.context.lessonHref)router.push(result.context.lessonHref);else router.refresh();
  }catch(e){
   if(!alive.current)return;
   const definitive=e instanceof ApiRequestError && e.status<500;
   if(definitive)pending.current=null;
   setRetry(!definitive);setError(t(e instanceof ApiRequestError&&e.status===409?'programPicker.conflict':'programPicker.failed'));
  }finally{locked.current=false;if(alive.current)setBusy(false); }
 }
 return <section data-program-context className="min-w-0 rounded-2xl border border-vs-line bg-vs-surface p-4 space-y-4">
  <h2 className="break-words text-lg font-extrabold text-vs-fg">{data.programName}</h2>
  <p className="text-sm text-vs-fg-2">{t('programPicker.remembered')}</p>
  {choose&&!data.truncated&&<p className="text-sm text-vs-fg-2">{t('programPicker.availableCount',{count:data.lessons.length})}</p>}
  {context.activeLessonKey ? <div className="space-y-2">
   <p className="font-bold text-vs-fg">{active?.title??t('programPicker.active')}</p>
   <p className="text-sm text-vs-fg-2">{t(active?.read?'programPicker.read':'programPicker.reading')}</p>
   {context.available&&context.lessonHref ? <Link className={secondaryButton} href={context.lessonHref} prefetch={false}>{t('programPicker.continue')}</Link>:<p role="status">{t('programPicker.unavailable')}</p>}
  </div>:<p>{t('programPicker.noSelection')}</p>}
  {error&&<div role="alert" className="space-y-2 text-vs-danger"><p>{error}</p>{retry?<button className={secondaryButton} disabled={busy} onClick={()=>void select(pending.current!.activeLessonKey!)}>{t('programPicker.retry')}</button>:<button className={secondaryButton} onClick={()=>{setError(null);router.refresh();}}>{t('programPicker.reload')}</button>}</div>}
  {!choose ? <Link className={secondaryButton} href="/courses">{t('programPicker.choose')}</Link>:<>
   {data.currentLessonKey&&<button className={secondaryButton} disabled={busy||retry} onClick={()=>void select(data.currentLessonKey!)}>{t('programPicker.current')}</button>}
   {!data.lessons.length&&<p role="status">{t('programPicker.empty')}</p>}
   {data.truncated&&<p role="status">{t('programPicker.truncated')}</p>}
   <ol className="grid min-w-0 gap-3">{data.lessons.map(l=>{
    const selected=l.lessonKey===context.activeLessonKey||(l.legacyKey!==null&&l.legacyKey===context.activeLessonKey);
    return <li key={l.id} className="min-w-0"><button data-program-lesson={l.id} data-study-lesson={l.id} type="button" disabled={busy||retry} aria-pressed={selected} onClick={()=>void select(l.lessonKey)} className="min-w-0 w-full min-h-14 rounded-xl border border-vs-line p-3 text-left text-vs-fg hover:bg-vs-accent-soft focus-visible:outline focus-visible:outline-vs-accent disabled:opacity-60">
     <span className="block [overflow-wrap:anywhere] font-bold">{selected?'✓ ':''}{l.title}</span>
     <span className="block text-sm text-vs-fg-2">{[...(l.workKey==='fsy'?[fsyLessonMetadata(l,language,t)]:[l.year,l.month,l.category,l.startsOn]),l.read?t('programPicker.read'):null].filter(Boolean).join(' · ')}</span>
    </button></li>;
   })}</ol>
  </>}
 </section>;
}
