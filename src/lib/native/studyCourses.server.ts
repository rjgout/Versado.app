import { prisma } from "@/lib/db";
import { cfmCourseListWhere } from "@/lib/studyContent/cfmCourses";
import { cfmProgrammeCollectionIds } from "@/lib/studyContent/cfmProgramme";
import { groupArchiveByYear } from "@/lib/studyContent/cfmProgramme";
import { getStudyCatalogue } from "@/lib/studyContent/catalogue";
import { getStepProgressForEdition } from "@/lib/studyContent/stepProgress";
import { resolveWeekSelection } from "@/lib/studyContent/weekSelection";
import { readingAccessWhere } from "@/lib/contentAccess";
import { isStudyCourseType, modeOfStudyCourse } from "@/lib/readingCourses";
import { courseTypeMatchesContent } from "@/lib/courseContent";
import { localizedCourse } from "@/lib/courseText";
import { userDayKey,userTimeZone } from "@/lib/timeZone";
import { context,recheck,envelope } from "./courses.server";
import { NativeAuthError,type NativeSessionBinding } from "./sessions";
import { nativeStudyCourseSchema,nativeStudyStepsSchema } from "./studyCoursesContract";

async function studyContext(binding:NativeSessionBinding,courseId:string) {
 const value=await context(binding);
 const where={...cfmCourseListWhere(value.user,value.picker.activeCollectionId??""),id:courseId,type:{in:["STUDY_STEPS","STUDY_FREE"] as ("STUDY_STEPS"|"STUDY_FREE")[]}};
 const course=await prisma.course.findFirst({where,include:{contentCollection:{select:{id:true,work:true}}}});
 if(!course || !isStudyCourseType(course.type) || !courseTypeMatchesContent(course.type,course.contentCollection.work))throw new NativeAuthError("content_unavailable",404);
 return {value,course,where,mode:modeOfStudyCourse(course.type)};
}
function editionsWhere(input:Awaited<ReturnType<typeof studyContext>>) {
 return {collectionId:{in:cfmProgrammeCollectionIds(input.course.contentCollection)},collection:readingAccessWhere(input.value.user),publishedRevisionId:{not:null},lesson:{retiredAt:null,work:{kind:"STUDY_PROGRAM" as const}}};
}
async function finalCheck(binding:NativeSessionBinding,input:Awaited<ReturnType<typeof studyContext>>,editions:Array<{id:string;revisionId:string}>) {
 const latest=await recheck(binding,input.value);
 if(!await prisma.course.findFirst({where:{...input.where,type:input.course.type},select:{id:true}}))throw new NativeAuthError("content_unavailable",404);
 if(editions.length) {
  const live=await prisma.studyLessonEdition.findMany({where:{...editionsWhere(input),id:{in:editions.map(e=>e.id)}},select:{id:true,publishedRevisionId:true}});
  const revisions=new Map(live.map(e=>[e.id,e.publishedRevisionId]));
  if(editions.some(e=>revisions.get(e.id)!==e.revisionId))throw new NativeAuthError("content_context_changed",409);
 }
 // Sessies worden ook na de laatste publicatiequery hercontroleerd.
 await recheck(binding,input.value);
 return latest;
}
export async function nativeStudyCourse(binding:NativeSessionBinding,courseId:string,scope:"weeks"|"archive") {
 const input=await studyContext(binding,courseId),{value,course}=input;
 const data=await getStudyCatalogue(value.user,new Date(),{collectionId:course.contentCollectionId,scope:scope==="archive"?"archive":"current",readOnlySteps:true});
 if(!data.today || data.collectionId!==course.contentCollectionId)throw new NativeAuthError("content_unavailable",404);
 const weeks=data.lessons.filter(l=>l.personal).map(l=>({id:l.id,lessonId:l.lessonId,collectionId:l.collectionId,lessonKey:l.lessonKey,workKey:l.workKey,revisionId:l.revisionId,title:l.title,startsOn:l.startsOn,endsOnExclusive:l.endsOnExclusive,read:l.read,stepsDone:l.stepsDone,imageMediaId:l.imageMediaId,lastStudiedAt:l.lastStudiedAt,order:l.order}));
 const selection=resolveWeekSelection(weeks,{today:data.today,selectedLessonKey:data.context?.activeLessonKey});
 const latest=await finalCheck(binding,input,weeks);
 if(userDayKey(latest.user,new Date())!==data.today)throw new NativeAuthError("content_context_changed",409);
 return nativeStudyCourseSchema.parse({...envelope(value),courseId,courseName:localizedCourse({...course,work:course.contentCollection.work},value.user.uiLanguage).name,mode:input.mode,scope,today:data.today,timeZone:userTimeZone(value.user),weeks,groups:scope==="archive"?groupArchiveByYear(weeks):[],activeWeekId:selection.resume?.id??null,resumeReason:selection.resumeReason,archivedCount:data.archivedCount,truncated:data.truncated});
}
export async function nativeStudySteps(binding:NativeSessionBinding,courseId:string,editionId:string) {
 const input=await studyContext(binding,courseId);
 const edition=await prisma.studyLessonEdition.findFirst({where:{...editionsWhere(input),id:editionId},select:{publishedRevisionId:true}});
 if(!edition?.publishedRevisionId)throw new NativeAuthError("content_unavailable",404);
 const steps=await getStepProgressForEdition(input.value.user,editionId,prisma,{readOnly:true});
 if(!steps || steps.revisionId!==edition.publishedRevisionId)throw new NativeAuthError("content_context_changed",409);
 await finalCheck(binding,input,[{id:editionId,revisionId:steps.revisionId}]);
 return nativeStudyStepsSchema.parse({...envelope(input.value),courseId,editionId,...steps});
}
