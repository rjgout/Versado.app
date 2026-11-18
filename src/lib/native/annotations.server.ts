import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { mutateAnnotation, readerAnnotations } from "@/lib/annotations/service";
import { commitAccountMutation } from "@/lib/account/mutation";
import { context, recheck } from "./courses.server";
import { nativeScriptureReader } from "./reader.server";
import type { NativeReader, NativeReaderKind } from "./readerContract";
import { NativeAuthError, type NativeSessionBinding } from "./sessions";
import {resolveNativeGameAudio} from "./gamesAudio.server";
import type {NativeGameReader} from "./gamesAudioContract";
import {nativeGameAnnotationScope,nativeGameAnnotationList,nativeGameAnnotationResult} from "./annotationsContract";
import { nativeAnnotationContext,nativeAnnotationScope,nativeAnnotationList,nativeAnnotationResult,nativeAnnotationMutation,type NativeAnnotationMutation } from "./annotationsContract";

type Reader=NativeReader|NativeGameReader;
type Resolve=(db?:Prisma.TransactionClient)=>Promise<Reader>;
const scope=(reader:Reader)=>"game" in reader?nativeGameAnnotationScope.parse(reader):nativeAnnotationScope.parse(reader);
function sameReader(before:Reader,after:Reader) {
  if(JSON.stringify(scope(before))!==JSON.stringify(scope(after)) ||
    JSON.stringify(before.verses)!==JSON.stringify(after.verses))throw new NativeAuthError("content_context_changed",409);
}
function hasVerse(reader:Reader,verseId:string) {
  if(!reader.verses.some(verse=>verse.id===verseId))throw new NativeAuthError("content_unavailable",404);
}
/** Geen writes, ook niet voor tombstones of verborgen privéannotaties. */
export async function nativeReaderAnnotations(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string,verseId?:string) {
  return readAnnotations(binding,db=>nativeScriptureReader(binding,courseId,kind,targetId,db),verseId);
}
export async function nativeGameReaderAnnotations(binding:NativeSessionBinding,chapterId:string,verseId?:string){
 return readAnnotations(binding,async (db=prisma)=>(await resolveNativeGameAudio(binding,{kind:"reading",id:chapterId},db)).reader,verseId);
}
async function readAnnotations(binding:NativeSessionBinding,resolve:Resolve,verseId?:string){
  const value=await context(binding),reader=await resolve();
  if(verseId)hasVerse(reader,verseId);
  const list=await readerAnnotations(value.user,verseId?{targetKey:`verse:${verseId}`}:{verseIds:reader.verses.map(verse=>verse.id)});
  sameReader(reader,await resolve());
  await recheck(binding,value);
  const base={...scope(reader),annotations:[],complete:list.complete};
  // Het bridgebudget begrenst gehele rijen, nooit de tekst van een notitie.
  let bytes=Buffer.byteLength(JSON.stringify(base)),complete=list.complete;
  const annotations=[];
  for(const row of list.annotations){
    const size=Buffer.byteLength(JSON.stringify(row))+1;
    if(bytes+size>768*1024){complete=false;continue;}
    bytes+=size;annotations.push(row);
  }
  return ("game" in reader?nativeGameAnnotationList:nativeAnnotationList).parse({...base,annotations,complete});
}
async function lockReader(db:Prisma.TransactionClient,reader:Reader) {
  await db.$queryRaw`SELECT "id" FROM "ContentCollection" WHERE "id"=${reader.activeCollectionId} FOR SHARE`;
  if(!("game" in reader))await db.$queryRaw`SELECT "id" FROM "Course" WHERE "id"=${reader.courseId} FOR SHARE`;
  const chapter=await db.chapter.findUnique({where:{id:reader.chapterId},select:{bookId:true}});
  if(!chapter)throw new NativeAuthError("content_unavailable",404);
  await db.$queryRaw`SELECT "id" FROM "Book" WHERE "id"=${chapter.bookId} FOR SHARE`;
  await db.$queryRaw`SELECT "id" FROM "Chapter" WHERE "id"=${reader.chapterId} FOR SHARE`;
  if((await db.chapter.findUnique({where:{id:reader.chapterId},select:{bookId:true}}))?.bookId!==chapter.bookId)throw new NativeAuthError("content_context_changed",409);
  if("game" in reader)return;
  if(reader.kind==="steps")await db.$queryRaw`SELECT "id" FROM "CourseLesson" WHERE "id"=${reader.targetId} AND "courseId"=${reader.courseId} FOR SHARE`;
  else await db.$queryRaw`SELECT "chapterId" FROM "CourseChapter" WHERE "courseId"=${reader.courseId} AND "chapterId"=${reader.targetId} FOR SHARE`;
}
/** De bestaande annotatietransactie krijgt uitsluitend een strengere native
 * commitgrens. Geen tweede write-, versie-, tombstone- of beloningslogica. */
export async function mutateNativeReaderAnnotation(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string,raw:NativeAnnotationMutation) {
  return mutateReader(binding,db=>nativeScriptureReader(binding,courseId,kind,targetId,db),raw);
}
export async function mutateNativeGameReaderAnnotation(binding:NativeSessionBinding,chapterId:string,raw:NativeAnnotationMutation){
 return mutateReader(binding,async (db=prisma)=>(await resolveNativeGameAudio(binding,{kind:"reading",id:chapterId},db)).reader,raw);
}
async function mutateReader(binding:NativeSessionBinding,resolve:Resolve,raw:NativeAnnotationMutation){
  const input=nativeAnnotationMutation.parse(raw),before=await resolve();
  const resultSchema="game" in before?nativeGameAnnotationResult:nativeAnnotationResult;
  if(input.action.target.type!=="verse")throw new NativeAuthError("invalid_input",400);
  const verseId=input.action.target.verseId;
  hasVerse(before,verseId);
  const authorized=await context(binding),actor=authorized.user;
  const result=await mutateAnnotation(actor,input.action,input.operation==="delete",prisma,run=>
    commitAccountMutation({userId:binding.userId,nativeSession:binding},[],async tx=>{
      await recheck(binding,authorized,tx);
      await lockReader(tx,before);
      await tx.$queryRaw`SELECT "id" FROM "Verse" WHERE "id"=${verseId} FOR SHARE`;
      const reader=await resolve(tx);
      sameReader(before,reader);hasVerse(reader,verseId);
      if(JSON.stringify(nativeAnnotationContext.parse(reader))!==JSON.stringify(input.context))throw new NativeAuthError("content_context_changed",409);
      const outcome=await run(tx);
      sameReader(reader,await resolve(tx));
      resultSchema.parse({...scope(before),actionId:input.action.actionId,...outcome});
      return outcome;
    }));
  return resultSchema.parse({...scope(before),actionId:input.action.actionId,...result});
}
