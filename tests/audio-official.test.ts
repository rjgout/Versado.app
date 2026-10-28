import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { officialSources } from "../src/lib/audio/officialCatalogue";
import {sampleSources} from "./fixtures/audio/official-source";
import { downloadOfficial,validateOfficialPage,type OfficialNetwork } from "../src/lib/audio/officialDownload";
import { officialPage } from "./fixtures/audio/official-source";
test("catalogus bewaart 205 beschermde hoofdstukken, 19 reviewgevallen en vijf representatieve bronnen",()=>{
 assert.equal(sampleSources.length,5);assert.equal(new Set(sampleSources.map(s=>s.language)).size,5);
 assert.equal(officialSources.filter(s=>s.legacyProtected).length,205);
 assert.equal(officialSources.filter(s=>s.quality!=="VALIDATED").length,19);
 assert.equal(sampleSources.reduce((n,s)=>n+s.bytes,0),15175461);
 assert.ok(sampleSources.every(s=>s.verses===43&&!s.legacyProtected&&s.quality==="VALIDATED"));
});
test("dezelfde parser bewijst vijf taalidentiteiten, teksthashes en bronstemmen",()=>{
 for(const source of sampleSources)assert.doesNotThrow(()=>validateOfficialPage(Buffer.from(JSON.stringify(officialPage(source))),source));
});
test("verkeerde taal, passage, tekst, kop en stem worden geweigerd",()=>{
 const source=sampleSources[0];
 for(const mutate of [
  (p:ReturnType<typeof officialPage>)=>{p.meta.pageAttributes["data-bcp47-lang"]="xx";},
  (p:ReturnType<typeof officialPage>)=>{p.meta.pageAttributes["data-uri"]="/scriptures/bofm/ether/2";},
  (p:ReturnType<typeof officialPage>)=>{p.content.body=p.content.body.replace('class="verse"','class="wrong"');},
  (p:ReturnType<typeof officialPage>)=>{p.content.body=p.content.body.replace('class="study-summary"','class="wrong"');},
  (p:ReturnType<typeof officialPage>)=>{p.meta.audio[0].variant="wrong";},
  (p:ReturnType<typeof officialPage>)=>{p.meta.audio[0].mediaUrl="https://evil.invalid/audio.mp3";},
 ]){const page=officialPage(source);mutate(page);assert.throws(()=>validateOfficialPage(Buffer.from(JSON.stringify(page)),source));}
});
const resolver:OfficialNetwork["resolve"]=async()=>[{address:"8.8.8.8",family:4}];
function network(body:Buffer,status=200,headers:Record<string,string>={}):OfficialNetwork{return{resolve:resolver,transport:async()=>({status,headers:{"content-type":"application/json","content-length":String(body.length),...headers},body:(async function*(){yield body;})(),close:()=>{}})};}
test("bron-JSON heeft een harde bytegrens en volledige responslengte",async()=>{
 const url=sampleSources[0].pageUrl;
 assert.deepEqual(await downloadOfficial(url,new AbortController().signal,network(Buffer.from("{}"))),Buffer.from("{}"));
 await assert.rejects(downloadOfficial(url,new AbortController().signal,network(Buffer.alloc(2*1024*1024+1))),/SOURCE_SIZE/);
 await assert.rejects(downloadOfficial(url,new AbortController().signal,network(Buffer.from("{}"),200,{"content-length":"3"})),/SOURCE_SIZE/);
 await assert.rejects(downloadOfficial(url,new AbortController().signal,network(Buffer.from("{}"),503)),/SOURCE_HTTP/);
});
test("SSRF: privé-DNS en ongeoorloofde redirect worden vóór transport geweigerd",async()=>{
 let calls=0;
 await assert.rejects(downloadOfficial(sampleSources[0].pageUrl,new AbortController().signal,{resolve:async()=>[{address:"127.0.0.1",family:4}],transport:async()=>{calls++;throw Error();}}),/SOURCE_ADDRESS/);assert.equal(calls,0);
 await assert.rejects(downloadOfficial(sampleSources[0].pageUrl,new AbortController().signal,network(Buffer.alloc(0),302,{location:"http://127.0.0.1/"})));
 await assert.rejects(downloadOfficial("https://www.churchofjesuschrist.org@evil.invalid/file",new AbortController().signal,network(Buffer.from("{}"))));
});
test("download overschrijft nooit een bestaand bestand, ook niet bij correcte lengte",async()=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),"official-no-overwrite-")),file=path.join(root,"audio.mp3");
 try{await fs.writeFile(file,"existing");await assert.rejects(downloadOfficial(sampleSources[0].url,new AbortController().signal,network(Buffer.from("ID3test"),200,{"content-type":"audio/mpeg"}),file,7));assert.equal(await fs.readFile(file,"utf8"),"existing");}finally{await fs.rm(root,{recursive:true});}
});
test("hangende DNS en responsebody kunnen worden afgebroken zonder een open response achter te laten",async()=>{
 const a=new AbortController(),pending=downloadOfficial(sampleSources[0].pageUrl,a.signal,{resolve:()=>new Promise(()=>{})});a.abort();await assert.rejects(pending);
 let closed=false;const b=new AbortController();
 const request=downloadOfficial(sampleSources[0].pageUrl,b.signal,{resolve:resolver,transport:async()=>({status:200,headers:{"content-type":"application/json"},body:{[Symbol.asyncIterator]:()=>({next:()=>new Promise(()=>{})})},close:()=>{closed=true;}})});
 setTimeout(()=>b.abort(),10);await assert.rejects(request);assert.equal(closed,true);
});

