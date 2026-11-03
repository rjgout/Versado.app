import { z } from "zod";
import type { PluginListenerHandle } from "@capacitor/core";
import type { NativeReader } from "./readerContract";
import { nativeAudioScope } from "./audioContract";

export const nativeAudioStatusSchema=z.object({enabled:z.boolean(),anchored:z.boolean(),foreground:z.boolean(),contextEpoch:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),validForMs:z.number().nonnegative().max(300000),readerHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),ownerId:z.uuid().optional()}).strict();
export const nativeAudioInterruptionSchema=z.object({interruption:z.literal(true),contextEpoch:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict();
export const nativeAudioLifecycleSchema=z.object({lifecycle:z.literal(true),active:z.boolean(),contextEpoch:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict();
export const nativeAudioEventSchema=z.object({commandId:z.uuid(),actionVersion:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),index:z.number().int().min(0).max(499),playing:z.boolean(),stopped:z.boolean(),failed:z.boolean(),reason:z.enum(["invalidated","replaced","expired","unavailable","renew"]).optional()}).strict();
export const nativeVoiceSchema=z.object({id:z.string().min(1).max(512),name:z.string().min(1).max(512),language:z.string().min(2).max(35),local:z.literal(true)}).strict();
export const nativeVoicesSchema=z.object({voices:z.array(nativeVoiceSchema).max(512)}).strict();
export type NativeDeviceVoice=z.infer<typeof nativeVoiceSchema>;
export type NativeAudioSelector=z.infer<typeof nativeAudioScope>;
export const nativeAudioSelector=(reader:NativeReader):NativeAudioSelector=>nativeAudioScope.parse(reader);
export interface NativeAudioCommand {
  action:"start"|"pause"|"resume"|"seek"|"speed";
  sessionStamp:string;ownerId:string;contextEpoch:number;readerHash:string;commandId:string;actionVersion:number;
  index?:number;speed?:number;sourceId?:string;voiceId?:string;
}
export interface NativeAudioBridge {
  audioSession(options:{sessionStamp:string}):Promise<void>;
  audioContext(options:{sessionStamp:string;ownerId:string;scope?:NativeAudioSelector;forget?:boolean}):Promise<void>;
  audioStatus():Promise<z.infer<typeof nativeAudioStatusSchema>>;
  audioVoices():Promise<{voices:NativeDeviceVoice[]}>;
  audioCommand(options:NativeAudioCommand):Promise<void>;
  addListener(event:"audioState",callback:(value:unknown)=>void):Promise<PluginListenerHandle>;
}
