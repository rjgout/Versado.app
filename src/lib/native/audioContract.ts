import { z } from "zod";
import { nativeReaderSchema } from "./readerContract";

export const NATIVE_AUDIO_CHUNK_BYTES = 256 * 1024;
export const NATIVE_AUDIO_MAX_BYTES = 256 * 1024 * 1024;
export const nativeAudioScope = z.object(nativeReaderSchema.shape).pick({version:true,userId:true,activeCollectionId:true,selectionVersion:true,language:true,courseId:true,kind:true,targetId:true,chapterId:true,startVerse:true,endVerse:true});
const id=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const nativeAudioSource = z.object({
  id:hash,kind:z.enum(["recording","legacy"]),language:z.enum(["nl","en","de","fr","es"]),
  audioChapterId:id,collectionId:id,sha256:hash,byteSize:z.number().int().positive().max(NATIVE_AUDIO_MAX_BYTES),
  fallbackFor:hash.optional(),start:z.number().nonnegative(),end:z.number().positive().nullable(),
  verses:z.array(z.object({number:z.number().int().min(1).max(500),start:z.number().nonnegative(),end:z.number().positive().nullable()}).strict()).min(1).max(500),
}).strict().superRefine((s,c)=>{
  if(s.start!==s.verses[0].start||s.end!==s.verses.at(-1)!.end||s.verses.some((v,i)=>v.end!==null&&v.end<=v.start||i>0&&(v.number!==s.verses[i-1].number+1||v.start<s.verses[i-1].start||(s.verses[i-1].end===null||s.verses[i-1].end!>v.start))))c.addIssue({code:"custom",message:"audio_bounds_invalid"});
});
export const nativeAudioCatalogue = nativeAudioScope.extend({sessionId:id,readerHash:hash,serverTime:z.number().int().positive(),maxAgeMs:z.literal(300000),sourceLanguage:z.enum(["nl","en","de","fr","es"]),sources:z.array(nativeAudioSource).max(10)}).strict().superRefine((s,c)=>{
  if(new Set(s.sources.map(x=>x.id)).size!==s.sources.length||s.sources.some(x=>x.verses[0].number!==s.startVerse||x.verses.at(-1)!.number!==s.endVerse))c.addIssue({code:"custom",message:"audio_scope_invalid"});
});
export type NativeAudioSource=z.infer<typeof nativeAudioSource>;
export type NativeAudioCatalogue=z.infer<typeof nativeAudioCatalogue>;
/** Alleen eindige, enkelvoudige requests; nooit een volledige MP3 via de JSON-brug. */
export function nativeAudioRange(value:string|null):{start:number;end:number}|null {
  const m=value&&/^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(value);
  if(!m)return null;
  const start=Number(m[1]),end=Number(m[2]);
  return Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>=start&&end-start<NATIVE_AUDIO_CHUNK_BYTES?{start,end}:null;
}
