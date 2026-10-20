"use client";
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useT,useUiLanguage} from '@/components/I18nProvider';
import {fsyLessonMetadata} from '@/lib/fsyPresentation';
import {jsonMutation} from '@/lib/data/mutation';
import {ApiRequestError} from '@/lib/data/fetchJson';
import {secondaryButton,surfaceCard,focusRing} from '@/components/versado/styles';
import {BookOpen,ListChecks,ChevronRight} from 'lucide-react';
import {formatWeekPeriod} from './PersonalStudyParts';
import CfmWeekPath,{PathModeSwitch} from './CfmWeekPath';
import type {PersonalStudyModeValue} from '@/lib/studyContent/personalStudyMode';
import type {getStudyCatalogue} from '@/lib/studyContent/catalogue';
import type {StudyContextAction,StudyContextView} from '@/lib/studyContextContract';
type Catalogue=Awaited<ReturnType<typeof getStudyCatalogue>>;
/** Alleen een bewuste klik kiest een les. Geen effect, kalenderreset of optimistische selectie. */
export default function ProgramLessonPicker({data,choose=false,mode='FREE',sessionKey=''}:{data:Catalogue;choose?:boolean;mode?:PersonalStudyModeValue;sessionKey?:string}) {
 const t=useT(),language=useUiLanguage(),router=useRouter(),pending=useRef<StudyContextAction|null>(null),locked=useRef(false);
 const latest=useRef(data.context);useEffect(()=>{latest.current=data.context;},[data.context]);
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[retry,setRetry]=useState(false);
 if(!data.context || !data.programName)return null;
 const personalProgram=data.lessons.some(l=>l.personal),currentLesson=data.lessons.find(l=>l.lessonKey===data.currentLessonKey&&l.personal)??null;
 const lessonPath=(l:{lessonId:string;collectionId:string})=>`/study-lesson/${encodeURIComponent(l.lessonId)}/${encodeURIComponent(l.collectionId)}`;
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
 // Een geopende week wordt de actieve les (bestaande studiecontext), op de achtergrond: de navigatie wacht er nooit op.
 async function remember(lessonKey:string){
  if(lessonKey===context.activeLessonKey||locked.current)return;
  try{await jsonMutation<{context:StudyContextView}>('/api/study-context',{method:'PUT',json:{workKey:context.workKey,activeLessonKey:lessonKey,expectedVersion:context.version,actionId:crypto.randomUUID()}},{invalidates:'studyContextChanged'});}catch{/* de keuze blijft dan zoals ze was */}
 }
 const weekRows=data.lessons.filter(l=>l.personal).map(l=>({id:l.id,lessonId:l.lessonId,collectionId:l.collectionId,lessonKey:l.lessonKey,title:l.title,startsOn:l.startsOn,endsOnExclusive:l.endsOnExclusive,read:l.read,stepsDone:l.stepsDone,imageMediaId:l.imageMediaId}));
 const activeWeek=weekRows.find(w=>w.lessonKey===data.currentLessonKey)??weekRows.find(w=>w.lessonKey===context.activeLessonKey)??weekRows.find(w=>!w.read)??null;
 return <section data-program-context className={personalProgram&&choose?"min-w-0 space-y-4":"min-w-0 rounded-2xl border border-vs-line bg-vs-surface p-4 space-y-4"}>
  <h2 className="break-words text-lg font-extrabold text-vs-fg">{data.programName}</h2>
  {!(personalProgram&&choose)&&<p className="text-sm text-vs-fg-2">{t('programPicker.remembered')}</p>}
  {choose&&!data.truncated&&!personalProgram&&<p className="text-sm text-vs-fg-2">{t('programPicker.availableCount',{count:data.lessons.length})}</p>}
  {personalProgram&&!choose&&<div data-cfm-modes className="grid gap-2 sm:grid-cols-2">
   {context.available&&context.lessonHref?<Link href={context.lessonHref} prefetch={false} className={`${surfaceCard} ${focusRing} flex min-h-16 min-w-0 items-center gap-3 p-3 hover:bg-vs-subtle`}>
    <BookOpen aria-hidden className="h-6 w-6 shrink-0 text-vs-accent"/>
    <span className="min-w-0 flex-1"><span className="block font-extrabold text-vs-fg">{t('cfmStudy.modeFree')}</span><span className="block break-words text-sm text-vs-fg-2">{active?.title??t('programPicker.continue')}</span></span>
    <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-vs-fg-3"/></Link>:null}
   {currentLesson?<Link href={`${lessonPath(currentLesson)}/stappen`} prefetch={false} className={`${surfaceCard} ${focusRing} flex min-h-16 min-w-0 items-center gap-3 p-3 hover:bg-vs-subtle`}>
    <ListChecks aria-hidden className="h-6 w-6 shrink-0 text-vs-accent"/>
    <span className="min-w-0 flex-1"><span className="block font-extrabold text-vs-fg">{t('cfmStudy.modeSteps')}</span><span className="block break-words text-sm text-vs-fg-2">{t('cfmStudy.currentWeek')} · {currentLesson.title}</span></span>
    <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-vs-fg-3"/></Link>:<p role="status" className="text-sm text-vs-fg-2">{t('cfmStudy.noCurrentWeek')}</p>}
  </div>}
 {personalProgram&&choose?null:context.activeLessonKey ? <div className="space-y-2">
   <p className="font-bold text-vs-fg">{active?.title??t('programPicker.active')}</p>
   <p className="text-sm text-vs-fg-2">{t(active?.read?'programPicker.read':'programPicker.reading')}</p>
   {context.available&&context.lessonHref ? <Link className={secondaryButton} href={context.lessonHref} prefetch={false}>{t('programPicker.continue')}</Link>:<p role="status">{t('programPicker.unavailable')}</p>}
  </div>:<p>{t('programPicker.noSelection')}</p>}
  {error&&<div role="alert" className="space-y-2 text-vs-danger"><p>{error}</p>{retry?<button className={secondaryButton} disabled={busy} onClick={()=>void select(pending.current!.activeLessonKey!)}>{t('programPicker.retry')}</button>:<button className={secondaryButton} onClick={()=>{setError(null);router.refresh();}}>{t('programPicker.reload')}</button>}</div>}
  {!choose ? <Link className={secondaryButton} href="/courses">{t('programPicker.choose')}</Link>:<>
   {data.currentLessonKey&&!personalProgram&&<button className={secondaryButton} disabled={busy||retry} onClick={()=>void select(data.currentLessonKey!)}>{t('programPicker.current')}</button>}
   {!data.lessons.length&&<p role="status">{t('programPicker.empty')}</p>}
   {data.truncated&&<p role="status">{t('programPicker.truncated')}</p>}
 {personalProgram?<div className="space-y-4"><PathModeSwitch mode={mode}/><CfmWeekPath weeks={weekRows} mode={mode} activeWeekId={activeWeek?.id??null} sessionKey={sessionKey} onOpenWeek={k=>void remember(k)}/></div>:<ol className="grid min-w-0 gap-3">{data.lessons.map(l=>{
    const selected=l.lessonKey===context.activeLessonKey||(l.legacyKey!==null&&l.legacyKey===context.activeLessonKey);
    const week=l.personal?formatWeekPeriod(l.startsOn,l.endsOnExclusive,language):null;
    const meta=l.personal?[week,l.lessonKey===data.currentLessonKey?t('cfmStudy.currentWeek'):null,l.read?t('programPicker.read'):l.stepsDone>0?t('cfmStudy.weekProgress',{done:l.stepsDone,total:7}):null]:[...(l.workKey==='fsy'?[fsyLessonMetadata(l,language,t)]:[l.year,l.month,l.category,l.startsOn]),l.read?t('programPicker.read'):null];
    return <li key={l.id} className="flex min-w-0 gap-2"><button data-program-lesson={l.id} data-study-lesson={l.id} type="button" disabled={busy||retry} aria-pressed={selected} onClick={()=>void select(l.lessonKey)} className="min-w-0 flex-1 min-h-14 rounded-xl border border-vs-line p-3 text-left text-vs-fg hover:bg-vs-accent-soft focus-visible:outline focus-visible:outline-vs-accent disabled:opacity-60">
     <span className="block [overflow-wrap:anywhere] font-bold">{selected?'✓ ':''}{l.title}</span>
     <span className="block text-sm text-vs-fg-2">{meta.filter(Boolean).join(' · ')}</span>
    </button>{l.personal&&<Link href={`${lessonPath(l)}/stappen`} prefetch={false} aria-label={`${t('cfmStudy.modeSteps')}: ${l.title}`} className={`${secondaryButton} !rounded-xl self-stretch`}><ListChecks aria-hidden className="h-5 w-5 shrink-0"/><span className="sr-only sm:not-sr-only">{t('cfmStudy.openWeekSteps')}</span></Link>}</li>;
   })}</ol>}
  </>}
 </section>;
}
