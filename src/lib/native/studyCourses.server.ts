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
import { nativeStudyLessonSchema,nativeStudyLessonAnnotationList,nativeStudyLessonAnnotationResult,nativeStudyLessonMutation } from "./studyLessonContract";
import { getPublishedStudyLesson } from "@/lib/studyContent/revisions";
import { parseStudyDocument } from "@/lib/studyContent/schema";
import { mutateAnnotation,readerAnnotations } from "@/lib/annotations/service";
import { validatePassageSelector } from "@/lib/annotations/contract";
import { commitAccountMutation } from "@/lib/account/mutation";

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

/** Architectuurproef rijke studielessen: het gepubliceerde lesdocument, zoals de webreader het via `getPublishedStudyLesson` leest.
 * Dezelfde rechtencontrole als de stappen (cursus, editie, publicatie, sessie); alleen lezen en geen eigen tekstcopie. */
export async function nativeStudyLesson(binding:NativeSessionBinding,courseId:string,editionId:string) {
 const input=await studyContext(binding,courseId);
 const edition=await prisma.studyLessonEdition.findFirst({where:{...editionsWhere(input),id:editionId},select:{lessonId:true,collectionId:true}});
 if(!edition)throw new NativeAuthError("content_unavailable",404);
 const lesson=await getPublishedStudyLesson(input.value.user,edition.lessonId,edition.collectionId);
 if(!lesson||lesson.editionId!==editionId)throw new NativeAuthError("content_unavailable",404);
 const bindings=await prisma.studyRevisionMedia.findMany({where:{revisionId:lesson.revisionId},select:{mediaKey:true,media:{select:{id:true,status:true}}}});
 await finalCheck(binding,input,[{id:editionId,revisionId:lesson.revisionId}]);
 return nativeStudyLessonSchema.parse({...envelope(input.value),courseId,editionId,lessonId:lesson.lessonId,collectionId:lesson.collectionId,revisionId:lesson.revisionId,title:lesson.title,
  body:parseStudyDocument(lesson.body),media:bindings.map(b=>({mediaKey:b.mediaKey,mediaId:b.media.status==="READY"?b.media.id:null}))});
}
function lessonScope(l:{version:1;userId:string;activeCollectionId:string|null;selectionVersion:number;language:string;courseId:string;editionId:string;revisionId:string}){const {version,userId,activeCollectionId,selectionVersion,language,courseId,editionId,revisionId}=l;return {version,userId,activeCollectionId,selectionVersion,language,courseId,editionId,revisionId};}
/** Eigen annotaties van de les (inclusief de door de server bepaalde plaats in de huidige revisie); geen writes. */
export async function nativeStudyLessonAnnotations(binding:NativeSessionBinding,courseId:string,editionId:string) {
 const lesson=await nativeStudyLesson(binding,courseId,editionId),input=await studyContext(binding,courseId);
 const list=await readerAnnotations(input.value.user,{lessonEditionId:editionId,revisionId:lesson.revisionId});
 await finalCheck(binding,input,[{id:editionId,revisionId:lesson.revisionId}]);
 return nativeStudyLessonAnnotationList.parse({...lessonScope(lesson),annotations:list.annotations,complete:list.complete});
}
/** Schrijven loopt via dezelfde `mutateAnnotation` als de webreader; hier alleen de native sessie- en contextgrens eromheen. */
export async function mutateNativeStudyLessonAnnotation(binding:NativeSessionBinding,courseId:string,editionId:string,raw:unknown) {
 const input=nativeStudyLessonMutation.parse(raw);
 if(input.action.target.type!=="lesson"||input.action.target.lessonEditionId!==editionId)throw new NativeAuthError("invalid_input",400);
 const lesson=await nativeStudyLesson(binding,courseId,editionId);
 if(input.action.target.revisionId!==lesson.revisionId)throw new NativeAuthError("content_context_changed",409);
 // De selector wordt tegen het gepubliceerde document gecontroleerd voordat er iets wordt opgeslagen.
 validatePassageSelector(lesson.body,input.action.target.selector);
 const authorized=await context(binding);
 const result=await mutateAnnotation(authorized.user,input.action,input.operation==="delete",prisma,run=>
  commitAccountMutation({userId:binding.userId,nativeSession:binding},[],async tx=>{await recheck(binding,authorized,tx);return run(tx);}));
 return nativeStudyLessonAnnotationResult.parse({...lessonScope(lesson),actionId:input.action.actionId,...result});
}
