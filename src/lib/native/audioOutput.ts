import type { ReadAloudOutput, ReadAloudOutputEvent } from "@/lib/readAloudOutput";
import type { ReadAloudSource } from "@/lib/readAloudPlayerContext";
import { NativeClientError, type NativeSessionClient } from "./client";
import type { NativePlayback } from "./audioPlaybackContract";
import { nativeAudioEventSchema, nativeAudioLifecycleSchema, nativeAudioStatusSchema, nativeVoicesSchema, type NativeAudioBridge, type NativeAudioCommand, type NativeAudioSelector } from "./audioBridge";
export interface NativeAudioTarget {
  ownerId:string;sessionStamp:string;scope:NativeAudioSelector;sourceLanguage:string;
  current():boolean;
  load(renew:boolean):Promise<NativePlayback>;
}
type Action={source:ReadAloudSource;commandId:string;actionVersion:number;owner:NativeAudioTarget;contextEpoch:number;index:number;speed:number};
/** Eén uitvoeradapter, geen tweede data-/afspeelcache. Native houdt codecs en
 * credentials; LiveDataStore levert metadata; de gedeelde provider rendert. */
export class NativeReadAloudOutput implements ReadAloudOutput {
  private listeners=new Set<(event:ReadAloudOutputEvent)=>void>();
  private listenerSlot:{closed:boolean;ready:Promise<{remove():Promise<void>}>}|null=null;
  private target:NativeAudioTarget|null=null;
  private active:Action|null=null;
  private operation=0;
  private latestNativeEpoch=0;
  private foreground=true;
  constructor(readonly client:NativeSessionClient,readonly bridge:NativeAudioBridge,readonly enabled:boolean) {
    client.onSessionChange(()=>{this.operation++;this.target=null;this.clearLocal(false);});
  }
  private publish(event:ReadAloudOutputEvent){for(const listener of this.listeners)listener(event);}
  private clearLocal(failed:boolean){const action=this.active;this.active=null;if(action)this.publish({commandId:action.commandId,index:action.index,playing:false,stopped:true,failed});}
  private events(){
    if(this.enabled&&this.listeners.size&&!this.listenerSlot){
      const slot={closed:false,ready:Promise.resolve({remove:async()=>{}})};
      slot.ready=Promise.resolve().then(()=>this.bridge.addListener("audioState",value=>{if(!slot.closed)this.received(value);}));
      this.listenerSlot=slot;
      void slot.ready.catch(()=>{if(!slot.closed){slot.closed=true;if(this.listenerSlot===slot)this.listenerSlot=null;this.clearLocal(true);}});
    }
    return this.listenerSlot;
  }
  subscribe(listener:(event:ReadAloudOutputEvent)=>void){
    this.listeners.add(listener);this.events();
    return ()=>{this.listeners.delete(listener);if(!this.listeners.size&&this.listenerSlot){const slot=this.listenerSlot;slot.closed=true;this.listenerSlot=null;void slot.ready.then(handle=>handle.remove()).catch(()=>{});}};
  }
  bind(target:NativeAudioTarget){
    const old=this.target;if(old&&old.ownerId!==target.ownerId){void this.stop().catch(()=>{});}this.target=target;
    return ()=>{if(this.target===target){void this.stop().catch(()=>{});this.target=null;}};
  }
  isCurrent(target:NativeAudioTarget){return this.enabled&&this.target===target&&target.current()&&target.sessionStamp===this.client.getSessionStamp();}
  accepts(source:ReadAloudSource){
    const target=this.target;
    return !!target&&!!source.native&&source.native.ownerId===target.ownerId&&this.isCurrent(target)&&source.id===target.scope.chapterId&&source.verses.length===target.scope.endVerse-target.scope.startVerse+1&&source.verses.every((verse,index)=>verse.number===target.scope.startVerse+index)&& (!!source.native.sourceId||source.language===target.sourceLanguage);
  }
  private received(value:unknown){
    const lifecycle=nativeAudioLifecycleSchema.safeParse(value);
    if(lifecycle.success){
      if(lifecycle.data.contextEpoch<this.latestNativeEpoch)return;
      this.latestNativeEpoch=lifecycle.data.contextEpoch;this.foreground=lifecycle.data.active;
      if(!this.foreground){this.operation++;this.clearLocal(false);}return;
    }
    const parsed=nativeAudioEventSchema.safeParse(value),action=this.active;
    if(!parsed.success||!action||parsed.data.commandId!==action.commandId||parsed.data.actionVersion<action.actionVersion||!this.isCurrent(action.owner)||parsed.data.index>=action.source.verses.length)return;
    const event=parsed.data;action.index=event.index;this.publish(event);
    if(event.stopped){this.operation++;this.active=null;}
    else if(event.reason==="renew"&&event.playing){void action.owner.load(true).catch(()=>{});}
  }
  private async prepare(target:NativeAudioTarget,source:ReadAloudSource,operation:number){
    if(!this.isCurrent(target)||source.native?.ownerId!==target.ownerId)throw new NativeClientError("audio_changed");
    let status=nativeAudioStatusSchema.parse(await this.bridge.audioStatus());
    if(!this.isCurrent(target)||operation!==this.operation)throw new NativeClientError("audio_changed");
    if(status.contextEpoch>=this.latestNativeEpoch){this.latestNativeEpoch=status.contextEpoch;this.foreground=status.foreground;}
    if(!this.foreground||!status.foreground)throw new NativeClientError("audio_backgrounded");
    const matches=()=>status.enabled&&status.foreground&&status.ownerId===target.ownerId&&status.readerHash===source.native?.readerHash&&status.validForMs>1000;
    if(!matches()){
      await target.load(!status.anchored||status.validForMs<30000);
      if(!this.isCurrent(target)||operation!==this.operation)throw new NativeClientError("audio_changed");
      status=nativeAudioStatusSchema.parse(await this.bridge.audioStatus());
      if(!matches()){
        // Eén nieuwe read-autorisatie hergebruikt de bestaande refreshqueue;
        // nooit een onbekend schrijfresultaat of een opname in een andere taal.
        await target.load(true);status=nativeAudioStatusSchema.parse(await this.bridge.audioStatus());
      }
    }
    if(!matches()||!this.foreground||status.contextEpoch<this.latestNativeEpoch||!this.isCurrent(target)||operation!==this.operation)throw new NativeClientError("audio_changed");
    this.latestNativeEpoch=Math.max(this.latestNativeEpoch,status.contextEpoch);
    return status;
  }
  private options(action:Action,kind:NativeAudioCommand["action"]):NativeAudioCommand {
    return {action:kind,sessionStamp:action.owner.sessionStamp,ownerId:action.owner.ownerId,readerHash:action.source.native!.readerHash,contextEpoch:action.contextEpoch,commandId:action.commandId,actionVersion:action.actionVersion};
  }
  async start(source:ReadAloudSource,index:number,speed:number,commandId:string){
    const target=this.target;if(!target||!source.native||source.native.ownerId!==target.ownerId||!this.isCurrent(target))throw new NativeClientError("audio_changed");
    const previous=this.active;
    if(previous){previous.actionVersion++;void this.bridge.audioCommand(this.options(previous,"pause")).catch(()=>{});}
    const operation=++this.operation,action:Action={source,commandId,actionVersion:1,owner:target,contextEpoch:source.native.contextEpoch,index,speed};this.active=action;
    try {
      const events=this.events();
      if(!events||events.closed)throw new NativeClientError("audio_unavailable");
      await events.ready;
      if(events.closed||!this.isCurrent(target)||operation!==this.operation)throw new NativeClientError("audio_changed");
      const status=await this.prepare(target,source,operation);
      if(this.active!==action||events.closed)throw new NativeClientError("audio_changed");action.contextEpoch=status.contextEpoch;
      await this.bridge.audioCommand({...this.options(action,"start"),index,speed,...(source.native.sourceId?{sourceId:source.native.sourceId}:{}),...(source.native.voiceId?{voiceId:source.native.voiceId}:{})});
    }catch(error){if(this.active===action){this.clearLocal(true);void this.bridge.audioContext({sessionStamp:target.sessionStamp,ownerId:target.ownerId,forget:true}).catch(()=>{});}throw error;}
  }
  async control(kind:"pause"|"resume"|"seek"|"speed",index:number,speed:number,commandId:string){
    const action=this.active;if(!action||action.commandId!==commandId||!this.isCurrent(action.owner))throw new NativeClientError("audio_changed");
    const sequence=++action.actionVersion;
    if(kind==="resume"){
      const status=await this.prepare(action.owner,action.source,this.operation);
      if(this.active!==action||sequence!==action.actionVersion)throw new NativeClientError("audio_changed");action.contextEpoch=status.contextEpoch;
    }
    if(!this.isCurrent(action.owner))throw new NativeClientError("audio_changed");
    action.index=index;action.speed=speed;
    await this.bridge.audioCommand({...this.options(action,kind),...(kind==="seek"?{index}:{}),...(kind==="speed"?{speed}:{})});
  }
  async stop(){const target=this.target;this.operation++;this.clearLocal(false);if(this.enabled&&target)await this.bridge.audioContext({sessionStamp:target.sessionStamp,ownerId:target.ownerId,forget:true});}
}

