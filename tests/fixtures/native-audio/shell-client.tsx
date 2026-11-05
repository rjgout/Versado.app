// Browserbewijs gebruikt echte React-presentatie en uitvoeradapter; uitsluitend
// de OS-decoder en transportresponses zijn gesimuleerd. Geen toestelbewijs.

import {createRoot} from "react-dom/client";
import {I18nProvider} from "../../../src/components/I18nProvider";
import {messagesFor} from "../../../src/lib/i18n";
import {toLanguageCode} from "../../../src/lib/languages";
import {NativeSessionClient,type NativeSessionRequestInit} from "../../../src/lib/native/client";
import {NativeAudioSessionGate} from "../../../src/lib/native/audioSessionGate";
import {NativeReadAloudOutput} from "../../../src/lib/native/audioOutput";
import type {NativeAudioBridge} from "../../../src/lib/native/audioBridge";
import NativeFoundation from "../../../src/components/native/NativeFoundation";
import NativeNavigationProvider from "../../../src/components/native/NativeNavigationProvider";
import type {NativeReader} from "../../../src/lib/native/readerContract";
const query=new URLSearchParams(location.search),language=toLanguageCode(query.get("language")),tts=query.get("mode")==="tts";
const reader:NativeReader={version:1,userId:"user",activeCollectionId:"collection",selectionVersion:3,language,courseId:"course",kind:query.get("kind")==="steps"?"steps":"chapters",targetId:"target",chapterId:"chapter",startVerse:2,endVerse:3,sourceLanguage:language,collectionName:"Synthetic",bookName:"Synthetic",chapterNumber:1,focusVerse:2,verses:[{id:"v2",number:2,text:"Synthetische tekst voor de gedeelde lezer."},{id:"v3",number:3,text:"Dit vers schrijft geen voortgang door audio."}]};
const recording={id:"b".repeat(64),kind:"recording",language,audioChapterId:"chapter",collectionId:"collection",sha256:"c".repeat(64),byteSize:481114,start:7,end:21,verses:[{number:2,start:7,end:14},{number:3,start:14,end:21}]};
const playback={version:1,reader,audio:{...reader,sessionId:"session",readerHash:"a".repeat(64),sourceLanguage:language,serverTime:Date.now(),maxAgeMs:300000,sources:tts?[]:[recording]}};
for(const key of ["collectionName","bookName","chapterNumber","focusVerse","verses"])delete (playback.audio as unknown as Record<string,unknown>)[key];
const evidence={commands:[] as import("../../../src/lib/native/audioBridge").NativeAudioCommand[],active:false,stops:0,listeners:0,postRoutes:[] as string[]};Object.assign(window,{audioEvidence:evidence});
let statusCalls=0,currentIndex=0,userId="user";
let saved:string|null=null,ownerId:string|undefined,contextEpoch=1,callback:(value:unknown)=>void=()=>{};
const edition={id:"collection",slug:"collection",name:"Synthetische schriftbron",icon:"book",order:0,visibleToUsers:true,work:"bofm",editionKey:"synthetic",language,sourceName:null,sourceUrl:null,licenseName:null,licenseUrl:null,selectable:true,previewHref:null};
const content={version:1,userId:"user",switcherEnabled:true,picker:{activeCollectionId:"collection",selectionVersion:3,selection:{activeContentCollectionId:"collection",contentLanguage:language},works:[{key:"bofm",kind:"SCRIPTURE",editions:[edition]}]}};
const scope={version:1,userId:"user",activeCollectionId:"collection",selectionVersion:3,language,courseId:"course",kind:reader.kind,targetId:"target",chapterId:"chapter",startVerse:2,endVerse:3};
const path={version:1,userId:"user",activeCollectionId:"collection",selectionVersion:3,language,kind:"chapters",courseId:"course",courseName:"Synthetische cursus",unitPlural:"Hoofdstukken",sequential:false,chapters:[],todayId:null,todayMinutes:0,todayXp:0,defaultOpenBook:null};
const client=new NativeSessionClient("https://example.invalid",{read:async()=>saved,write:async raw=>{saved=raw;},clear:async()=>{saved=null;}},async(url,init)=>{
 await audioGate.beforeRequest((init as NativeSessionRequestInit).nativeSessionStamp);
 const route=new URL(String(url)).pathname.replace("/api/v1/native/","");
 if(init?.method==="POST")evidence.postRoutes.push(route);
 const answer=route==="capabilities"?{apiVersion:1,apple:false,registration:true,features:["content-picker-v1","courses-overview-v1","scripture-reader-v1","scripture-annotations-v1","scripture-audio-v1"]}
 :["login","refresh"].includes(route)?{accessToken:"synthetic",refreshToken:"synthetic",expiresIn:300}
 :route==="me"?{id:userId,handle:"Audiolezer",uiLanguage:language,onboardingRequired:false,appleLinked:false,passwordLoginEnabled:true}
 :route==="today"?{activity:null,selectionVersion:3}:route==="content-context"?content
 :route==="courses/course"?path:route.endsWith("/audio/playback")?playback
 :route.includes("/annotations")?{...scope,annotations:[],complete:true}
 :route.includes("/read/")?reader:route==="logout"?{ok:true}:null;
 if(!answer)throw Error("Onverwacht testcontract: "+route);
 return new Response(JSON.stringify(answer),{headers:{"Content-Type":"application/json"}});
},false);
const bridge:NativeAudioBridge={audioSession:async()=>{ownerId=undefined;contextEpoch++;evidence.active=false;evidence.stops++;},audioContext:async input=>{if(input.forget){if(ownerId===input.ownerId){ownerId=undefined;evidence.active=false;evidence.stops++;}}else if(ownerId!==input.ownerId){ownerId=input.ownerId;contextEpoch++;}},audioStatus:async()=>{statusCalls++;if(query.get("hold")==="1"&&statusCalls===2)await new Promise<void>(resolve=>Object.assign(window,{releaseAudio:resolve}));return {enabled:true,anchored:true,foreground:true,contextEpoch,validForMs:240000,readerHash:"a".repeat(64),ownerId};},audioVoices:async()=>({voices:query.get("voices")==="none"?[]:[{id:language+"-local",name:language.toUpperCase()+" device voice",language:language+"-"+language.toUpperCase(),local:true}]}),audioCommand:async command=>{evidence.commands.push(command);if(command.index!==undefined)currentIndex=command.index;evidence.active=command.action!=="pause";callback({commandId:command.commandId,actionVersion:command.actionVersion,index:currentIndex,playing:evidence.active,stopped:false,failed:false});},addListener:async(_name,listener)=>{evidence.listeners++;callback=listener;return {remove:async()=>{evidence.listeners--;callback=()=>{};}};}};
const audioGate=new NativeAudioSessionGate(bridge);audioGate.attach(client);
const output=new NativeReadAloudOutput(client,bridge,true);
Object.assign(window,{audioTest:{
 event:(value:unknown)=>callback(value),
 end:()=>{const command=evidence.commands.at(-1)!;evidence.active=false;callback({commandId:command.commandId,actionVersion:command.actionVersion,index:0,playing:false,stopped:false,failed:false});},
 background:()=>{evidence.active=false;callback({lifecycle:true,active:false,contextEpoch});},
 foreground:()=>callback({lifecycle:true,active:true,contextEpoch}),
 nextAccount:async()=>{await client.logout();userId="second-user";reader.userId=userId;playback.audio.userId=userId;content.userId=userId;scope.userId=userId;path.userId=userId;await client.login("second","synthetic");window.dispatchEvent(new Event("online"));},
 sourceChange:()=>{content.picker.selectionVersion++;reader.selectionVersion++;playback.audio.selectionVersion++;scope.selectionVersion++;path.selectionVersion++;window.dispatchEvent(new Event("online"));},
}});
void client.login("synthetic","synthetic").then(()=>createRoot(document.getElementById("root")!).render(<I18nProvider language={language} messages={messagesFor(language)}><NativeNavigationProvider><NativeFoundation client={client} audioOutput={output}/></NativeNavigationProvider></I18nProvider>));
