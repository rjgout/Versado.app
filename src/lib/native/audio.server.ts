import path from "node:path";
import { ZodError } from "zod";
import { chapterTextHash } from "@/lib/audioCheck";
import { prisma } from "@/lib/db";
import { authBudget, authBudgetKey } from "@/lib/authBudget";
import { readingAccessWhere } from "@/lib/contentAccess";
import { chapterAudioEditions } from "@/lib/audio/editions";
import { accessibleRecording } from "@/lib/audio/library";
import { objectHash, segmentsSchema } from "@/lib/audio/contract";
import { audioRoot, safeDirectory } from "@/lib/audio/storage";
import { isAudioFileName, mirrorFileName } from "@/lib/audioMirror";
import { streamAudio } from "@/lib/audio/stream";
import { nativeScriptureReader } from "./reader.server";
import { context, recheck } from "./courses.server";
import { NativeAuthError, nativeSessionIdentity, type NativeSessionBinding } from "./sessions";
import { nativeAudioCatalogue, nativeAudioScope, nativeAudioSource, nativeAudioRange, type NativeAudioSource } from "./audioContract";
import { nativeAudioFileIdentity, verifyNativeAudioFile } from "./audioFile.server";
import type { NativeReader, NativeReaderKind } from "./readerContract";
const digest=(value:unknown)=>objectHash(JSON.parse(JSON.stringify(value)));
function unavailable():never{throw new NativeAuthError("audio_unavailable",404);}
type Actor=Awaited<ReturnType<typeof context>>["user"];
async function authority(actor:Actor,chapterId:string) {
  const chapter=await prisma.chapter.findFirst({where:{id:chapterId,book:{contentCollection:readingAccessWhere(actor)}},include:{book:{include:{contentCollection:true}},audioCheck:true,verses:{orderBy:{number:"asc"}}}});
  if(!chapter)unavailable();
  const publication=await prisma.audioPublication.findUnique({where:{targetKey:`chapter:${chapterId}`},include:{recording:true}});
  const legacy=await prisma.officialAudioTask.findMany({where:{recording:{chapterId}},select:{id:true,legacyApprovedAt:true,legacyBaseline:true},orderBy:{id:"asc"}});
  return {chapter,publication,stamp:digest({chapter,publication,legacy})};
}
function readerStamp(reader:NativeReader){return digest({scope:nativeAudioScope.parse(reader),verses:reader.verses,sourceLanguage:reader.sourceLanguage});}
type Prepared={source:NativeAudioSource;file:string;stamp:string;scope:ReturnType<typeof nativeAudioScope.parse>;readerHash:string;binding:NativeSessionBinding;until:number};
// Herberekenbare bronbeschrijvingen, geen sessies/credentials/audiobytes. Rechten
// worden nooit uit deze cache afgeleid: iedere range én chunk hercontroleert ze.
const prepared=new Map<string,Prepared>();
function remember(item:Prepared){if(prepared.size>=128)prepared.delete(prepared.keys().next().value!);prepared.set(item.source.id,item);}
export async function nativeAudioPrepareBudget(userId:string) {
  const limited=await authBudget(authBudgetKey("native-audio-prepare",userId),20,60000);
  if(limited)throw new NativeAuthError(limited.status===503?"security_check_unavailable":"too_many_attempts",limited.status);
}
export async function nativeReaderAudio(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string) {
  const value=await context(binding),reader=await nativeScriptureReader(binding,courseId,kind,targetId);
  const editions=await chapterAudioEditions(value.user,reader.chapterId);
  if(!editions)unavailable();
  const sources:NativeAudioSource[]=[],snapshots:Prepared[]=[];
  for(const edition of editions.editions){
    const first=edition.verses[0];if(!first)continue;
    const verse=await prisma.verse.findUnique({where:{id:first.id},select:{chapterId:true}});if(!verse)continue;
    const current=await authority(value.user,verse.chapterId);
    const make=async(url:string|null|undefined,starts:{number:number;audioStart:number|null}[],fallbackFor?:string)=>{
      if(!url)return;
      try{
        let file:string,sourceKind:"recording"|"legacy",expected:{sha256:string;byteSize:number}|undefined;
        let segments:{number:number;start:number;end:number|null}[];
        const recordingId=/^\/api\/audio\/recordings\/([A-Za-z0-9_-]{1,128})$/.exec(url)?.[1];
        if(recordingId){
          const recording=await accessibleRecording(value.user,recordingId);
          if(!recording||recording.chapterId!==verse.chapterId||current.publication?.recordingId!==recordingId)unavailable();
          file=path.join(await safeDirectory(await audioRoot(),"objects"),recording.sha256+".mp3");sourceKind="recording";expected={sha256:recording.sha256,byteSize:recording.byteSize};
          const rows=segmentsSchema.shape.segments.parse(recording.segments);
          segments=current.chapter.verses.filter(v=>v.number>=reader.startVerse&&v.number<=reader.endVerse).map(v=>{const s=rows.find(s=>s.id===v.id);if(!s)unavailable();return {number:v.number,start:s.start,end:s.end};});
        }else{
          const name=/^\/api\/audio\/([^/]+)$/.exec(url)?.[1];
          if(!name||!isAudioFileName(name)||current.chapter.audioCheck?.status==="NEEDS_REVIEW"||!fallbackFor&&mirrorFileName(current.chapter.audioUrl??"")!==name)unavailable();
          if(!fallbackFor&&(!current.chapter.audioCheck||current.chapter.audioCheck.status!=="CURRENT"||current.chapter.audioCheck.textHash!==chapterTextHash(current.chapter.verses.map(v=>v.text))))unavailable();
          file=path.join(await audioRoot(),name);sourceKind="legacy";
          segments=starts.filter(v=>v.number>=reader.startVerse&&v.number<=reader.endVerse).map(v=>{
            const next=starts.find(s=>s.number===v.number+1),last=current.chapter.verses.at(-1)?.number;
            if(v.audioStart===null||next?.audioStart===null||!next&&v.number!==last)unavailable();
            return {number:v.number,start:v.audioStart,end:next?.audioStart??null};
          });
        }
        if(segments.length!==reader.endVerse-reader.startVerse+1)unavailable();
        const identity=await nativeAudioFileIdentity(file,expected);
        const base={kind:sourceKind,language:edition.language,audioChapterId:verse.chapterId,collectionId:current.chapter.book.contentCollectionId,...identity,start:segments[0].start,end:segments.at(-1)!.end,verses:segments,...(fallbackFor?{fallbackFor}:{})};
        const id=digest({scope:nativeAudioScope.parse(reader),readerHash:readerStamp(reader),binding,stamp:current.stamp,base});
        const source=nativeAudioSource.parse({...base,id});
        const snapshot={source,file,stamp:current.stamp,scope:nativeAudioScope.parse(reader),readerHash:readerStamp(reader),binding,until:performance.now()+60000};remember(snapshot);snapshots.push(snapshot);sources.push(source);return source;
      }catch(error){
        if(error instanceof NativeAuthError&&error.code==="audio_unavailable"||error instanceof ZodError||error instanceof Error&&(["AUDIO_UNAVAILABLE","STORAGE_UNAVAILABLE","UNSAFE_DIRECTORY","UNSAFE_PATH"].includes(error.message)||["ENOENT","ELOOP"].includes((error as NodeJS.ErrnoException).code??"")))return;
        throw error;
      }
    };
    const primary=await make(edition.url,edition.verses);
    // Alleen de door activeChapterAudio/legacyFallback bewezen uitgangssituatie.
    const fallback=edition.legacyFallback as {url:string;starts:{number:number;audioStart:number|null}[]}|null;
    if(primary&&fallback)await make(fallback.url,fallback.starts,primary.id);
  }
  if(readerStamp(reader)!==readerStamp(await nativeScriptureReader(binding,courseId,kind,targetId)))throw new NativeAuthError("content_context_changed",409);
  for(const item of snapshots){if((await authority(value.user,item.source.audioChapterId)).stamp!==item.stamp)throw new NativeAuthError("content_context_changed",409);}
  await recheck(binding,value);
  return nativeAudioCatalogue.parse({...nativeAudioScope.parse(reader),sessionId:binding.sessionId,readerHash:readerStamp(reader),serverTime:Date.now(),maxAgeMs:300000,sourceLanguage:reader.sourceLanguage,sources});
}
export async function streamNativeReaderAudio(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string,sourceId:string,range:string|null,withBody:boolean,accessToken:string) {
  if(!/^[a-f0-9]{64}$/.test(sourceId))unavailable();
  let item=prepared.get(sourceId);
  if(!item||item.until<performance.now()){
    await nativeAudioPrepareBudget(binding.userId);prepared.delete(sourceId);await nativeReaderAudio(binding,courseId,kind,targetId);item=prepared.get(sourceId);
  }
  if(!item||item.binding.sessionId!==binding.sessionId||item.binding.userId!==binding.userId||item.scope.courseId!==courseId||item.scope.kind!==kind||item.scope.targetId!==targetId)unavailable();
  const selected=item;
  const authorize=async()=>{
    const verified=await nativeSessionIdentity(accessToken);
    if(digest(verified.binding)!==digest(binding))throw new NativeAuthError("session_expired");
    const reader=await nativeScriptureReader(binding,courseId,kind,targetId);
    if(readerStamp(reader)!==selected.readerHash)throw new NativeAuthError("content_context_changed",409);
    const actor=await context(binding);
    if((await authority(actor.user,selected.source.audioChapterId)).stamp!==selected.stamp)throw new NativeAuthError("content_context_changed",409);
    await recheck(binding,actor);
  };
  await authorize();
  if((withBody||range!==null)&&!nativeAudioRange(range))return new Response(null,{status:416,headers:{"Content-Range":`bytes */${selected.source.byteSize}`,"Cache-Control":"private, no-store"}});
  try {return await streamAudio(selected.file,range,withBody,{verify:async handle=>{await verifyNativeAudioFile(handle,selected.source);},authorize});}
  catch(error){if(error instanceof Error&&(error.message==="AUDIO_UNAVAILABLE"||["ENOENT","ELOOP"].includes((error as NodeJS.ErrnoException).code??"")))unavailable();throw error;}
}
