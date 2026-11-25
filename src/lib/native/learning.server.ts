import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { commitAccountMutation } from "@/lib/account/mutation";
import { completeChapterReading, issueExerciseSession, submitExerciseSession, contentKeyOf, getReadingStepExercisePart, type IssuedSet } from "@/lib/learning/contentProgress";
import { completeReadingLesson, completeReadingOnlyStep } from "@/lib/readingLessons";
import { advanceCourseProgress } from "@/lib/courses";
import { isExerciseCorrect } from "@/lib/exerciseGen";
import { emitToUser } from "@/lib/realtime";
import { notifyNewAchievements } from "@/lib/notify";
import { nativeScriptureReader } from "./reader.server";
import { NativeAuthError, type NativeSessionBinding } from "./sessions";
import type { NativeReader, NativeReaderKind } from "./readerContract";
import { nativeLearningScope, type NativeLearningScope, type NativeLearningStart, type NativeLearningSubmit, type NativeLearningCheck } from "./learningContract";

type Tx = Prisma.TransactionClient;
const AGE = 7 * 86400_000;
const receiptSchema = z.object({
  nativeLearning: z.literal(1), scope: nativeLearningScope,
  nativeSessionId: z.string(), nativeSessionVersion: z.number(),
  courseId: z.string(), kind: z.enum(["steps", "chapters"]), targetId: z.string(),
  readerHash: z.string(), operation: z.enum(["exercise", "read"]),
  issued: z.custom<IssuedSet>(), digest: z.string().nullable(),
  outcome: z.record(z.string(), z.unknown()).nullable(),
});
type Receipt = z.infer<typeof receiptSchema>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function readerHash(reader: NativeReader) {
  // Focus is voortgang, geen inhoudsrevisie: afronding verandert dit niet.
  return hash({...reader,focusVerse:0});
}
function sameScope(reader: NativeReader, input: NativeLearningScope) {
  if (Object.entries(input).some(([key, value]) => key in nativeLearningScope.shape && reader[key as keyof NativeReader] !== value))
    throw new NativeAuthError("content_context_changed", 409);
}
function receiptFor(binding: NativeSessionBinding, reader: NativeReader, operation: Receipt["operation"], issued: IssuedSet): Receipt {
  return { nativeLearning: 1, scope: nativeLearningScope.parse(Object.fromEntries(Object.keys(nativeLearningScope.shape).map(key=>[key,reader[key as keyof NativeReader]]))), nativeSessionId: binding.sessionId,
    nativeSessionVersion: binding.sessionVersion, courseId: reader.courseId, kind: reader.kind, targetId: reader.targetId,
    readerHash: readerHash(reader), operation, issued, digest: null, outcome: null };
}
function boundReceipt(row: { userId: string; createdAt: Date; submittedAt: Date | null; nativeContext: unknown; result: unknown }, binding: NativeSessionBinding, reader: NativeReader) {
  const parsed = receiptSchema.safeParse(row.nativeContext);
  if (!parsed.success || row.userId !== binding.userId || Date.now() - row.createdAt.getTime() > AGE)
    throw new NativeAuthError("content_unavailable", 404);
  const completed = row.submittedAt ? z.object({digest:z.string().nullable(),outcome:z.record(z.string(),z.unknown())}).safeParse(row.result) : null;
  if(row.submittedAt && !completed?.success)throw new NativeAuthError("learning_result_unavailable",409);
  const value = {...parsed.data,...(completed?.success ? completed.data : {})};
  if (value.nativeSessionId !== binding.sessionId || value.nativeSessionVersion !== binding.sessionVersion || value.courseId !== reader.courseId || value.kind !== reader.kind || value.targetId !== reader.targetId || value.readerHash !== readerHash(reader))
    throw new NativeAuthError("content_context_changed", 409);
  sameScope(reader, value.scope);
  return value;
}
async function loadReceipt(tx: Tx, id: string, binding: NativeSessionBinding, reader: NativeReader) {
  const row = await tx.exerciseSession.findUnique({ where: { id } });
  if (!row) throw new NativeAuthError("content_unavailable", 404);
  return { row, receipt: boundReceipt(row, binding, reader) };
}
function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)); }
/** Bestaande accountcommit: User → NativeSession → bron → cursus → boek →
 * hoofdstuk → doel → oefeningen. Geen HTTP, import of geneste transactie. */
