"use client";
import { AppLink as Link } from "@/components/navigation/AppNavigation";
import { useT } from "@/components/I18nProvider";
import { secondaryButton, surfaceCard, focusRing } from "@/components/versado/styles";
import { BookOpen, ListChecks, ChevronRight } from "lucide-react";
export interface ProgramSummary {
  programName: string; personalMode: "FREE" | "STEPS" | null;
  context: { activeLessonKey: string | null; available: boolean; lessonHref: string | null };
  active: { title: string; read: boolean } | null;
  currentLesson: { lessonId: string; collectionId: string; title: string } | null;
  personalProgram: boolean;
}
export default function ProgramSummaryView({ data }: { data: ProgramSummary }) {
 const t=useT(), context=data.context, active=data.active, currentLesson=data.currentLesson, personalProgram=data.personalProgram;
 const preferSteps=(data.personalMode??'STEPS')==='STEPS';
 const lessonPath=(l:{lessonId:string;collectionId:string})=>`/study-lesson/${encodeURIComponent(l.lessonId)}/${encodeURIComponent(l.collectionId)}`;
 return <section data-program-context className="min-w-0 rounded-2xl border border-vs-line bg-vs-surface p-4 space-y-4">
  <h2 className="break-words text-lg font-extrabold text-vs-fg">{data.programName}</h2>
  {<p className="text-sm text-vs-fg-2">{t('programPicker.remembered')}</p>}
  
  {personalProgram&&<div data-cfm-modes className="grid gap-2 sm:grid-cols-2">
   {context.available&&context.lessonHref?<Link href={context.lessonHref} prefetch={false} className={`${surfaceCard} ${focusRing} ${preferSteps?'':'order-first'} flex min-h-16 min-w-0 items-center gap-3 p-3 hover:bg-vs-subtle`}>
    <BookOpen aria-hidden className="h-6 w-6 shrink-0 text-vs-accent"/>
    <span className="min-w-0 flex-1"><span className="block font-extrabold text-vs-fg">{t('cfmStudy.modeFree')}</span><span className="block break-words text-sm text-vs-fg-2">{active?.title??t('programPicker.continue')}</span></span>
    <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-vs-fg-3"/></Link>:null}
   {currentLesson?<Link href={`${lessonPath(currentLesson)}/stappen`} prefetch={false} className={`${surfaceCard} ${focusRing} ${preferSteps?'order-first':''} flex min-h-16 min-w-0 items-center gap-3 p-3 hover:bg-vs-subtle`}>
    <ListChecks aria-hidden className="h-6 w-6 shrink-0 text-vs-accent"/>
    <span className="min-w-0 flex-1"><span className="block font-extrabold text-vs-fg">{t('cfmStudy.modeSteps')}</span><span className="block break-words text-sm text-vs-fg-2">{t('cfmStudy.currentWeek')} · {currentLesson.title}</span></span>
    <ChevronRight aria-hidden className="h-5 w-5 shrink-0 text-vs-fg-3"/></Link>:<p role="status" className="text-sm text-vs-fg-2">{t('cfmStudy.noCurrentWeek')}</p>}
  </div>}
 {context.activeLessonKey ? <div className="space-y-2">
   <p className="font-bold text-vs-fg">{active?.title??t('programPicker.active')}</p>
   <p className="text-sm text-vs-fg-2">{t(active?.read?'programPicker.read':'programPicker.reading')}</p>
   {context.available&&context.lessonHref ? <Link className={secondaryButton} href={context.lessonHref} prefetch={false}>{t('programPicker.continue')}</Link>:<p role="status">{t('programPicker.unavailable')}</p>}
  </div>:<p>{t('programPicker.noSelection')}</p>}
  <Link className={secondaryButton} href="/courses">{t('programPicker.choose')}</Link>
 </section>;
}
