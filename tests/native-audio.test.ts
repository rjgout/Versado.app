import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { NATIVE_AUDIO_CHUNK_BYTES,nativeAudioRange,nativeAudioCatalogue,nativeAudioSource } from "../src/lib/native/audioContract";
import { nativeAudioFileIdentity,verifyNativeAudioFile } from "../src/lib/native/audioFile.server";
import { streamAudio } from "../src/lib/audio/stream";
import { accessRouteAllowed } from "../src/lib/native/access";
const hash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const source={id:"a".repeat(64),kind:"legacy",language:"nl",audioChapterId:"audio-chapter",collectionId:"audio-collection",sha256:"b".repeat(64),byteSize:100,start:0,end:2,verses:[{number:1,start:0,end:1},{number:2,start:1,end:2}]};
async function fixture(run:(file:string,bytes:Buffer,folder:string)=>Promise<void>){const folder=await fs.mkdtemp(path.join(tmpdir(),"native-audio-unit-")),file=path.join(folder,"tone.mp3"),bytes=Buffer.concat([Buffer.from("ID3"),Buffer.alloc(512*1024,42)]);try{await fs.writeFile(file,bytes);await run(file,bytes,folder);}finally{await fs.rm(folder,{recursive:true,force:true});}}

test("catalogus houdt bestaande reader-/sessie-identiteit, exacte taal en grenzen; nooit URLs/credentials",()=>{
 const catalogue={version:1,userId:"user",sessionId:"session",readerHash:"c".repeat(64),serverTime:1770000000000,maxAgeMs:300000,activeCollectionId:"collection",selectionVersion:2,language:"nl",sourceLanguage:"nl",courseId:"course",kind:"steps",targetId:"step",chapterId:"chapter",startVerse:1,endVerse:2,sources:[source]};
 assert.ok(nativeAudioCatalogue.safeParse(catalogue).success);
 for(const language of ["nl","en","de","fr","es"])assert.ok(nativeAudioSource.safeParse({...source,language}).success);
 for(const extra of [{url:"https://dev.versado.app/audio"},{authorization:"Bearer x"},{secret:"x"},{start:3},{end:0},{verses:[{number:3,start:0,end:2}]}])assert.equal(nativeAudioCatalogue.safeParse({...catalogue,sources:[{...source,...extra}]}).success,false);
 assert.equal(nativeAudioCatalogue.safeParse({...catalogue,sources:[source,source]}).success,false);
 assert.ok(nativeAudioCatalogue.safeParse({...catalogue,sources:[]}).success,"geen opname is geen verkeerde-taal-terugval");
 assert.ok(nativeAudioSource.safeParse({...source,end:null,verses:[{number:1,start:0,end:1},{number:2,start:1,end:null}]}).success);
 assert.equal(nativeAudioSource.safeParse({...source,verses:[{number:1,start:0,end:null},{number:2,start:1,end:2}]}).success,false);
});
test("native ranges zijn eindig, enkelvoudig en maximaal 256 KiB",()=>{
 assert.deepEqual(nativeAudioRange("bytes=0-0"),{start:0,end:0});assert.ok(nativeAudioRange(`bytes=0-${NATIVE_AUDIO_CHUNK_BYTES-1}`));
 for(const value of [null,"bytes=0-","bytes=-20","bytes=2-1","bytes=00-1","bytes=0-1,2-3","bytes=0-1\n",`bytes=0-${NATIVE_AUDIO_CHUNK_BYTES}`,"bytes=9007199254740992-9007199254740992","bytes=1.0-2"])assert.equal(nativeAudioRange(value),null,String(value));
});
test("de JSON-brug laat alleen de catalogus toe, geen binair pad of brede mediaproxy",()=>{
 for(const kind of ["steps","chapters"]){const p=`courses/c/read/${kind}/t/audio`;assert.ok(accessRouteAllowed(p,"GET"));for(const suffix of ["/","?url=x",`/${"a".repeat(64)}/stream`])for(const method of ["GET","HEAD","POST"])assert.equal(accessRouteAllowed(p+suffix,method),false);}
 const api=readFileSync("src/lib/native/api.ts","utf8");assert.match(api.match(/features: \[[^\n]+/)![0],/"scripture-audio-v1"/);
 assert.ok(readFileSync("src/components/native/NativeFoundation.tsx","utf8").includes('audioEnabled={!!audioOutput?.enabled&&features.includes("scripture-audio-v1")}'));
 for(const file of ["ios/App/App/VersadoNativePlugin.swift","android/app/src/main/java/app/versado/app/VersadoNativePlugin.java"])assert.doesNotMatch(readFileSync(file,"utf8"),/audioPrepare|audioPlay|audioCredentials/);
});
test("integriteitscache merkt zelfde-lengte wijziging op, ook wanneer mtime wordt teruggezet",async()=>fixture(async(file,bytes)=>{
 const proof=await nativeAudioFileIdentity(file);assert.deepEqual(proof,{sha256:hash(bytes),byteSize:bytes.length});const stat=await fs.stat(file);
 const corrupt=Buffer.from(bytes);corrupt[100]^=1;await fs.writeFile(file,corrupt);await fs.utimes(file,stat.atime,stat.mtime);
 await assert.rejects(nativeAudioFileIdentity(file,proof),/AUDIO_UNAVAILABLE/);
}));
test("alleen reguliere MP3-objecten, geen symlink, leeg of HTML-bestand",async()=>fixture(async(file,_bytes,folder)=>{
 const link=path.join(folder,"link.mp3");await fs.symlink(file,link);await assert.rejects(nativeAudioFileIdentity(link));
 for(const bytes of [Buffer.alloc(0),Buffer.from("<html>HTTP 200</html>")]){await fs.writeFile(file,bytes);await assert.rejects(nativeAudioFileIdentity(file));}
}));
test("dezelfde descriptor wordt gehasht en gestreamd; vervangen pad kan geen bytes verwisselen",async()=>fixture(async(file,bytes,folder)=>{
 const proof=await nativeAudioFileIdentity(file);
 const response=await streamAudio(file,"bytes=0-65535",true,{verify:async handle=>{await verifyNativeAudioFile(handle,proof);},authorize:async()=>{}});
 const other=path.join(folder,"other.mp3");await fs.writeFile(other,Buffer.concat([Buffer.from("ID3"),Buffer.alloc(bytes.length-3,7)]));await fs.rename(other,file);
 assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes.subarray(0,65536));
 await assert.rejects(streamAudio(file,"bytes=0-1",true,{verify:async h=>{await verifyNativeAudioFile(h,proof);},authorize:async()=>{}}));
}));
test("eerste begrensde bytes zijn beschikbaar vóór einde bestand; annuleren sluit de descriptor",async()=>fixture(async(file,bytes)=>{
 const proof=await nativeAudioFileIdentity(file);let descriptor:import("node:fs/promises").FileHandle|undefined;
 const response=await streamAudio(file,`bytes=0-${NATIVE_AUDIO_CHUNK_BYTES-1}`,true,{verify:async h=>{descriptor=h;await verifyNativeAudioFile(h,proof);},authorize:async()=>{}});
 const reader=response.body!.getReader(),first=await reader.read();assert.ok(first.value!.length>0&&first.value!.length<bytes.length);
 await reader.cancel();await assert.rejects(descriptor!.stat(),/closed|EBADF/);
}));
test("intrekking tussen read en aflevering lekt geen chunk; een late streamread faalt dicht",async()=>fixture(async(file)=>{
 const proof=await nativeAudioFileIdentity(file);let checks=0;
 const response=await streamAudio(file,"bytes=0-131071",true,{verify:async h=>{await verifyNativeAudioFile(h,proof);},authorize:async()=>{if(++checks>=3)throw Error("session_expired");}});
 await assert.rejects(response.body!.getReader().read(),/session_expired/);
}));
test("gewijzigde bytes tijdens een lopende stream worden vóór aflevering geweigerd",async()=>fixture(async(file,bytes)=>{
 const proof=await nativeAudioFileIdentity(file);let checks=0;
 const response=await streamAudio(file,"bytes=0-131071",true,{verify:async h=>{await verifyNativeAudioFile(h,proof);},authorize:async()=>{if(++checks===2){const data=Buffer.from(bytes);data[9]^=1;await fs.writeFile(file,data);}}});
 await assert.rejects(response.body!.getReader().read(),/AUDIO_UNAVAILABLE/);
}));
test("bestaand webtransport behoudt 200/206/416, suffixranges en HEAD zonder nieuwe verplichtingen",async()=>fixture(async(file,bytes)=>{
 const full=await streamAudio(file,null,true);assert.equal(full.status,200);assert.deepEqual(Buffer.from(await full.arrayBuffer()),bytes);
 const tail=await streamAudio(file,"bytes=-10",true);assert.equal(tail.status,206);assert.deepEqual(Buffer.from(await tail.arrayBuffer()),bytes.subarray(-10));
 const invalid=await streamAudio(file,`bytes=${bytes.length}-`,true);assert.equal(invalid.status,416);
 const head=await streamAudio(file,null,false);assert.equal(head.status,200);assert.equal(head.body,null);assert.equal(head.headers.get("Content-Length"),String(bytes.length));
}));

test("Android ontdekt uitsluitend toestel-TTS via de exacte servicequery, zonder extra permissies",()=>{
 const manifest=readFileSync("android/app/src/main/AndroidManifest.xml","utf8");
 const queries=manifest.match(/<queries>([\s\S]*?)<\/queries>/)?.[1]??"";
 assert.match(queries,/<action android:name="android\.intent\.action\.TTS_SERVICE"/);
 assert.equal([...queries.matchAll(/<action /g)].length,1);
 assert.equal(queries.includes("<package"),false);
 assert.deepEqual([...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map(match=>match[1]),["android.permission.INTERNET"]);
});
