import {getStudyCatalogue} from '@/lib/studyContent/catalogue';
import {resolveWeekSelection} from '@/lib/studyContent/weekSelection';
import {cfmCoursePathHref} from '@/lib/studyContent/cfmCourses';
import {prisma} from '@/lib/db';
import ProgramLessonPicker from './ProgramLessonPicker';
import CfmTodayCard from './CfmTodayCard';
import LiveRefresh from '@/components/LiveRefresh';
export default async function ProgramContextPanel({actor}:{actor:{id:string;isAdmin:boolean}}){
 const data=await getStudyCatalogue(actor);
 if(!data.context)return null;
 const weeks=data.lessons.filter(l=>l.personal);
 let body;
 if(weeks.length&&data.collectionId){
  // Dezelfde weekregel als de cursuskaart en het weekpad (weekSelection.ts): kalenderweek, anders laatst gekozen/bestudeerde week, anders geen.
  const selection=resolveWeekSelection(weeks,{today:data.today??'',selectedLessonKey:data.context.activeLessonKey});
  const week=selection.resume;
  const weeksHref=await cfmCoursePathHref(prisma,data.collectionId,'STEPS');
  body=<CfmTodayCard
   key={`${actor.id}:${data.collectionId}`}
   programName={data.programName??''}
   mode={data.personalMode??'STEPS'}
   weeksHref={weeksHref??'/courses'}
   resumeReason={selection.resumeReason}
   week={week?{lessonId:week.lessonId,collectionId:week.collectionId,title:week.title,startsOn:week.startsOn,endsOnExclusive:week.endsOnExclusive,imageMediaId:week.imageMediaId,started:week.read||week.stepsDone>0||week.lessonKey===data.context.activeLessonKey}:null}
  />;
 } else body=<ProgramLessonPicker key={`${actor.id}:${data.context.workKey}:${data.collectionId}`} data={data}/>;
 return <div className="min-w-0"><LiveRefresh scopes={['studyContext','studyContent','content','progress']} token={data.token}/>{body}</div>;
}
