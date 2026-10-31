import {getStudyCatalogue} from '@/lib/studyContent/catalogue';
import {resolveWeekSelection} from '@/lib/studyContent/weekSelection';
import {cfmCoursePathHref} from '@/lib/studyContent/cfmCourses';
import {prisma} from '@/lib/db';



export async function getTodayProgram(actor:{id:string;isAdmin:boolean}){
 const data=await getStudyCatalogue(actor);
 if(!data.context)return null;
 const weeks=data.lessons.filter(l=>l.personal);
 let body;
 if((weeks.length||data.archivedCount>0)&&data.collectionId){
  // Dezelfde weekregel als de cursuskaart en het weekpad (weekSelection.ts): kalenderweek, anders laatst gekozen/bestudeerde week, anders geen.
  const selection=resolveWeekSelection(weeks,{today:data.today??'',selectedLessonKey:data.context.activeLessonKey});
  const week=selection.resume;
  const weeksHref=await cfmCoursePathHref(prisma,data.collectionId,'STEPS');
  body={ kind:'cfm' as const, props:{
   programName:data.programName??'', mode:data.personalMode??'STEPS', weeksHref:weeksHref??'/courses', resumeReason:selection.resumeReason,
   week:week?{lessonId:week.lessonId,collectionId:week.collectionId,title:week.title,startsOn:week.startsOn,endsOnExclusive:week.endsOnExclusive,imageMediaId:week.imageMediaId,started:week.read||week.stepsDone>0||week.lessonKey===data.context.activeLessonKey}:null,
  }};
 } else {
  const context=data.context,active=data.lessons.find(l=>l.lessonKey===context.activeLessonKey||(l.legacyKey!==null&&l.legacyKey===context.activeLessonKey));
  const current=data.lessons.find(l=>l.lessonKey===data.currentLessonKey&&l.personal);
  body={kind:'summary' as const,props:{programName:data.programName??'',personalMode:data.personalMode??null,
   context:{activeLessonKey:context.activeLessonKey,available:context.available,lessonHref:context.lessonHref},
   active:active?{title:active.title,read:active.read}:null,
   currentLesson:current?{lessonId:current.lessonId,collectionId:current.collectionId,title:current.title}:null,
   personalProgram:data.lessons.some(l=>l.personal)}};
 }
 return {token:data.token,body};
}
