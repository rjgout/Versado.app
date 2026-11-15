import {z} from "zod";
import {nativeReaderSchema,nativeReaderBounds} from "./readerContract";
import {nativeAudioCatalogue,nativeAudioScope,nativeCatalogueBounds} from "./audioContract";
import type {NativePlayback} from "./audioPlaybackContract";
const id=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),index=z.number().int().min(0).max(499);
/** Alleen een openbare leesbron of een eigen/huidige quizvraag, nooit een URL. */
export const nativeGameAudioInput=z.discriminatedUnion("kind",[
 z.object({kind:z.literal("reading"),id}).strict(),
 z.object({kind:z.literal("intro-solo"),id,index}).strict(),
 z.object({kind:z.literal("intro-live"),id,index}).strict(),
 z.object({kind:z.literal("ak-solo"),id,index}).strict(),
 z.object({kind:z.literal("ak-live"),id,index}).strict(),
]);
export type NativeGameAudioInput=z.infer<typeof nativeGameAudioInput>;
export const nativeGameReaderSchema=z.object(nativeReaderSchema.shape).omit({courseId:true,kind:true,targetId:true}).extend({game:nativeGameAudioInput}).strict().superRefine(nativeReaderBounds);
export type NativeGameReader=z.infer<typeof nativeGameReaderSchema>;
/** Lokale presentatie selecteert tekst; uitsluitend de native metadatarespons
 * verleent een afspeellease. Geen verzonnen cursus-/bronlabels in de UI-selectie. */
export const nativeGameAudioSelection=z.object(nativeGameReaderSchema.shape).omit({collectionName:true}).strict().superRefine(nativeReaderBounds);
export type NativeGameAudioSelection=z.infer<typeof nativeGameAudioSelection>;
export const nativeGameAudioScope=z.object(nativeAudioScope.shape).omit({courseId:true,kind:true,targetId:true}).extend({game:nativeGameAudioInput});
export const nativeGameAudioCatalogue=z.object(nativeAudioCatalogue.shape).omit({courseId:true,kind:true,targetId:true}).extend({game:nativeGameAudioInput}).strict().superRefine(nativeCatalogueBounds);
export const nativeGamePlaybackSchema=z.object({version:z.literal(1),audio:nativeGameAudioCatalogue,reader:nativeGameReaderSchema}).strict().superRefine((value,ctx)=>{
 if(JSON.stringify(nativeGameAudioScope.parse(value.audio))!==JSON.stringify(nativeGameAudioScope.parse(value.reader))||value.audio.sourceLanguage!==value.reader.sourceLanguage||new TextEncoder().encode(JSON.stringify(value)).byteLength>1_048_576)ctx.addIssue({code:"custom",message:"audio_scope_invalid"});
});
export type NativeGamePlayback=z.infer<typeof nativeGamePlaybackSchema>;
export type NativeMediaPlayback=NativePlayback|NativeGamePlayback;
export function gameAudioPath(input:NativeGameAudioInput){return `games/${input.kind}/${input.id}${"index" in input?`/${input.index}`:""}/audio`;}
export function gameAudioIntroId(input:Exclude<NativeGameAudioInput,{kind:"reading"}>){return `${input.id.slice(0,100)}-q${input.index}`;}
/** JSON-brug laat alleen playback toe; audiobytes blijven in de native rangepoort. */
export function gameAudioRoute(path:string,method:string){
 if(path.length>512||!path.startsWith("games/"))return null;
 const parts=path.split("/"),kind=parts[1],position=kind==="reading"?3:4;
 const input=nativeGameAudioInput.safeParse({kind,id:parts[2],...(kind!=="reading"?{index:Number(parts[3])}:{})});
 if(!input.success||gameAudioPath(input.data)!==parts.slice(0,position+1).join("/"))return null;
 if(method==="GET"&&parts.length===position+2&&parts[position+1]==="playback")return {input:input.data,sourceId:null};
 if(!input.data.kind.startsWith("ak-")&&["GET","HEAD"].includes(method)&&parts.length===position+3&&/^[a-f0-9]{64}$/.test(parts[position+1])&&parts[position+2]==="stream")return {input:input.data,sourceId:parts[position+1]};
 return null;
}