async function mutate<T>(binding: NativeSessionBinding, courseId: string, kind: NativeReaderKind, targetId: string, input: NativeLearningScope, run: (tx: Tx, reader: NativeReader) => Promise<T>) {
  const before = await nativeScriptureReader(binding, courseId, kind, targetId);
  sameScope(before, input);
  return commitAccountMutation({userId:binding.userId,nativeSession:binding}, [], async tx => {
    await tx.$queryRaw`SELECT id FROM "ContentCollection" WHERE id=${before.activeCollectionId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Course" WHERE id=${courseId} FOR SHARE`;
    const chapter = await tx.chapter.findUnique({where:{id:before.chapterId},select:{bookId:true}});
    if (!chapter) throw new NativeAuthError("content_unavailable",404);
    await tx.$queryRaw`SELECT id FROM "Book" WHERE id=${chapter.bookId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Chapter" WHERE id=${before.chapterId} FOR UPDATE`;
    if (kind === "steps") await tx.$queryRaw`SELECT id FROM "CourseLesson" WHERE id=${targetId} FOR SHARE`;
    else await tx.$queryRaw`SELECT "chapterId" FROM "CourseChapter" WHERE "courseId"=${courseId} AND "chapterId"=${targetId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Verse" WHERE "chapterId"=${before.chapterId} ORDER BY id FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "Exercise" WHERE "chapterId"=${before.chapterId} ORDER BY id FOR SHARE`;
    const reader = await nativeScriptureReader(binding,courseId,kind,targetId,tx);
    sameScope(reader,input);
    if(readerHash(reader)!==readerHash(before))throw new NativeAuthError("content_context_changed",409);
    const result = await run(tx,reader);
    const latest=await nativeScriptureReader(binding,courseId,kind,targetId,tx);
    if(readerHash(reader)!==readerHash(latest))throw new NativeAuthError("content_context_changed",409);
    return result;
  });
}
function publicReceipt(value: Receipt, sessionId: string) {
  return { version:1, ...value.issued, sessionId, status:value.outcome ? "submitted" : "open", outcome:value.outcome };
}
/** GET hervat uitsluitend de reeds uitgedeelde set; nooit initialisatie. */
export async function nativeLearningSession(binding: NativeSessionBinding, courseId: string, kind: NativeReaderKind, targetId: string, sessionId: string) {
  const reader = await nativeScriptureReader(binding,courseId,kind,targetId);
  const {receipt} = await loadReceipt(prisma,sessionId,binding,reader);
  const latest = await nativeScriptureReader(binding,courseId,kind,targetId);
  if(readerHash(latest)!==readerHash(reader))throw new NativeAuthError("content_context_changed",409);
  return publicReceipt(receipt,sessionId);
}
export async function startNativeLearning(binding: NativeSessionBinding, courseId:string, kind:NativeReaderKind, targetId:string, input:NativeLearningStart) {
  return mutate(binding,courseId,kind,targetId,input,async(tx,reader)=>{
    const old=await tx.exerciseSession.findUnique({where:{id:input.actionId}});
    if(old) {
      const receipt=boundReceipt(old,binding,reader);
      if(receipt.operation!=="exercise")throw new NativeAuthError("invalid_input",409);
      return publicReceipt(receipt,old.id);
    }
    const issued=await issueExerciseSession(binding.userId,reader.chapterId,kind==="steps"?{lessonId:targetId,startVerse:reader.startVerse,endVerse:reader.endVerse}:undefined,tx);
    const receipt=receiptFor(binding,reader,"exercise",{...issued,sessionId:input.actionId});
    if(issued.sessionId)await tx.exerciseSession.update({where:{id:issued.sessionId},data:{id:input.actionId,nativeContext:json(receipt)}});
    else await tx.exerciseSession.create({data:{id:input.actionId,userId:binding.userId,chapterId:reader.chapterId,contentKey:contentKeyOf(await tx.chapter.findUniqueOrThrow({where:{id:reader.chapterId},include:{book:true}})),courseLessonId:kind==="steps"?targetId:null,exerciseIds:"[]",nativeContext:json(receipt)}});
    return publicReceipt(receipt,input.actionId);
  });
}
function answerDigest(answers: NativeLearningSubmit["answers"], ids: string[]) {
  if (answers.length!==ids.length || new Set(answers.map(a=>a.exerciseId)).size!==ids.length || answers.some(a=>!ids.includes(a.exerciseId)))
    throw new NativeAuthError("invalid_input",400);
  return hash([...answers].sort((a,b)=>a.exerciseId.localeCompare(b.exerciseId)));
}
async function nextChapter(tx:Tx,reader:NativeReader) {
  const cursor=await tx.userCourseProgress.findUnique({where:{userId_courseId:{userId:reader.userId,courseId:reader.courseId}},select:{currentChapterId:true}});
  return cursor?.currentChapterId??null;
}
export async function submitNativeLearning(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string,input:NativeLearningSubmit) {
  const response=await mutate(binding,courseId,kind,targetId,input,async(tx,reader)=>{
    const {row,receipt}=await loadReceipt(tx,input.sessionId,binding,reader);
    if(receipt.operation!=="exercise")throw new NativeAuthError("invalid_input",409);
    const digest=answerDigest(input.answers,JSON.parse(row.exerciseIds));
    if(row.submittedAt) {
      if(!receipt.outcome || receipt.digest!==digest)throw new NativeAuthError("learning_replay_conflict",409);
      return {...publicReceipt(receipt,row.id),replayed:true};
    }
    const outcome=kind==="steps"
      ? await completeReadingLesson(binding.userId,targetId,row.id,input.answers,tx)
      : await submitExerciseSession(binding.userId,row.id,input.answers,{validate:async(_tx,s)=>{if(s.chapterId!==reader.chapterId || s.courseLessonId!==null)throw new NativeAuthError("content_unavailable",404);}},tx);
    if(kind==="chapters" && outcome.content.done)await advanceCourseProgress(tx,binding.userId,courseId,reader.chapterId);
    const saved={...receipt,digest,outcome:{...outcome,...(kind==="chapters"?{nextChapterId:await nextChapter(tx,reader)}:{})}};
    await tx.exerciseSession.update({where:{id:row.id},data:{result:json({digest:saved.digest,outcome:saved.outcome})}});
    return {...publicReceipt(saved,row.id),replayed:false};
  });
  if(!response.replayed && response.outcome) {
    emitToUser(binding.userId,"streak_changed",{});
    const achievements=response.outcome.newAchievements;
    if(Array.isArray(achievements))void notifyNewAchievements(binding.userId,achievements as Parameters<typeof notifyNewAchievements>[1]).catch(()=>{});
  }
  return response;
}
/** Expliciet lezen zonder XP. Eigen receipt in bestaande ExerciseSession.result;
 * dezelfde actie kan na responseverlies worden opgevraagd, nooit herafgerond. */
