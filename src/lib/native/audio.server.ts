import {resolveNativeGameAudio} from "./gamesAudio.server";
import {nativeGameAudioCatalogue,nativeGameAudioScope,nativeGamePlaybackSchema,type NativeGameAudioInput,type NativeGameReader} from "./gamesAudioContract";
import path from "node:path";
import { nativePlaybackSchema } from "./audioPlaybackContract";
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
/** Een bron die bewust wordt weggelaten krijgt een vaste, privacyvrije reden (alleen ids, nooit paden of
 * bytes), zodat de beheerder in het serverlog ziet waarom een opname niet selecteerbaar is. */
class AudioSkip extends NativeAuthError{constructor(public reason:string){super("audio_unavailable",404);}}
function skip(reason:string):never{throw new AudioSkip(reason);}
const skipReason=(error:unknown)=>error instanceof AudioSkip?error.reason:error instanceof ZodError?"ongeldige_gegevens":error instanceof Error&&error.message==="STORAGE_UNAVAILABLE"?"opslag_niet_beschikbaar":error instanceof Error&&["ENOENT","ELOOP"].includes((error as NodeJS.ErrnoException).code??"")?"bestand_ontbreekt_op_server":error instanceof Error&&["UNSAFE_DIRECTORY","UNSAFE_PATH"].includes(error.message)?"onveilig_pad":"bestand_komt_niet_overeen";
type Actor=Awaited<ReturnType<typeof context>>["user"];
async function authority(actor:Actor,chapterId:string) {
  const chapter=await prisma.chapter.findFirst({where:{id:chapterId,book:{contentCollection:readingAccessWhere(actor)}},include:{book:{include:{contentCollection:true}},audioCheck:true,verses:{orderBy:{number:"asc"}}}});
  if(!chapter)unavailable();
  const publication=await prisma.audioPublication.findUnique({where:{targetKey:`chapter:${chapterId}`},include:{recording:true}});
  const legacy=await prisma.officialAudioTask.findMany({where:{recording:{chapterId}},select:{id:true,legacyApprovedAt:true,legacyBaseline:true},orderBy:{id:"asc"}});
  return {chapter,publication,stamp:digest({chapter,publication,legacy})};
}
type MediaReader=NativeReader|NativeGameReader;
const mediaScope=(reader:MediaReader)=>"game" in reader?nativeGameAudioScope.parse(reader):nativeAudioScope.parse(reader);
function readerStamp(reader:MediaReader){return digest({scope:mediaScope(reader),verses:reader.verses,sourceLanguage:reader.sourceLanguage});}
type Prepared={source:NativeAudioSource;file:string;stamp:string;scope:ReturnType<typeof mediaScope>;authorityChapterId:string;readerHash:string;binding:NativeSessionBinding;until:number};
// Herberekenbare bronbeschrijvingen, geen sessies/credentials/audiobytes. Rechten
// worden nooit uit deze cache afgeleid: iedere range én chunk hercontroleert ze.
const prepared=new Map<string,Prepared>();
function remember(item:Prepared){if(prepared.size>=128)prepared.delete(prepared.keys().next().value!);prepared.set(item.source.id,item);}
export async function nativeAudioPrepareBudget(userId:string) {
  const limited=await authBudget(authBudgetKey("native-audio-prepare",userId),20,60000);
  if(limited)throw new NativeAuthError(limited.status===503?"security_check_unavailable":"too_many_attempts",limited.status);
}
type Resolution={reader:MediaReader;chapterId:string;intro?:{clip:{url:string;start:number;end:number}|null}}|{reader:NativeGameReader;chapterId:null;intro:{clip:null}};
type Resolver=()=>Promise<Resolution>;
async function prepareAudio(binding:NativeSessionBinding,resolve:Resolver){
  const value=await context(binding),resolved=await resolve(),{reader}=resolved,clip=resolved.intro?.clip;
  const editions=resolved.intro?{editions:clip?[{language:reader.sourceLanguage,verses:[{id:reader.verses[0].id,number:1,audioStart:clip.start}],url:clip.url,legacyFallback:null}]:[]}:await chapterAudioEditions(value.user,resolved.chapterId!);
  if(!editions)unavailable();
  const sources:NativeAudioSource[]=[],snapshots:Prepared[]=[];
  for(const edition of editions.editions){
    const first=edition.verses[0];if(!first)continue;
    const verse=resolved.intro?{chapterId:resolved.chapterId}:await prisma.verse.findUnique({where:{id:first.id},select:{chapterId:true}});if(!verse)continue;
    const authorityChapterId=verse.chapterId;
    if(!authorityChapterId)unavailable();
    const current=await authority(value.user,authorityChapterId);
    const make=async(url:string|null|undefined,starts:{number:number;audioStart:number|null}[],fallbackFor?:string)=>{
      if(!url)return;
      try{
        let file:string,sourceKind:"recording"|"legacy",expected:{sha256:string;byteSize:number}|undefined;
        let segments:{number:number;start:number;end:number|null}[];
        const recordingId=/^\/api\/audio\/recordings\/([A-Za-z0-9_-]{1,128})$/.exec(url)?.[1];
        if(recordingId){
          const recording=await accessibleRecording(value.user,recordingId);
          if(!recording||recording.chapterId!==authorityChapterId||current.publication?.recordingId!==recordingId)skip(!recording?"opname_niet_toegankelijk":recording.chapterId!==authorityChapterId?"opname_hoort_bij_ander_hoofdstuk":"opname_niet_gepubliceerd");
          file=path.join(await safeDirectory(await audioRoot(),"objects"),recording.sha256+".mp3");sourceKind="recording";expected={sha256:recording.sha256,byteSize:recording.byteSize};
          const rows=segmentsSchema.shape.segments.parse(recording.segments);
          segments=clip?[{number:1,start:clip.start,end:clip.end}]:current.chapter.verses.filter(v=>v.number>=reader.startVerse&&v.number<=reader.endVerse).map(v=>{const s=rows.find(s=>s.id===v.id);if(!s)unavailable();return {number:v.number,start:s.start,end:s.end};});
        }else{
          const name=/^\/api\/audio\/([^/]+)$/.exec(url)?.[1];
          if(!name||!isAudioFileName(name))skip("oude_audio_niet_gespiegeld_naar_server");
          if(current.chapter.audioCheck?.status==="NEEDS_REVIEW")skip("tekst_gewijzigd_audio_ter_controle");
          if(!fallbackFor&&mirrorFileName(current.chapter.audioUrl??"")!==name)skip("gespiegeld_bestand_komt_niet_overeen");
          if(!fallbackFor&&!current.chapter.audioCheck)skip("geen_audiocontrole_vastgelegd");
          if(!fallbackFor&&(current.chapter.audioCheck!.status!=="CURRENT"||current.chapter.audioCheck!.textHash!==chapterTextHash(current.chapter.verses.map(v=>v.text))))skip("tekst_wijkt_af_van_audiocontrole");
          file=path.join(await audioRoot(),name);sourceKind="legacy";
          segments=clip?[{number:1,start:clip.start,end:clip.end}]:starts.filter(v=>v.number>=reader.startVerse&&v.number<=reader.endVerse).map(v=>{
            const next=starts.find(s=>s.number===v.number+1),last=current.chapter.verses.at(-1)?.number;
            if(v.audioStart===null||next?.audioStart===null||!next&&v.number!==last)skip("versmarkeringen_ontbreken");
            return {number:v.number,start:v.audioStart,end:next?.audioStart??null};
          });
        }
        if(segments.length!==reader.endVerse-reader.startVerse+1)skip("versmarkeringen_onvolledig");
        const identity=await nativeAudioFileIdentity(file,expected);
        const base={kind:sourceKind,language:edition.language,audioChapterId:resolved.intro?reader.chapterId:authorityChapterId,collectionId:current.chapter.book.contentCollectionId,...identity,start:segments[0].start,end:segments.at(-1)!.end,verses:segments,...(fallbackFor?{fallbackFor}:{})};
        const id=digest({scope:mediaScope(reader),readerHash:readerStamp(reader),binding,stamp:current.stamp,base});
        const source=nativeAudioSource.parse({...base,id});
        const snapshot={source,file,authorityChapterId,stamp:current.stamp,scope:mediaScope(reader),readerHash:readerStamp(reader),binding,until:performance.now()+60000};remember(snapshot);snapshots.push(snapshot);sources.push(source);return source;
      }catch(error){
        if(error instanceof NativeAuthError&&error.code==="audio_unavailable"||error instanceof ZodError||error instanceof Error&&(["AUDIO_UNAVAILABLE","STORAGE_UNAVAILABLE","UNSAFE_DIRECTORY","UNSAFE_PATH"].includes(error.message)||["ENOENT","ELOOP"].includes((error as NodeJS.ErrnoException).code??""))){console.info("[native-audio] bron weggelaten",{hoofdstuk:authorityChapterId,taal:edition.language,reden:skipReason(error)});return;}
        throw error;
      }
    };
    const primary=await make(edition.url,edition.verses);
    // Alleen de door activeChapterAudio/legacyFallback bewezen uitgangssituatie.
    const fallback=edition.legacyFallback as {url:string;starts:{number:number;audioStart:number|null}[]}|null;
    if(primary&&fallback)await make(fallback.url,fallback.starts,primary.id);
  }
  if(readerStamp(reader)!==readerStamp((await resolve()).reader))throw new NativeAuthError("content_context_changed",409);
  for(const item of snapshots){if((await authority(value.user,item.authorityChapterId)).stamp!==item.stamp)throw new NativeAuthError("content_context_changed",409);}
  await recheck(binding,value);
  return ("game" in reader?nativeGameAudioCatalogue:nativeAudioCatalogue).parse({...mediaScope(reader),sessionId:binding.sessionId,readerHash:readerStamp(reader),serverTime:Date.now(),maxAgeMs:300000,sourceLanguage:reader.sourceLanguage,sources});
}
export async function nativeReaderAudio(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string){
  return nativeAudioCatalogue.parse(await prepareAudio(binding,async()=>{const reader=await nativeScriptureReader(binding,courseId,kind,targetId);return {reader,chapterId:reader.chapterId};}));
}
async function streamPreparedAudio(binding:NativeSessionBinding,resolve:Resolver,matches:(scope:ReturnType<typeof mediaScope>)=>boolean,sourceId:string,range:string|null,withBody:boolean,accessToken:string){
  if(!/^[a-f0-9]{64}$/.test(sourceId))unavailable();
  let item=prepared.get(sourceId);
  if(!item||item.until<performance.now()){
    await nativeAudioPrepareBudget(binding.userId);prepared.delete(sourceId);await prepareAudio(binding,resolve);item=prepared.get(sourceId);
  }
  if(!item||item.binding.sessionId!==binding.sessionId||item.binding.userId!==binding.userId||!matches(item.scope))unavailable();
  const selected=item;
  const authorize=async()=>{
    const verified=await nativeSessionIdentity(accessToken);
    if(digest(verified.binding)!==digest(binding))throw new NativeAuthError("session_expired");
    const reader=(await resolve()).reader;
    if(readerStamp(reader)!==selected.readerHash)throw new NativeAuthError("content_context_changed",409);
    const actor=await context(binding);
    if((await authority(actor.user,selected.authorityChapterId)).stamp!==selected.stamp)throw new NativeAuthError("content_context_changed",409);
    await recheck(binding,actor);
  };
  await authorize();
  if((withBody||range!==null)&&!nativeAudioRange(range))return new Response(null,{status:416,headers:{"Content-Range":`bytes */${selected.source.byteSize}`,"Cache-Control":"private, no-store"}});
  try {return await streamAudio(selected.file,range,withBody,{verify:async handle=>{await verifyNativeAudioFile(handle,selected.source);},authorize});}
  catch(error){if(error instanceof Error&&(error.message==="AUDIO_UNAVAILABLE"||["ENOENT","ELOOP"].includes((error as NodeJS.ErrnoException).code??"")))unavailable();throw error;}
}

