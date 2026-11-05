import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { mutateAnnotation, readerAnnotations } from "@/lib/annotations/service";
import { commitAccountMutation } from "@/lib/account/mutation";
import { context, recheck } from "./courses.server";
import { nativeScriptureReader } from "./reader.server";
import type { NativeReader, NativeReaderKind } from "./readerContract";
import { NativeAuthError, type NativeSessionBinding } from "./sessions";
import { nativeAnnotationContext,nativeAnnotationScope,nativeAnnotationList,nativeAnnotationResult,nativeAnnotationMutation,type NativeAnnotationMutation } from "./annotationsContract";

function sameReader(before:NativeReader,after:NativeReader) {
  if(JSON.stringify(nativeAnnotationScope.parse(before))!==JSON.stringify(nativeAnnotationScope.parse(after)) ||
    JSON.stringify(before.verses)!==JSON.stringify(after.verses))throw new NativeAuthError("content_context_changed",409);
}
function hasVerse(reader:NativeReader,verseId:string) {
  if(!reader.verses.some(verse=>verse.id===verseId))throw new NativeAuthError("content_unavailable",404);
}
/** Geen writes, ook niet voor tombstones of verborgen privéannotaties. */
export async function nativeReaderAnnotations(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string,verseId?:string) {
  const value=await context(binding), reader=await nativeScriptureReader(binding,courseId,kind,targetId);
  if(verseId)hasVerse(reader,verseId);
  const list=await readerAnnotations(value.user,verseId?{targetKey:`verse:${verseId}`}:{verseIds:reader.verses.map(verse=>verse.id)});
  sameReader(reader,await nativeScriptureReader(binding,courseId,kind,targetId));
  await recheck(binding,value);
  const base={...nativeAnnotationScope.parse(reader),annotations:[],complete:list.complete};
  // Het bridgebudget begrenst gehele rijen, nooit de tekst van een notitie.
  let bytes=Buffer.byteLength(JSON.stringify(base)),complete=list.complete;
  const annotations=[];
  for(const row of list.annotations){
    const size=Buffer.byteLength(JSON.stringify(row))+1;
    if(bytes+size>768*1024){complete=false;continue;}
    bytes+=size;annotations.push(row);
  }
  return nativeAnnotationList.parse({...base,annotations,complete});
}
async function lockReader(db:Prisma.TransactionClient,reader:NativeReader) {
  await db.$queryRaw`SELECT "id" FROM "ContentCollection" WHERE "id"=${reader.activeCollectionId} FOR SHARE`;
  await db.$queryRaw`SELECT "id" FROM "Course" WHERE "id"=${reader.courseId} FOR SHARE`;
  const chapter=await db.chapter.findUnique({where:{id:reader.chapterId},select:{bookId:true}});
  if(!chapter)throw new NativeAuthError("content_unavailable",404);
  await db.$queryRaw`SELECT "id" FROM "Book" WHERE "id"=${chapter.bookId} FOR SHARE`;
  await db.$queryRaw`SELECT "id" FROM "Chapter" WHERE "id"=${reader.chapterId} FOR SHARE`;
  if((await db.chapter.findUnique({where:{id:reader.chapterId},select:{bookId:true}}))?.bookId!==chapter.bookId)throw new NativeAuthError("content_context_changed",409);
  if(reader.kind==="steps")await db.$queryRaw`SELECT "id" FROM "CourseLesson" WHERE "id"=${reader.targetId} AND "courseId"=${reader.courseId} FOR SHARE`;
  else await db.$queryRaw`SELECT "chapterId" FROM "CourseChapter" WHERE "courseId"=${reader.courseId} AND "chapterId"=${reader.targetId} FOR SHARE`;
}
/** De bestaande annotatietransactie krijgt uitsluitend een strengere native
 * commitgrens. Geen tweede write-, versie-, tombstone- of beloningslogica. */
export async function mutateNativeReaderAnnotation(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string,raw:NativeAnnotationMutation) {
  const input=nativeAnnotationMutation.parse(raw),before=await nativeScriptureReader(binding,courseId,kind,targetId);
  if(input.action.target.type!=="verse")throw new NativeAuthError("invalid_input",400);
  const verseId=input.action.target.verseId;
  hasVerse(before,verseId);
  const authorized=await context(binding),actor=authorized.user;
  const result=await mutateAnnotation(actor,input.action,input.operation==="delete",prisma,run=>
    commitAccountMutation({userId:binding.userId,nativeSession:binding},[],async tx=>{
      await recheck(binding,authorized,tx);
      await lockReader(tx,before);
      await tx.$queryRaw`SELECT "id" FROM "Verse" WHERE "id"=${verseId} FOR SHARE`;
      const reader=await nativeScriptureReader(binding,courseId,kind,targetId,tx);
      sameReader(before,reader);hasVerse(reader,verseId);
      if(JSON.stringify(nativeAnnotationContext.parse(reader))!==JSON.stringify(input.context))throw new NativeAuthError("content_context_changed",409);
      const outcome=await run(tx);
      sameReader(reader,await nativeScriptureReader(binding,courseId,kind,targetId,tx));
      nativeAnnotationResult.parse({...nativeAnnotationScope.parse(before),actionId:input.action.actionId,...outcome});
      return outcome;
    }));
  return nativeAnnotationResult.parse({...nativeAnnotationScope.parse(before),actionId:input.action.actionId,...result});
}
