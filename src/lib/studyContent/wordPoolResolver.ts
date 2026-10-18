import {z} from 'zod';
import type {PrismaClient} from '@/generated/prisma/client';
import {prisma} from '@/lib/db';
import {getPublishedStudyLesson} from './revisions';
import {studyObjectHash} from './policy';
import {extractLessonWords,lessonWordOptionsSchema,LESSON_WORD_NORMALIZATION_VERSION} from './wordPool';
const requestSchema=z.object({lessonEditionId:z.string().min(1).max(128),revisionId:z.string().min(1).max(128),options:lessonWordOptionsSchema}).strict();
export type LessonWordPoolRequest=z.infer<typeof requestSchema>;
export type LessonPoolActor={id:string;isAdmin:boolean};
/** Interne readonly voorziening, geen publieke API of spelstart. Een context is geen toegangsbewijs. */
export async function resolveLessonWordPool(actor:LessonPoolActor|null,raw:LessonWordPoolRequest,client:PrismaClient=prisma){
 const parsed=requestSchema.safeParse(raw);
 if(!actor||!parsed.success)return {available:false as const,reason:'content' as const};
 const input=parsed.data;
 return client.$transaction(async tx=>{
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  await tx.$executeRaw`SET LOCAL statement_timeout='5s'`;
  const edition=await tx.studyLessonEdition.findUnique({where:{id:input.lessonEditionId},select:{lessonId:true,collectionId:true}});
  if(!edition)return {available:false as const,reason:'content' as const};
  // Bestaande centrale reader-gate valideert rechten, werk, editie, immutable hash en publicatie.
  const lesson=await getPublishedStudyLesson(actor,edition.lessonId,edition.collectionId,tx);
  if(!lesson)return {available:false as const,reason:'content' as const};
  if(lesson.revisionId!==input.revisionId)return {available:false as const,reason:'revision' as const};
  const result=extractLessonWords(lesson.body,lesson.language,input.options);
  if(!result.available)return {available:false as const,reason:result.reason};
  const identity={collectionId:lesson.collectionId,workKey:lesson.workKey,editionKey:lesson.editionKey,lessonId:lesson.lessonId,lessonEditionId:lesson.editionId,revisionId:lesson.revisionId,contentLanguage:lesson.language,revisionHash:lesson.contentHash,normalizationVersion:LESSON_WORD_NORMALIZATION_VERSION};
  const poolHash=studyObjectHash({identity,options:result.options,candidates:result.candidates});
  return Object.freeze({available:true as const,context:Object.freeze({...identity,poolHash}),candidates:result.candidates,totalCandidates:result.totalCandidates,truncated:result.truncated});
 },{maxWait:5000,timeout:10_000});
}