/** Alleen deze bestaande read-autorisatie wordt zo nodig één keer vernieuwd.
 * Achtergrond tussen refreshantwoord en veilige opslag mag de native anchor
 * terecht verwerpen; na hervatten herstellen we die zonder login-/POST-retry. */
export async function loadNativeAudioMetadata(bridge:NativeAudioBridge,target:NativeAudioTarget,getPlayback:(renew:boolean)=>Promise<NativePlayback>,renew=false){
  const current=()=>{if(!target.current())throw new NativeClientError("audio_changed");};
  current();await bridge.audioContext({sessionStamp:target.sessionStamp,ownerId:target.ownerId,scope:target.scope});
  current();let playback=await getPlayback(renew);current();
  let status=nativeAudioStatusSchema.parse(await bridge.audioStatus());current();
  const matches=()=>status.enabled&&status.foreground&&status.ownerId===target.ownerId&&status.readerHash===playback.audio.readerHash&&status.validForMs>1000;
  if(!status.enabled||!status.foreground)throw new NativeClientError("audio_unavailable");
  if(!matches()){playback=await getPlayback(true);current();status=nativeAudioStatusSchema.parse(await bridge.audioStatus());current();}
  if(!matches())throw new NativeClientError("audio_changed");
  const voices=nativeVoicesSchema.parse(await bridge.audioVoices()).voices;current();
  return {playback,status,voices};
}
