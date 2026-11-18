// Browserbewijs gebruikt echte React-presentatie en uitvoeradapter; uitsluitend
// de OS-decoder en transportresponses zijn gesimuleerd. Geen toestelbewijs.
import {useState,useRef} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider} from "../../../src/components/I18nProvider";
import {messagesFor} from "../../../src/lib/i18n";
import {toLanguageCode} from "../../../src/lib/languages";
import {NativeSessionClient} from "../../../src/lib/native/client";
import {NativeReadAloudOutput} from "../../../src/lib/native/audioOutput";
import type {NativeAudioBridge} from "../../../src/lib/native/audioBridge";
import {ReadAloudPlayerProvider,useReadAloudPlayer} from "../../../src/lib/readAloudPlayerContext";
import {NativeDataProvider} from "../../../src/lib/data/nativeHooks";
import NativeReadAloudPlayer from "../../../src/components/native/NativeReadAloudPlayer";
import ReadAloudPlayer from "../../../src/components/ReadAloudPlayer";
import type {ReadAloudControl} from "../../../src/components/ReadAloudPlayer";
import ReadAloudMiniPlayer from "../../../src/components/ReadAloudMiniPlayer";
import ScriptureReaderView from "../../../src/components/reading/ScriptureReaderView";
import {useNativeReaderPosition} from "../../../src/components/native/useNativeReaderPosition";
import type {NativeReader} from "../../../src/lib/native/readerContract";
const query=new URLSearchParams(location.search),language=toLanguageCode(query.get("language")),native=query.get("platform")!=="web",tts=query.get("mode")==="tts";
const reader:NativeReader={version:1,userId:"user",activeCollectionId:"collection",selectionVersion:3,language,courseId:"course",kind:query.get("kind")==="steps"?"steps":"chapters",targetId:"target",chapterId:"chapter",startVerse:2,endVerse:3,sourceLanguage:language,collectionName:"Synthetic",bookName:"Synthetic",chapterNumber:1,focusVerse:2,verses:[{id:"v2",number:2,text:"Synthetische tekst voor de gedeelde lezer."},{id:"v3",number:3,text:"Dit vers schrijft geen voortgang door audio."}]};
const recording={id:"b".repeat(64),kind:"recording",language,audioChapterId:"chapter",collectionId:"collection",sha256:"c".repeat(64),byteSize:481114,start:7,end:21,verses:[{number:2,start:7,end:14},{number:3,start:14,end:21}]};
const playback={version:1,reader,audio:{...reader,sessionId:"session",readerHash:"a".repeat(64),sourceLanguage:language,serverTime:Date.now(),maxAgeMs:300000,sources:tts?[]:[recording]}};
for(const key of ["collectionName","bookName","chapterNumber","focusVerse","verses"])delete (playback.audio as unknown as Record<string,unknown>)[key];
const evidence={commands:[] as unknown[],positionWrites:0,postRoutes:[] as string[]};Object.assign(window,{audioEvidence:evidence});
let statusCalls=0;
let saved:string|null=null,ownerId:string|undefined,contextEpoch=1,callback:(value:unknown)=>void=()=>{};
const client=new NativeSessionClient("https://example.invalid",{read:async()=>saved,write:async raw=>{saved=raw;},clear:async()=>{saved=null;}},async(url,init)=>{if(init?.method==="POST")evidence.postRoutes.push(String(url));return new Response(JSON.stringify(String(url).endsWith("login")?{accessToken:"synthetic",refreshToken:"synthetic",expiresIn:300}:playback),{headers:{"Content-Type":"application/json"}});});
const bridge:NativeAudioBridge={audioSession:async()=>{},audioContext:async input=>{if(input.forget){if(ownerId===input.ownerId)ownerId=undefined;}else if(ownerId!==input.ownerId){ownerId=input.ownerId;contextEpoch++;}},audioStatus:async()=>{statusCalls++;if(query.get("hold")==="1"&&statusCalls===2)await new Promise<void>(resolve=>Object.assign(window,{releaseAudio:resolve}));return {enabled:true,anchored:true,foreground:true,contextEpoch,validForMs:240000,readerHash:"a".repeat(64),ownerId};},audioVoices:async()=>({voices:query.get("voices")==="none"?[]:[{id:language+"-local",name:language.toUpperCase()+" device voice",language:language+"-"+language.toUpperCase(),local:true}]}),audioCommand:async command=>{evidence.commands.push(command);callback({commandId:command.commandId,actionVersion:command.actionVersion,index:command.index??0,playing:command.action!=="pause",stopped:false,failed:false});},addListener:async(_name,listener)=>{callback=listener;return {remove:async()=>{callback=()=>{};}};}};
const output=new NativeReadAloudOutput(client,bridge,true);
function Reader(){const player=useReadAloudPlayer(),control=useRef<ReadAloudControl|null>(null),[,setStatus]=useState("loading");useNativeReaderPosition(reader,0,true,async()=>{evidence.positionWrites++;return {version:1};},()=>{});return <><header data-sticky-header><ReadAloudMiniPlayer/></header><main className="mx-auto max-w-3xl p-4 text-vs-fg bg-vs-bg"><ScriptureReaderView bookName={reader.bookName} chapterNumber={reader.chapterNumber} verses={reader.verses} focus readingVerse={player.source?.verses[player.currentIndex]?.number} followReadingVerse={false} beforeVerses={native?<NativeReadAloudPlayer reader={reader} controlRef={control} onStatusChange={setStatus}/>:<ReadAloudPlayer sourceId="chapter" title="Synthetic 1" verses={reader.verses} language={language}/>}/></main></>;}
void client.login("synthetic","synthetic").then(()=>createRoot(document.getElementById("root")!).render(<I18nProvider language={language} messages={messagesFor(language)}><NativeDataProvider client={client}><ReadAloudPlayerProvider output={native?output:undefined}><Reader/></ReadAloudPlayerProvider></NativeDataProvider></I18nProvider>));
