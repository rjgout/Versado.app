import assert from "node:assert/strict";
import test from "node:test";
import { NativeSessionClient, NativeClientError, type NativeSessionRequestInit, type SecureSessionStore } from "../src/lib/native/client";
import { NativeDataRuntime, nativePlaybackQueryKey } from "../src/lib/data/native";
import { nativePlaybackSchema } from "../src/lib/native/audioPlaybackContract";
import { NativeAudioSessionGate } from "../src/lib/native/audioSessionGate";
import { accessRouteAllowed, nativeAccessTransport } from "../src/lib/native/access";
const path="courses/course/read/chapters/chapter/audio/playback";
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
function saved() {let value:string|null=null;const store:SecureSessionStore={read:async()=>value,write:async input=>{value=input;},clear:async()=>{value=null;}};return {store,get:()=>value};}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}
function fixture(language:string,kind:string) {
 const scope={version:1,userId:"user",activeCollectionId:"collection",selectionVersion:3,language,courseId:"course",kind,targetId:"target",chapterId:"chapter",startVerse:2,endVerse:3};
 const reader={...scope,collectionName:"Collection",bookName:"Book",chapterNumber:1,sourceLanguage:language,focusVerse:2,verses:[{id:"v2",number:2,text:"Tweede synthetisch vers"},{id:"v3",number:3,text:"Derde synthetisch vers"}]};
 const audio={...scope,sessionId:"session",readerHash:"a".repeat(64),serverTime:Date.now(),maxAgeMs:300000,sourceLanguage:language,sources:[]};
 return {version:1,audio,reader};
}
test("één playback-snapshot houdt account, bron, taal, leeswijze en versbereik exact gelijk",()=>{
 for(const language of ["nl","en","de","fr","es"])for(const kind of ["steps","chapters"]){
  const value=fixture(language,kind);assert.ok(nativePlaybackSchema.safeParse(value).success);
  for(const [key,item]of Object.entries({userId:"other",activeCollectionId:"other",selectionVersion:4,courseId:"other",kind:kind==="steps"?"chapters":"steps",targetId:"other",chapterId:"other",startVerse:1,endVerse:4,language:language==="nl"?"en":"nl"}))
   assert.equal(nativePlaybackSchema.safeParse({...value,audio:{...value.audio,[key]:item}}).success,false,key);
 }
});
test("read-lease renewal deelt bestaande refreshqueue en kan geen schrijf- of algemene route vernieuwen",async()=>{
 const state=saved(),gate=deferred<Response>();let refreshes=0,reads=0;
 const client=new NativeSessionClient("https://example.invalid",state.store,async(url)=>{
  if(String(url).endsWith("/login"))return reply({accessToken:"a0",refreshToken:"r0",expiresIn:300});
  if(String(url).endsWith("/refresh")){refreshes++;return gate.promise;}
  if(String(url).endsWith(path)){reads++;return reply({ok:true});}
  throw Error("Onverwachte route");
 });
 await client.login("test","test");
 for(const invalid of ["today",path.replace("playback","position"),`${path}?url=other`,`../${path}`])await assert.rejects(client.renewReaderAudio(invalid),/invalid_input/);
 assert.equal(refreshes,0);
 const a=client.renewReaderAudio(path),b=client.renewReaderAudio(path);
 await new Promise(resolve=>setImmediate(resolve));assert.equal(refreshes,1);
 gate.resolve(reply({accessToken:"a1",refreshToken:"r1",expiresIn:300}));
 await Promise.all([a,b]);assert.equal(reads,2);assert.equal(refreshes,1);assert.equal(JSON.parse(state.get()!).refreshToken,"r1");
});
test("requeststamp volgt sessiegeneratie; een laat antwoord na logout wordt verworpen",async()=>{
 const state=saved(),gate=deferred<Response>();const requests:{path:string;stamp?:string}[]=[];
 const client=new NativeSessionClient("https://example.invalid",state.store,async(url,init)=>{
  requests.push({path:String(url),stamp:(init as NativeSessionRequestInit).nativeSessionStamp});
  if(String(url).endsWith("/login"))return reply({accessToken:"a0",refreshToken:"r0",expiresIn:300});
  if(String(url).endsWith(path))return gate.promise;
  return reply({ok:true});
 });
 const initial=client.getSessionStamp();await client.login("test","test");const active=client.getSessionStamp();assert.notEqual(active,initial);
 let boundary="";client.onSessionChange(stamp=>{boundary=stamp;});
 const reading=client.api(path);await new Promise(resolve=>setImmediate(resolve));
 await client.logout();assert.equal(boundary,client.getSessionStamp());assert.notEqual(boundary,active);
 assert.equal(requests.find(r=>r.path.endsWith(path))!.stamp,active);
 gate.resolve(reply({ok:true}));await assert.rejects(reading,error=>error instanceof NativeClientError&&error.code==="session_changed");
});
test("mislukte read-renewal bewaart refreshintentie en verstuurt geen playback- of schrijfaanvraag",async()=>{
 const state=saved();let refreshes=0,other=0;
 const client=new NativeSessionClient("https://example.invalid",state.store,async url=>{
  if(String(url).endsWith("/login"))return reply({accessToken:"a0",refreshToken:"r0",expiresIn:300});
  if(String(url).endsWith("/refresh")){refreshes++;return reply({error:"security_check_unavailable"},503);}
  other++;return reply({ok:true});
 });
 await client.login("test","test");await assert.rejects(client.renewReaderAudio(path),/security_check_unavailable/);
 assert.equal(refreshes,1);assert.equal(other,0);assert.equal(JSON.parse(state.get()!).refreshToken,"r0");
});
test("de Access-brug draagt alleen de niet-geheime requeststamp mee; geen nieuwe HTTPheader of binaire route",async()=>{
 assert.ok(accessRouteAllowed(path,"GET"));
 for(const method of ["POST","HEAD","DELETE"])assert.equal(accessRouteAllowed(path,method),false);
 assert.equal(accessRouteAllowed(path.replace("playback",`${"a".repeat(64)}/stream`),"GET"),false);
 const stamp=crypto.randomUUID();let captured:unknown;
 const transport=nativeAccessTransport({accessStatus:async()=>({enabled:true,configured:true}),enrollAccess:async()=>({changed:false}),clearAccess:async()=>({changed:false}),accessRequest:async input=>{captured=input;return {status:200,body:"{}"};}});
 const init:NativeSessionRequestInit={method:"GET",nativeSessionStamp:stamp,headers:{Authorization:"Bearer synthetic","X-Versado-Client":"native-v1"}};
 await transport(`https://dev.versado.app/api/v1/native/${path}`,init);
 assert.deepEqual(captured,{path,method:"GET",sessionStamp:stamp,authorization:"Bearer synthetic"});
 await assert.rejects(transport(`https://dev.versado.app/api/v1/native/${path}`,{...init,nativeSessionStamp:"bad"} as NativeSessionRequestInit),/access_request_invalid/);
});

