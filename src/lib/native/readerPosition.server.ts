import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { commitAccountMutation } from "@/lib/account/mutation";
import { contentKeyOf } from "@/lib/learning/contentProgress";
import { claimReaderPosition, readReaderPosition, readerPositionKey, readerPositions } from "@/lib/learning/readerPosition";
import { chapterLocks } from "@/lib/readingCourses";
import { nativeScriptureReader } from "./reader.server";
import { nativeCoursePath, context, recheck } from "./courses.server";
import { NativeAuthError, type NativeSessionBinding } from "./sessions";
import type { NativeReader, NativeReaderKind } from "./readerContract";
import { readerPositionInput, readerPositionResult, readerResumeSchema, type ReaderPositionInput } from "./readerPositionContract";

async function identity(reader: NativeReader, db: Prisma.TransactionClient = prisma) {
  const chapter = await db.chapter.findUnique({where:{id:reader.chapterId},select:{id:true,number:true,book:{select:{key:true}}}});
  if (!chapter) throw new NativeAuthError("content_unavailable",404);
  return {contentKey:contentKeyOf(chapter),key:readerPositionKey(reader)};
}
/** V1 blijft byte-contractcompatibel voor reeds geïnstalleerde apps. Alleen
 * clients met scripture-reading-position-v1 vragen dit aanvullende contract. */
export async function nativeReaderResume(binding: NativeSessionBinding, courseId:string, kind:NativeReaderKind, targetId:string) {
  const initial = await context(binding);
  const reader = await nativeScriptureReader(binding,courseId,kind,targetId);
  const {contentKey,key} = await identity(reader);
  const progress = await prisma.contentProgress.findUnique({where:{userId_contentKey:{userId:binding.userId,contentKey}},select:{readerPositions:true}});
  const position = readReaderPosition(progress?.readerPositions,key);
  const path = await nativeCoursePath(binding,courseId);
  let previous:string|null=null, next:string|null=null;
  if(kind === "chapters" && path.kind === "chapters") {
    const locks=chapterLocks(path.chapters,path.sequential), index=path.chapters.findIndex(c=>c.id===targetId);
    const before=path.chapters[index-1],after=path.chapters[index+1];
    if(before&&before.verseCount>0&&before.verseCount<=500&&!locks.get(before.id))previous=before.id;
    if(after&&after.verseCount>0&&after.verseCount<=500&&!locks.get(after.id))next=after.id;
  }
  await recheck(binding,initial);
  // Hercontrole na de laatste aggregatie; een ingetrokken doel blijft verborgen.
  const current=await nativeScriptureReader(binding,courseId,kind,targetId);
  if(JSON.stringify(current)!==JSON.stringify(reader))throw new NativeAuthError("content_context_changed",409);
  return readerResumeSchema.parse({reader:{...reader,focusVerse:position ? Math.max(reader.startVerse,Math.min(reader.endVerse,position.verse)):reader.focusVerse},positionVersion:position?.version??0,previous,next});
}
export async function saveNativeReaderPosition(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string,raw:ReaderPositionInput) {
  const input=readerPositionInput.parse(raw);
  const before=await nativeScriptureReader(binding,courseId,kind,targetId);
  return commitAccountMutation({userId:binding.userId,nativeSession:binding},[],async tx=>{
    // User → NativeSession → collectie → cursus → boek → hoofdstuk → leesdoel.
    // Publicatie/intrekking wacht op deze korte commit, nooit op downloadwerk.
    await tx.$queryRaw`SELECT "id" FROM "ContentCollection" WHERE "id"=${before.activeCollectionId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "Course" WHERE "id"=${courseId} FOR SHARE`;
    const chapter=await tx.chapter.findUnique({where:{id:before.chapterId},select:{bookId:true}});
    if(!chapter)throw new NativeAuthError("content_unavailable",404);
    await tx.$queryRaw`SELECT "id" FROM "Book" WHERE "id"=${chapter.bookId} FOR SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "Chapter" WHERE "id"=${before.chapterId} FOR SHARE`;
    if((await tx.chapter.findUnique({where:{id:before.chapterId},select:{bookId:true}}))?.bookId!==chapter.bookId)throw new NativeAuthError("content_context_changed",409);
    if(kind === "steps")await tx.$queryRaw`SELECT "id" FROM "CourseLesson" WHERE "id"=${targetId} AND "courseId"=${courseId} FOR SHARE`;
    else await tx.$queryRaw`SELECT "chapterId" FROM "CourseChapter" WHERE "courseId"=${courseId} AND "chapterId"=${targetId} FOR SHARE`;

    const reader=await nativeScriptureReader(binding,courseId,kind,targetId,tx);
    if(reader.activeCollectionId!==input.activeCollectionId || reader.selectionVersion!==input.selectionVersion || reader.language!==input.language || reader.chapterId!==before.chapterId || reader.chapterId!==input.chapterId || reader.startVerse!==input.startVerse || reader.endVerse!==input.endVerse)
      throw new NativeAuthError("content_context_changed",409);
    if(input.verse<reader.startVerse || input.verse>reader.endVerse)throw new NativeAuthError("invalid_input",400);
    const {contentKey,key}=await identity(reader,tx), where={userId_contentKey:{userId:binding.userId,contentKey}};
    const progress=await tx.contentProgress.findUnique({where});
    const current=readReaderPosition(progress?.readerPositions,key);
    const saved=claimReaderPosition(current,{verse:input.verse,actionId:input.actionId,expectedVersion:input.expectedVersion,selectionVersion:input.selectionVersion});
    if(!saved)throw new NativeAuthError("reading_position_conflict",409);
    if(current?.actionId!==saved.actionId) {
      const positions={...readerPositions(progress?.readerPositions),[key]:saved};
      // Bewaar ook updatedAt: passief lezen mag de bestaande cursus-hervatlogica
      // (die op dat veld sorteert) niet veranderen. Geen enkel beloningsveld wijzigen.
      if(progress) {
        const count=await tx.$executeRaw`UPDATE "ContentProgress" SET "readerPositions"=${JSON.stringify(positions)}::jsonb WHERE "id"=${progress.id}`;
        if(count!==1)throw new NativeAuthError("reading_position_conflict",409);
      }
      else await tx.contentProgress.create({data:{userId:binding.userId,contentKey,readerPositions:JSON.parse(JSON.stringify(positions))}});
    }
    return readerPositionResult.parse({userId:binding.userId,activeCollectionId:reader.activeCollectionId,selectionVersion:reader.selectionVersion,language:reader.language,courseId,kind,targetId,actionId:input.actionId,version:saved.version,verse:saved.verse});
  });
}