test("alle echte taalgroepen passen zonder verlies in HTTP-batches van maximaal twintig",async()=>{
 const {officialBatches,OFFICIAL_BATCH_SIZE}=await import("../src/lib/audio/officialControls");
 assert.equal(OFFICIAL_BATCH_SIZE,20);
 for(const language of ["nl","en","de","fr","es"]) {
  const selected=officialSources.filter(s=>s.work==="bofm"&&s.language===language&&!s.legacyProtected&&s.quality==="VALIDATED");
  const batches=officialBatches(selected);
  assert.deepEqual(batches.flat(),selected);assert.ok(batches.every(b=>b.length>0&&b.length<=20));
  assert.ok(batches.every(b=>Buffer.byteLength(JSON.stringify({action:"download",ids:b.map(s=>s.id)}))<32768));
 }
 assert.equal(officialBatches(officialSources.filter(s=>s.work==="bofm"&&s.language==="en")).length,24);
});

test("herstel onderscheidt mislukte en verlaten taken van levende workers en import-backoff",async()=>{
 const {officialTaskRecoverable}=await import("../src/lib/audio/officialControls");
 const now=new Date("2026-10-27T12:00:00Z"),old=new Date(now.getTime()-180000),fresh=new Date(now.getTime()-1000),future=new Date(now.getTime()+60000);
 for(const status of ["RUNNING","QUEUED"]){
  assert.equal(officialTaskRecoverable({status,leaseUntil:future,updatedAt:old},now),false);
  assert.equal(officialTaskRecoverable({status,leaseUntil:null,updatedAt:old},now),true);
 }
 assert.equal(officialTaskRecoverable({status:"QUEUED",leaseUntil:null,updatedAt:fresh},now),false);
 assert.equal(officialTaskRecoverable({status:"FAILED",leaseUntil:null,updatedAt:fresh},now),true);
 for(const status of ["REGISTERED","VALIDATED"])assert.equal(officialTaskRecoverable({status,leaseUntil:null,updatedAt:old},now),false);
});

test("conversie heeft precies drie vaste lengtes en kan gewone bescherming of review niet opheffen",async()=>{
 const {LEGACY_PILOT_IDS,legacySources,assertLegacySource}=await import("../src/lib/audio/legacyConversion");
 assert.equal(legacySources.length,205);assert.equal(legacySources.filter(s=>s.quality!=="VALIDATED").length,1);
 const samples=LEGACY_PILOT_IDS.map(id=>legacySources.find(s=>s.id===id)!);
 assert.deepEqual(samples.map(s=>s.verses),[6,26,77]);assert.ok(samples[0].duration<90&&samples[2].duration>1200);
 for(const source of samples){assert.doesNotThrow(()=>assertLegacySource(source));for(const changed of [{...source,legacyProtected:false},{...source,language:"en"},{...source,work:"pgp"},{...source,quality:"NEEDS_REVIEW"},{...source,id:"f".repeat(64)}])assert.throws(()=>assertLegacySource(changed),/SOURCE_PROTECTED/);}
});