test("de native reset is een barrier: geen HTTP vóór ack en geen oude generatie na accountwissel",async()=>{
 const a=deferred<void>(),b=deferred<void>(),old=crypto.randomUUID(),fresh=crypto.randomUUID();let resets=0;
 const gate=new NativeAudioSessionGate({audioSession:()=>++resets===1?a.promise:b.promise});
 gate.reset(old);let passed=false;
 const request=gate.beforeRequest(old).then(()=>{passed=true;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(passed,false);
 gate.reset(fresh);a.resolve();await assert.rejects(request,/access_changed/);
 const next=gate.beforeRequest(fresh).then(()=>{passed=true;});await new Promise(resolve=>setImmediate(resolve));assert.equal(passed,false);
 b.resolve();await next;assert.equal(passed,true);await assert.rejects(gate.beforeRequest(old),/access_changed/);
});
test("een mislukte native reset blokkeert nieuwe requests zonder auth of opslag te herschrijven",async()=>{
 for (const audioSession of [async()=>{throw Error("bridge unavailable");},()=>{throw Error("synchronous bridge failure");}]) {
 const stamp=crypto.randomUUID();const gate=new NativeAudioSessionGate({audioSession});
 gate.reset(stamp);await assert.rejects(gate.beforeRequest(stamp),/access_changed/);
 }
});

test("playback-antwoorden kunnen geen sessie-epoch, tekstidentiteit of leerdoel oversteken",async()=>{
 const value=nativePlaybackSchema.parse(fixture("nl","steps")),gate=deferred<unknown>();
 const environment={now:()=>0,random:()=>0,isVisible:()=>true,isOnline:()=>true,schedule:()=>()=>{}};
 const client={api:()=>gate.promise} as unknown as NativeSessionClient;
 const runtime=new NativeDataRuntime(client,environment);
 const pending=runtime.readerPlayback(value.reader);runtime.reset();gate.resolve(value);
 await assert.rejects(pending,/session_changed/);
 for(const change of [
  {...value.reader,targetId:"other"},
  {...value.reader,verses:value.reader.verses.map((v,i)=>i? v:{...v,text:"Gewijzigde tekst"})},
 ]){
  const runtime=new NativeDataRuntime({api:async()=>({...value,reader:change,audio:{...value.audio,...(change.targetId!==value.reader.targetId?{targetId:"other"}:{})}})} as unknown as NativeSessionClient,environment);
  await assert.rejects(runtime.readerPlayback(value.reader),/content_context_changed/);
 }
 assert.notDeepEqual(nativePlaybackQueryKey(value.reader),nativePlaybackQueryKey({...value.reader,sourceLanguage:"en"}));
 assert.notDeepEqual(nativePlaybackQueryKey(value.reader),nativePlaybackQueryKey({...value.reader,targetId:"other"}));
});

import {NativeReadAloudOutput,type NativeAudioTarget} from "../src/lib/native/audioOutput";
import type {NativeAudioBridge,NativeAudioCommand} from "../src/lib/native/audioBridge";
function outputFixture(){
 const client=new NativeSessionClient("https://example.invalid",saved().store,async()=>reply({ok:true}));
 const value=nativePlaybackSchema.parse(fixture("nl","chapters"));
 let listener:(value:unknown)=>void=()=>{},epoch=1,foreground=true,owner=crypto.randomUUID();
 const commands:NativeAudioCommand[]=[],forgotten:string[]=[];let loads=0;
 const bridge:NativeAudioBridge={audioSession:async()=>{},audioContext:async options=>{if(options.forget)forgotten.push(options.ownerId);},audioStatus:async()=>({enabled:true,anchored:true,foreground,ownerId:owner,contextEpoch:epoch,validForMs:120000,readerHash:value.audio.readerHash}),audioVoices:async()=>({voices:[]}),audioCommand:async command=>{commands.push(command);},addListener:async(_event,callback)=>{listener=callback;return {remove:async()=>{listener=()=>{};}};}};
 const output=new NativeReadAloudOutput(client,bridge,true);output.subscribe(()=>{});
 const target:NativeAudioTarget={ownerId:owner,sessionStamp:client.getSessionStamp(),scope:value.audio,sourceLanguage:"nl",current:()=>true,load:async()=>{loads++;return value;}};
 output.bind(target);
 const source={id:"chapter",title:"Synthetisch hoofdstuk",language:"nl",verses:value.reader.verses,native:{ownerId:owner,contextEpoch:epoch,readerHash:value.audio.readerHash,voiceId:"nl-local"}};
 return {client,output,target,source,commands,forgotten,get loads(){return loads;},emit:(value:unknown)=>listener(value),foreground:(active:boolean,next=++epoch)=>{foreground=active;epoch=next;listener({lifecycle:true,active,contextEpoch:epoch});},setOwner:(value:string)=>{owner=value;}};
}
test("native uitvoer verwerpt oude account-/route-eigenaars vóór de gedeelde interface titels toont",async()=>{
 const f=outputFixture();assert.equal(f.output.accepts(f.source),true);
 const fresh={...f.target,ownerId:crypto.randomUUID()};f.setOwner(fresh.ownerId);f.output.bind(fresh);
 assert.equal(f.output.accepts(f.source),false);await assert.rejects(f.output.start(f.source,0,1,crypto.randomUUID()),/audio_changed/);
 assert.equal(f.commands.length,0);
});
test("native callbacks zijn begrensd door command-ID en actiesequentie; snel verswisselen heeft geen oude uitkomst",async()=>{
 const f=outputFixture(),events:unknown[]=[],off=f.output.subscribe(event=>events.push(event));await new Promise(resolve=>setImmediate(resolve));
 const commandId=crypto.randomUUID();await f.output.start(f.source,0,1,commandId);await f.output.control("seek",1,1,commandId);
 const event={commandId,actionVersion:1,index:0,playing:true,stopped:false,failed:false};f.emit(event);assert.equal(events.length,0);
 f.emit({...event,commandId:crypto.randomUUID(),actionVersion:2});assert.equal(events.length,0);
 f.emit({...event,actionVersion:2,index:1});assert.equal(events.length,1);
 await f.output.stop();f.emit({...event,actionVersion:3});assert.equal(events.length,2);assert.deepEqual(f.forgotten,[f.target.ownerId]);off();
});
test("achtergrond stopt lokale UI en oude callbacks; een nieuwe voorgrondstatus herstelt zonder automatisch spelen",async()=>{
 const f=outputFixture(),events:{stopped?:boolean}[]=[],off=f.output.subscribe(event=>events.push(event));await new Promise(resolve=>setImmediate(resolve));
 const id=crypto.randomUUID();await f.output.start(f.source,0,1,id);f.foreground(false);assert.equal(events.at(-1)?.stopped,true);
 await assert.rejects(f.output.start(f.source,0,1,crypto.randomUUID()),/audio_backgrounded/);assert.equal(f.commands.length,1);
 f.foreground(true);assert.equal(f.commands.length,1);
 await f.output.start(f.source,1,2,crypto.randomUUID());assert.equal(f.commands.length,2);
 f.emit({lifecycle:true,active:false,contextEpoch:0});await f.output.control("speed",1,1.5,f.commands.at(-1)!.commandId);assert.equal(f.commands.at(-1)!.speed,1.5);off();
});
test("logout wist uitvoer-eigenaar synchroon, ook met een vertraagde nieuwe autorisatie",async()=>{
 const f=outputFixture(),gate=deferred<ReturnType<NativeAudioBridge["audioStatus"]> extends Promise<infer T>?T:never>();
 f.output.bridge.audioStatus=()=>gate.promise;
 const id=crypto.randomUUID(),pending=f.output.start(f.source,0,1,id);await f.client.logout();
 assert.equal(f.output.accepts(f.source),false);
 gate.resolve({enabled:true,anchored:true,foreground:true,contextEpoch:1,validForMs:120000,ownerId:f.target.ownerId,readerHash:f.source.native.readerHash});
 await assert.rejects(pending,/audio_changed/);assert.equal(f.commands.length,0);
});

import {loadNativeAudioMetadata} from "../src/lib/native/audioOutput";
test("hervatten na verworpen native anchor vernieuwt uitsluitend bestaande read-autorisatie eenmaal",async()=>{
 const f=outputFixture(),calls:boolean[]=[];let statuses=0;
 f.output.bridge.audioStatus=async()=>({enabled:true,anchored:++statuses>1,foreground:true,contextEpoch:1,validForMs:statuses>1?120000:0,ownerId:f.target.ownerId,...(statuses>1?{readerHash:f.source.native.readerHash}:{})});
 const result=await loadNativeAudioMetadata(f.output.bridge,f.target,async renew=>{calls.push(renew);return nativePlaybackSchema.parse(fixture("nl","chapters"));});
 assert.deepEqual(calls,[false,true]);assert.equal(result.status.readerHash,f.source.native.readerHash);
});
test("achtergrond en accountwissel tijdens metadataherstel starten geen extra refresh of stemmenaanvraag",async()=>{
 for(const background of [true,false]){
  const f=outputFixture(),calls:boolean[]=[];let voices=0,current=true;
  f.target.current=()=>current;f.output.bridge.audioVoices=async()=>{voices++;return {voices:[]};};
  f.output.bridge.audioStatus=async()=>({enabled:true,anchored:false,foreground:!background,contextEpoch:1,validForMs:0,ownerId:f.target.ownerId});
  await assert.rejects(loadNativeAudioMetadata(f.output.bridge,f.target,async renew=>{calls.push(renew);if(!background)current=false;return nativePlaybackSchema.parse(fixture("nl","chapters"));}),/audio_(changed|unavailable)/);
  assert.deepEqual(calls,[false]);assert.equal(voices,0);
 }
});

test("een ontbrekende native eventkoppeling kan nooit audio zonder werkende bediening starten",async()=>{
 const f=outputFixture();f.output.bridge.addListener=async()=>{throw Error("synthetic event bridge failure");};
 const output=new NativeReadAloudOutput(f.client,f.output.bridge,true);output.subscribe(()=>{});output.bind(f.target);
 await assert.rejects(output.start(f.source,0,1,crypto.randomUUID()),/synthetic event bridge failure/);assert.equal(f.commands.length,0);
});

test("expliciete retry herstelt een mislukte lokale eventkoppeling zonder losse of dubbele speler",async()=>{
 const f=outputFixture();await new Promise(resolve=>setImmediate(resolve));let attempts=0;
 const original=f.output.bridge.addListener;f.output.bridge.addListener=async(...args)=>{if(++attempts===1)throw Error("synthetic event failure");return original(...args);};
 const output=new NativeReadAloudOutput(f.client,f.output.bridge,true);output.subscribe(()=>{});output.bind(f.target);
 await assert.rejects(output.start(f.source,0,1,crypto.randomUUID()));assert.equal(f.commands.length,0);
 await output.start(f.source,0,1,crypto.randomUUID());assert.equal(f.commands.length,1);assert.equal(attempts,2);
});

test("een opdrachtloze toestelonderbreking annuleert ook een nog voorbereide audiostart",async()=>{
 const f=outputFixture(),gate=deferred<Awaited<ReturnType<NativeAudioBridge["audioStatus"]>>>();
 f.output.bridge.audioStatus=()=>gate.promise;
 const pending=f.output.start(f.source,0,1,crypto.randomUUID());await new Promise(resolve=>setImmediate(resolve));
 f.emit({interruption:true,contextEpoch:2});
 gate.resolve({enabled:true,anchored:true,foreground:true,contextEpoch:2,validForMs:120000,ownerId:f.target.ownerId,readerHash:f.source.native.readerHash});
 await assert.rejects(pending,/audio_changed/);assert.equal(f.commands.length,0);
});