export async function streamNativeReaderAudio(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string,sourceId:string,range:string|null,withBody:boolean,accessToken:string){
 return streamPreparedAudio(binding,async()=>{const reader=await nativeScriptureReader(binding,courseId,kind,targetId);return{reader,chapterId:reader.chapterId};},scope=>"courseId" in scope&&scope.courseId===courseId&&scope.kind===kind&&scope.targetId===targetId,sourceId,range,withBody,accessToken);
}
export async function nativeGamePlayback(binding:NativeSessionBinding,input:NativeGameAudioInput){
 const reader=(await resolveNativeGameAudio(binding,input)).reader,audio=await prepareAudio(binding,()=>resolveNativeGameAudio(binding,input));
 if(readerStamp(reader)!==audio.readerHash)throw new NativeAuthError("content_context_changed",409);
 return nativeGamePlaybackSchema.parse({version:1,audio,reader});
}
export function streamNativeGameAudio(binding:NativeSessionBinding,input:NativeGameAudioInput,sourceId:string,range:string|null,withBody:boolean,accessToken:string){
 return streamPreparedAudio(binding,()=>resolveNativeGameAudio(binding,input),scope=>"game" in scope&&JSON.stringify(scope.game)===JSON.stringify(input),sourceId,range,withBody,accessToken);
}

/** Afzonderlijk contract: oude /audio-clients houden hun strikte V1-respons.
 * De laatste cataloguscontrole en bestaande readerrechten zijn autoritatief. */
export async function nativeReaderPlayback(binding:NativeSessionBinding,courseId:string,kind:NativeReaderKind,targetId:string) {
  const reader=await nativeScriptureReader(binding,courseId,kind,targetId);
  const audio=await nativeReaderAudio(binding,courseId,kind,targetId);
  if(readerStamp(reader)!==audio.readerHash)throw new NativeAuthError("content_context_changed",409);
  return nativePlaybackSchema.parse({version:1,audio,reader});
}
