import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { officialSources,pilotSources } from "../src/lib/audio/officialCatalogue";
import { downloadOfficial,validateOfficialPage,type OfficialNetwork } from "../src/lib/audio/officialDownload";
import { officialPage } from "./fixtures/audio/official-source";
test("catalogus bewaart vijf Ether 1-pilots, 205 beschermde hoofdstukken en 19 reviewgevallen",()=>{
 assert.equal(pilotSources.length,5);assert.equal(new Set(pilotSources.map(s=>s.language)).size,5);
 assert.equal(officialSources.filter(s=>s.legacyProtected).length,205);
 assert.equal(officialSources.filter(s=>s.quality!=="VALIDATED").length,19);
 assert.equal(pilotSources.reduce((n,s)=>n+s.bytes,0),15175461);
 assert.ok(pilotSources.every(s=>s.verses===43&&!s.legacyProtected&&s.quality==="VALIDATED"));
});
test("dezelfde parser bewijst vijf taalidentiteiten, teksthashes en bronstemmen",()=>{
 for(const source of pilotSources)assert.doesNotThrow(()=>validateOfficialPage(Buffer.from(JSON.stringify(officialPage(source))),source));
});
test("verkeerde taal, passage, tekst, kop en stem worden geweigerd",()=>{
 const source=pilotSources[0];
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
 const url=pilotSources[0].pageUrl;
 assert.deepEqual(await downloadOfficial(url,new AbortController().signal,network(Buffer.from("{}"))),Buffer.from("{}"));
 await assert.rejects(downloadOfficial(url,new AbortController().signal,network(Buffer.alloc(2*1024*1024+1))),/SOURCE_SIZE/);
 await assert.rejects(downloadOfficial(url,new AbortController().signal,network(Buffer.from("{}"),200,{"content-length":"3"})),/SOURCE_SIZE/);
 await assert.rejects(downloadOfficial(url,new AbortController().signal,network(Buffer.from("{}"),503)),/SOURCE_HTTP/);
});
test("SSRF: privé-DNS en ongeoorloofde redirect worden vóór transport geweigerd",async()=>{
 let calls=0;
 await assert.rejects(downloadOfficial(pilotSources[0].pageUrl,new AbortController().signal,{resolve:async()=>[{address:"127.0.0.1",family:4}],transport:async()=>{calls++;throw Error();}}),/SOURCE_ADDRESS/);assert.equal(calls,0);
 await assert.rejects(downloadOfficial(pilotSources[0].pageUrl,new AbortController().signal,network(Buffer.alloc(0),302,{location:"http://127.0.0.1/"})));
 await assert.rejects(downloadOfficial("https://www.churchofjesuschrist.org@evil.invalid/file",new AbortController().signal,network(Buffer.from("{}"))));
});
test("download overschrijft nooit een bestaand bestand, ook niet bij correcte lengte",async()=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),"official-no-overwrite-")),file=path.join(root,"audio.mp3");
 try{await fs.writeFile(file,"existing");await assert.rejects(downloadOfficial(pilotSources[0].url,new AbortController().signal,network(Buffer.from("ID3test"),200,{"content-type":"audio/mpeg"}),file,7));assert.equal(await fs.readFile(file,"utf8"),"existing");}finally{await fs.rm(root,{recursive:true});}
});
test("hangende DNS en responsebody kunnen worden afgebroken zonder een open response achter te laten",async()=>{
 const a=new AbortController(),pending=downloadOfficial(pilotSources[0].pageUrl,a.signal,{resolve:()=>new Promise(()=>{})});a.abort();await assert.rejects(pending);
 let closed=false;const b=new AbortController();
 const request=downloadOfficial(pilotSources[0].pageUrl,b.signal,{resolve:resolver,transport:async()=>({status:200,headers:{"content-type":"application/json"},body:{[Symbol.asyncIterator]:()=>({next:()=>new Promise(()=>{})})},close:()=>{closed=true;}})});
 setTimeout(()=>b.abort(),10);await assert.rejects(request);assert.equal(closed,true);
});
