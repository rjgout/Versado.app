import {NativeReadAloudOutput} from "../../src/lib/native/audioOutput";
import type {NativeAudioBridge} from "../../src/lib/native/audioBridge";
import {useTestMaterial} from "./native-material-client";
// Browserharnas met hetzelfde lokale entrypoint en dezelfde echte sessieclient.
import {useCallback,useState} from "react";
import {createRoot} from "react-dom/client";
import {I18nProvider} from "../../src/components/I18nProvider";
import {messagesFor} from "../../src/lib/i18n";
import {toLanguageCode} from "../../src/lib/languages";
import NativeFoundation from "../../src/components/native/NativeFoundation";
import NativeNavigationProvider from "../../src/components/native/NativeNavigationProvider";
import {NativeSessionClient} from "../../src/lib/native/client";
declare const TEST_GAME_BACKEND:string;
const storage="/test-keychain/device";
let readerHash:string|undefined,ownerId:string|undefined,contextEpoch=0;
const callbacks=new Set<(value:unknown)=>void>();
const evidence={starts:0,stops:0};Object.assign(window,{gameAudioEvidence:evidence});
const client=new NativeSessionClient(TEST_GAME_BACKEND,{
 async read(){return(await(await fetch(storage)).json()).value;},
 async write(value){const response=await fetch(storage,{method:"PUT",body:value});if(!response.ok)throw Error("synthetic_storage_failure");},
 async clear(){await fetch(storage,{method:"DELETE"});},
},async(input,init)=>{
 const url=new URL(String(input)),response=await fetch(url.pathname+url.search,init);
 if(url.pathname.endsWith("/audio/playback")&&response.ok){const metadata=await response.clone().json();readerHash=metadata.audio?.readerHash;}
 return response;
});
// Alleen de OS-decoder is gesimuleerd. Readertekst, lease, bronrechten en
// sessies komen uit de echte geïsoleerde backend; geen echte toestelacceptatie.
const bridge:NativeAudioBridge={
 async audioSession(){ownerId=undefined;readerHash=undefined;contextEpoch++;},
 async audioContext(value){if(value.forget){if(ownerId===value.ownerId){ownerId=undefined;contextEpoch++;evidence.stops++;}}else if(ownerId!==value.ownerId){ownerId=value.ownerId;contextEpoch++;}},
 async audioStatus(){return {enabled:true,anchored:true,foreground:true,contextEpoch,validForMs:240000,...(readerHash?{readerHash}:{}),...(ownerId?{ownerId}:{})};},
 async audioVoices(){return {voices:["nl","en","de","fr","es"].map(language=>({id:"synthetic-"+language,name:"Synthetic device voice",language,local:true as const}))};},
 async audioCommand(command){
  if(command.ownerId!==ownerId||command.readerHash!==readerHash)throw Error("synthetic_audio_context_changed");
  const index=command.index??0,playing=command.action!=="pause";
  if(command.action==="start")evidence.starts++;
  const event={commandId:command.commandId,actionVersion:command.actionVersion,index,playing,stopped:false,failed:false};
  for(const callback of callbacks)callback(event);
  if(command.action==="start")setTimeout(()=>{if(ownerId===command.ownerId)for(const callback of callbacks)callback({...event,playing:false,stopped:true});},200);
 },
 async addListener(_name,callback){callbacks.add(callback);return {async remove(){callbacks.delete(callback);}};},
};
const output=new NativeReadAloudOutput(client,bridge,true);
function Root(){
 useTestMaterial();
 const[language,setLanguage]=useState(toLanguageCode(navigator.language));
 const change=useCallback((value:string)=>{const code=toLanguageCode(value);document.documentElement.lang=code;setLanguage(code);},[]);
 return <I18nProvider language={language} messages={messagesFor(language)}><NativeNavigationProvider><NativeFoundation audioOutput={output} client={client} onLanguage={change}/></NativeNavigationProvider></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Root/>);