export async function completeNativeReading(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string,input:NativeLearningStart) {
  const response=await mutate(binding,courseId,kind,targetId,input,async(tx,reader)=>{
    const old=await tx.exerciseSession.findUnique({where:{id:input.actionId}});
    if(old) {
      const receipt=boundReceipt(old,binding,reader);
      if(receipt.operation!=="read" || !receipt.outcome)throw new NativeAuthError("learning_replay_conflict",409);
      return {...publicReceipt(receipt,old.id),replayed:true};
    }
    if(kind==="steps") {
      // Dezelfde planfunctie, geen aparte vraagaantallen. Een stap mét vragen
      // kan uitsluitend via de uitgedeelde set worden afgerond.
      const part=await getReadingStepExercisePart(tx,reader.chapterId,reader.startVerse,reader.endVerse);
      if(part.count>0)throw new NativeAuthError("learning_questions_required",409);
    }
    const outcome=kind==="steps"?await completeReadingOnlyStep(binding.userId,targetId,tx):await completeChapterReading(binding.userId,reader.chapterId,tx);
    if(kind==="chapters" && "content" in outcome && outcome.content.done)await advanceCourseProgress(tx,binding.userId,courseId,reader.chapterId);
    const receipt={...receiptFor(binding,reader,"read",{sessionId:input.actionId,exercises:[]}),outcome:{...outcome,...(kind==="chapters"?{nextChapterId:await nextChapter(tx,reader)}:{})}};
    const chapter=await tx.chapter.findUniqueOrThrow({where:{id:reader.chapterId},include:{book:true}});
    await tx.exerciseSession.create({data:{id:input.actionId,userId:binding.userId,chapterId:reader.chapterId,courseLessonId:kind==="steps"?targetId:null,contentKey:contentKeyOf(chapter),exerciseIds:"[]",submittedAt:new Date(),nativeContext:json({...receipt,outcome:null}),result:json({digest:null,outcome:receipt.outcome})}});
    return {...publicReceipt(receipt,input.actionId),replayed:false};
  });
  if(!response.replayed)emitToUser(binding.userId,"streak_changed",{});
  return response;
}
/** Bestaande servercorrectheid, uitsluitend voor een eigen actuele uitgedeelde
 * vraag na expliciete beantwoording. Geen antwoordvelden in start/GET. */
export async function checkNativeLearning(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string,input:NativeLearningCheck) {
  return mutate(binding,courseId,kind,targetId,input,async(tx,reader)=>{
    const {row,receipt}=await loadReceipt(tx,input.sessionId,binding,reader);
    if(row.submittedAt || receipt.operation!=="exercise" || !(JSON.parse(row.exerciseIds) as string[]).includes(input.exerciseId))throw new NativeAuthError("content_unavailable",404);
    const exercise=await tx.exercise.findFirst({where:{id:input.exerciseId,chapterId:reader.chapterId}});
    if(!exercise)throw new NativeAuthError("content_unavailable",404);
    const accepted=JSON.parse(exercise.answers) as string[];
    return {version:1,exerciseId:exercise.id,correct:isExerciseCorrect(exercise.type,input.given,accepted),correctAnswer:accepted};
  });
}
