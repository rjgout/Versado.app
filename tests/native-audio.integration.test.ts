import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import pg from "pg";
import { markAudioCurrent } from "../src/lib/audioCheck";
import { prisma } from "../src/lib/db";
import { seedNativeCourses } from "./fixtures/native-courses";
import { issueNativeSession,nativeSessionIdentity } from "../src/lib/native/sessions";
import { nativeReaderAudio,streamNativeReaderAudio } from "../src/lib/native/audio.server";
import { nativeAudioCatalogue,NATIVE_AUDIO_CHUNK_BYTES } from "../src/lib/native/audioContract";
import { chapterSourceHash,sha256,type AudioManifest } from "../src/lib/audio/contract";
import { importAudioPackage,publishAudio } from "../src/lib/audio/library";
import { createSessionToken,SESSION_COOKIE } from "../src/lib/auth";
const database=new URL(process.env.NATIVE_TEST_DATABASE_URL??"http://invalid"),base=process.env.NATIVE_TEST_BASE_URL!,root=process.env.AUDIO_TEST_ROOT!,exec=promisify(execFile);
if(database.hostname!=="127.0.0.1"||database.pathname!=="/versado_content_access_test"||database.href!==process.env.DATABASE_URL||!root||root!==process.env.AUDIO_DIR||!root.startsWith("/tmp/versado-native-audio-"))throw Error("Uitsluitend eigen wegwerpdatabase en audiomap");
let bytes:Buffer,duration:number,admin:{id:string;isAdmin:boolean;sessionVersion:number};
const fixtures:Awaited<ReturnType<typeof seedNativeCourses>>[]=[];
before(async()=>{
 bytes=await fs.readFile("tests/fixtures/native-audio/synthetic.mp3");
 duration=Number((await exec("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1","tests/fixtures/native-audio/synthetic.mp3"])).stdout.trim());
 admin=await prisma.user.create({data:{email:`${randomUUID()}@native-audio.invalid`,handle:"AudioAdmin"+randomUUID().slice(0,5),discriminator:"01",passwordHash:"unused",isAdmin:true}});
});
after(async()=>{
 try{for(const f of fixtures)await prisma.contentCollection.update({where:{id:f.collection.id},data:{enabled:false}});}
 finally{await prisma.$disconnect();const shared=globalThis as typeof globalThis&{__versadoAuthBudget?:Promise<{disconnect():void}>};await shared.__versadoAuthBudget?.then(client=>client.disconnect()).catch(()=>{});}
});
async function fixture(language="nl"){
 const f=await seedNativeCourses(language);fixtures.push(f);const user=await f.account(language),pair=await issueNativeSession(user.id,user.sessionVersion);return {f,user,pair};
}
function route(f:Awaited<ReturnType<typeof seedNativeCourses>>,course=f.steps){return `courses/${course.id}/read/${course.type==="READING_LESSONS"?"steps":"chapters"}/${course.type==="READING_LESSONS"?f.steps.lessons[1].id:f.chapters[1].id}`;}
function request(token:string|undefined,p:string,method="GET",headers:Record<string,string>={}){return fetch(base+"/api/v1/native/"+p,{method,headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1",...(token?{Authorization:`Bearer ${token}`} : {}),...headers}});}
async function catalogue(token:string,p:string){const r=await request(token,p+"/audio");assert.equal(r.status,200,await r.clone().text());return nativeAudioCatalogue.parse(await r.json());}
async function recording(chapterId:string,publish=true){
 const ch=await prisma.chapter.findUniqueOrThrow({where:{id:chapterId},include:{book:{include:{contentCollection:true}},verses:{orderBy:{number:"asc"}}}}),c=ch.book.contentCollection;
 const name="native-audio-"+randomUUID(),folder=path.join(root,"incoming",name);await fs.mkdir(folder,{recursive:true});
 const segments=Buffer.from(JSON.stringify({schemaVersion:1,segments:ch.verses.map((v,i)=>({id:v.id,kind:"VERSE",sourceHash:sha256(v.text),start:i*7,end:i===ch.verses.length-1?duration:(i+1)*7}))}));
 const manifest:AudioManifest={schemaVersion:1,packageId:name,collectionId:c.id,work:"bofm",editionKey:c.editionKey,language:c.language as "nl",target:{kind:"CHAPTER",bookKey:ch.book.key!,chapterNumber:ch.number},sourceHash:chapterSourceHash(ch),sourceKind:"GENERATED",source:{name:"Eigen synthetische sinus",checkedAt:new Date().toISOString(),rights:"Uitsluitend testfixture, geen externe bron"},voice:{name:"geen stem: synthetische sinus"},audio:{file:"audio.mp3",sha256:sha256(bytes),bytes:bytes.length,duration,format:"mp3"},segments:{file:"segments.json",sha256:sha256(segments)},quality:"VALIDATED"};
 await fs.writeFile(path.join(folder,"audio.mp3"),bytes);await fs.writeFile(path.join(folder,"segments.json"),segments);await fs.writeFile(path.join(folder,"manifest.json"),JSON.stringify(manifest));await fs.writeFile(path.join(folder,"READY"),"1\n");
 const receipt=await importAudioPackage(folder);assert.equal(receipt.status,"READY",receipt.errorCode??"");const item=await prisma.audioRecording.findUniqueOrThrow({where:{packageId:name}});if(publish)await publishAudio(admin,item.id,0);return item;
}
async function legacy(chapterId:string){const name="native-legacy-"+randomUUID()+".mp3";await fs.writeFile(path.join(root,name),bytes);await prisma.chapter.update({where:{id:chapterId},data:{audioUrl:"https://assets.churchofjesuschrist.org/"+name}});for(let n=1;n<=4;n++)await prisma.verse.updateMany({where:{chapterId,number:n},data:{audioStart:(n-1)*7}});await markAudioCurrent(prisma,chapterId);return name;}
async function audioState(){
 const result=[];
 for(const name of ["Chapter","Verse","ChapterAudioCheck","AudioPackage","AudioRecording","AudioPublication"]){
  result.push(await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) hash FROM "${name}" t`));
 }return result;
}
async function state(userId:string){
 const tables=await prisma.$queryRaw<{table_name:string}[]>`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='userId' ORDER BY table_name`;
 const rows=[];for(const {table_name:name}of tables){assert.match(name,/^[A-Za-z0-9_]+$/);rows.push(await prisma.$queryRawUnsafe(`SELECT md5(coalesce(string_agg(to_jsonb(t)::text,E'\\n' ORDER BY to_jsonb(t)::text),'')) hash FROM "${name}" t WHERE "userId"=$1`,userId));}
 return {user:await prisma.user.findUnique({where:{id:userId}}),rows};
}

test("read-only: drie leesmethoden en vijf talen gebruiken bestaande publicaties en exacte stapgrenzen",async()=>{
 for(const language of ["nl","en","de","fr","es"]){const {f,user,pair}=await fixture(language);await recording(f.chapters[1].id);const before=await state(user.id),beforeAudio=await audioState();
  for(const course of f.courses){const p=route(f,course),c=await catalogue(pair.accessToken,p);assert.equal(c.sourceLanguage,language);assert.equal(c.sources.length,1);const source=c.sources[0];assert.equal(source.language,language);assert.equal(source.start,0);assert.equal(source.end,course.type==="READING_LESSONS"?14:duration);assert.equal(source.verses.length,course.type==="READING_LESSONS"?2:4);
   const stream=await request(pair.accessToken,p+`/audio/${source.id}/stream`,"GET",{Range:"bytes=0-999"});assert.equal(stream.status,206);assert.equal(stream.headers.get("content-range"),`bytes 0-999/${bytes.length}`);assert.deepEqual(Buffer.from(await stream.arrayBuffer()),bytes.subarray(0,1000));
  }assert.deepEqual(await state(user.id),before,"GET/audio verandert geen READ, XP, reeks, cursus-/leespositie of oefensessies");assert.deepEqual(await audioState(),beforeAudio,"GET registreert, publiceert of herstelt geen audio/tekstcontroles");
 }
});
test("twee onafhankelijke Node-processen gebruiken dezelfde bronidentiteit zonder gedeelde geheugencache",async()=>{
 const {f,user,pair}=await fixture();await recording(f.chapters[1].id);const source=(await catalogue(pair.accessToken,route(f))).sources[0],before=await state(user.id);
 const input={token:pair.accessToken,courseId:f.steps.id,targetId:f.steps.lessons[1].id,sourceId:source.id};
 const results=await Promise.all([0,1].map(async()=>{
  const {stdout}=await exec(process.execPath,["--import","tsx","tests/fixtures/native-audio/stream-worker.ts"],{env:{...process.env,NATIVE_AUDIO_WORKER_INPUT:JSON.stringify(input)},timeout:30000,maxBuffer:65536});return JSON.parse(stdout);
 }));
 for(const result of results)assert.deepEqual(result,{status:206,bytes:1000,sha256:sha256(bytes.subarray(0,1000))});
 assert.deepEqual(await state(user.id),before);
});
test("onbekend, ongepubliceerd, verkeerde uitgavefamilie en ontbrekende mirror zijn geen audiobron",async()=>{
 const {f,pair}=await fixture();await recording(f.chapters[1].id,false);assert.deepEqual((await catalogue(pair.accessToken,route(f))).sources,[]);
 const name=await legacy(f.chapters[1].id);const local=(await catalogue(pair.accessToken,route(f))).sources[0];assert.equal(local.kind,"legacy");assert.equal(local.end,14);
 await fs.unlink(path.join(root,name));assert.deepEqual((await catalogue(pair.accessToken,route(f))).sources,[]);
 const other=await seedNativeCourses("en");fixtures.push(other);await prisma.book.update({where:{id:other.book.id},data:{key:f.book.key}});await recording(other.chapters[1].id);
 assert.deepEqual((await catalogue(pair.accessToken,route(f))).sources,[],"een andere editionKey is geen impliciete vertaling");
});
test("dezelfde uitgavefamilie toont alleen toegankelijke talen; standaard blijft de teksttaal",async()=>{
 const {f,pair}=await fixture();await recording(f.chapters[1].id);
 const en=await seedNativeCourses("en");fixtures.push(en);await prisma.contentCollection.update({where:{id:en.collection.id},data:{editionKey:f.collection.editionKey}});await recording(en.chapters[1].id);
 let c=await catalogue(pair.accessToken,route(f));assert.equal(c.sourceLanguage,"nl");assert.deepEqual(c.sources.map(s=>s.language),["nl","en"]);
 await prisma.contentCollection.update({where:{id:en.collection.id},data:{visibleToUsers:false}});c=await catalogue(pair.accessToken,route(f));assert.deepEqual(c.sources.map(s=>s.language),["nl"]);
});
test("legacy zonder bewezen stap-eindgrens en gewijzigde tekst worden niet aangeboden",async()=>{
 const {f,pair}=await fixture();await legacy(f.chapters[1].id);await prisma.verse.updateMany({where:{chapterId:f.chapters[1].id,number:3},data:{audioStart:null}});
 assert.deepEqual((await catalogue(pair.accessToken,route(f))).sources,[]);
 await recording(f.chapters[1].id);assert.equal((await catalogue(pair.accessToken,route(f))).sources.length,1);
 await prisma.verse.updateMany({where:{chapterId:f.chapters[1].id,number:1},data:{text:"Gewijzigde tekst zonder nieuwe audio"}});
 assert.deepEqual((await catalogue(pair.accessToken,route(f))).sources,[],"geen vrije legacyterugval na bronhashwijziging");
});
test("exacte Range/HEAD/416-contracten, geen onbegrensde download of MP3 in JSON",async()=>{
 const {f,pair}=await fixture();await recording(f.chapters[1].id);const p=route(f),c=await catalogue(pair.accessToken,p),source=c.sources[0],stream=p+`/audio/${source.id}/stream`;
 const head=await request(pair.accessToken,stream,"HEAD");assert.equal(head.status,200);assert.equal(head.headers.get("content-length"),String(bytes.length));assert.equal((await head.arrayBuffer()).byteLength,0);
 const tail=await request(pair.accessToken,stream,"GET",{Range:`bytes=${bytes.length-3}-${bytes.length+5}`});assert.equal(tail.status,206);assert.deepEqual(Buffer.from(await tail.arrayBuffer()),bytes.subarray(-3));
 for(const value of [undefined,"bytes=0-","bytes=-9","bytes=0-1,4-8",`bytes=0-${NATIVE_AUDIO_CHUNK_BYTES}`,`bytes=${bytes.length}-`]){const r=await request(pair.accessToken,stream,"GET",value?{Range:value}:{});assert.equal(r.status,416,String(value));assert.equal(r.headers.get("content-range"),`bytes */${bytes.length}`);assert.equal((await r.arrayBuffer()).byteLength,0);}
 for(const suffix of ["?url=https://evil.invalid","/other"]){const r=await request(pair.accessToken,stream+suffix);assert.ok([400,404].includes(r.status));}
 const dto=JSON.stringify(c);assert.doesNotMatch(dto,/https?:|\.mp3|Bearer|authorization|client.?secret|base64/i);
});
test("403/401/cookie-only, verkeerde cursus en andere sessie/account kunnen geen audiobytes krijgen",async()=>{
 const {f,user,pair}=await fixture();await recording(f.chapters[1].id);const p=route(f),source=(await catalogue(pair.accessToken,p)).sources[0],url=p+`/audio/${source.id}/stream`,headers={Range:"bytes=0-10"};
 assert.equal((await request(undefined,url,"GET",{...headers,Cookie:`${SESSION_COOKIE}=${await createSessionToken(user.id)}`})).status,401);
 assert.equal((await request(pair.accessToken,url,"GET",{...headers,Origin:"https://evil.invalid"})).status,403);
 const second=await issueNativeSession(user.id,user.sessionVersion);assert.equal((await request(second.accessToken,url,"GET",headers)).status,404);
 const other=await fixture();assert.equal((await request(other.pair.accessToken,url,"GET",headers)).status,404);
 assert.equal((await request(pair.accessToken,url.replace(f.steps.id,"unknown"),"GET",headers)).status,404);
 const identity=await nativeSessionIdentity(pair.accessToken);await prisma.nativeSession.update({where:{id:identity.binding.sessionId},data:{revokedAt:new Date()}});
 assert.equal((await request(pair.accessToken,url,"GET",headers)).status,401);
});
test("intrekking, bron-ABA en publicatiewissel maken een oude bronidentiteit onbruikbaar",async()=>{
 for(const mode of ["source","publication","rights"]){const {f,user,pair}=await fixture();await recording(f.chapters[1].id);const p=route(f),source=(await catalogue(pair.accessToken,p)).sources[0];
  if(mode==="source"){await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:null}});await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:f.collection.id}});}
  else if(mode==="publication")await prisma.audioPublication.update({where:{targetKey:`chapter:${f.chapters[1].id}`},data:{version:{increment:1}}});
  else await prisma.contentCollection.update({where:{id:f.collection.id},data:{visibleToUsers:false}});
  const r=await request(pair.accessToken,p+`/audio/${source.id}/stream`,"GET",{Range:"bytes=0-100"});assert.ok([401,404,409].includes(r.status),String(r.status));assert.equal(r.headers.get("content-type")?.startsWith("audio/"),false);
 }
});
test("beschadiging tussen catalogus en stream wordt ondanks gelijkblijvende lengte/mtime geweigerd",async()=>{
 const {f,pair}=await fixture();const name=await legacy(f.chapters[1].id);const p=route(f),source=(await catalogue(pair.accessToken,p)).sources[0],file=path.join(root,name),stat=await fs.stat(file),corrupt=Buffer.from(bytes);corrupt[100]^=1;await fs.writeFile(file,corrupt);await fs.utimes(file,stat.atime,stat.mtime);
 const r=await request(pair.accessToken,p+`/audio/${source.id}/stream`,"GET",{Range:"bytes=0-99"});assert.equal(r.status,404);assert.equal(r.headers.get("content-type")?.startsWith("audio/"),false);
});
test("lopende body stopt bij sessie-/bronintrekking vóór de volgende chunk",async()=>{
 for(const mode of ["session","source","publication"]){const {f,user,pair}=await fixture();await recording(f.chapters[1].id);const identity=await nativeSessionIdentity(pair.accessToken),p=route(f),source=(await catalogue(pair.accessToken,p)).sources[0];
  // Eigen service instantie heeft nog geen prepared source: dezelfde ID moet
  // net als op een tweede server opnieuw berekend kunnen worden.
  const response=await streamNativeReaderAudio(identity.binding,f.steps.id,"steps",f.steps.lessons[1].id,source.id,"bytes=0-262143",true,pair.accessToken);
  const reader=response.body!.getReader(),first=await reader.read();assert.ok(first.value?.byteLength);
  if(mode==="session")await prisma.nativeSession.update({where:{id:identity.binding.sessionId},data:{revokedAt:new Date()}});
  else if(mode==="source")await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:null}});
  else await prisma.audioPublication.update({where:{targetKey:`chapter:${f.chapters[1].id}`},data:{version:{increment:1}}});
  await assert.rejects(reader.read(),/session_expired|content_context_changed|content_unavailable/);
 }
});
test("laat catalogusantwoord na sessie-intrekking geeft geen bron terug",async()=>{
 const {f,pair}=await fixture();const recordingRow=await recording(f.chapters[1].id),identity=await nativeSessionIdentity(pair.accessToken),sql=new pg.Client({connectionString:database.href});await sql.connect();
 let locked=false,renamed=false,view=false,pending:Promise<Response>|undefined;
 try{
  const cols=(await sql.query("SELECT column_name FROM information_schema.columns WHERE table_name='AudioRecording' AND table_schema='public' ORDER BY ordinal_position")).rows.map(r=>{assert.match(r.column_name,/^[A-Za-z0-9_]+$/);return r.column_name==="sourceHash"?'native_audio_read(a."sourceHash") AS "sourceHash"':`a."${r.column_name}"`;});
  await sql.query("CREATE FUNCTION native_audio_read(value text) RETURNS text LANGUAGE plpgsql STABLE AS $$ BEGIN PERFORM pg_advisory_xact_lock(765432117); RETURN value; END $$");
  await sql.query('ALTER TABLE "AudioRecording" RENAME TO "NativeAudioTestRecording"');renamed=true;await sql.query(`CREATE VIEW "AudioRecording" AS SELECT ${cols.join(',')} FROM "NativeAudioTestRecording" a`);view=true;
  await sql.query('SELECT pg_advisory_lock(765432117)');locked=true;pending=request(pair.accessToken,route(f)+"/audio");
  let waiting=false;for(let i=0;i<100;i++){if((await sql.query("SELECT 1 FROM pg_stat_activity WHERE wait_event='advisory' AND pid<>pg_backend_pid() AND query LIKE '%AudioRecording%' LIMIT 1")).rows.length){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}assert.ok(waiting,recordingRow.id);
  await prisma.nativeSession.update({where:{id:identity.binding.sessionId},data:{revokedAt:new Date()}});await sql.query('SELECT pg_advisory_unlock(765432117)');locked=false;
  const response=await pending;assert.ok([401,409].includes(response.status),await response.clone().text());assert.equal('sources' in await response.json(),false);
 }finally{
  if(locked)await sql.query('SELECT pg_advisory_unlock(765432117)');await pending?.catch(()=>{});if(view)await sql.query('DROP VIEW "AudioRecording"');if(renamed)await sql.query('ALTER TABLE "NativeAudioTestRecording" RENAME TO "AudioRecording"');await sql.query('DROP FUNCTION IF EXISTS native_audio_read(text)');await sql.end();
 }
});

test("140 gelijktijdige catalogi blijven geldig wanneer de globale broncache wordt geëvict",async()=>{
 const {f,user}=await fixture();await recording(f.chapters[1].id);
 const pairs=await Promise.all(Array.from({length:140},()=>issueNativeSession(user.id,user.sessionVersion)));
 const identities=await Promise.all(pairs.map(pair=>nativeSessionIdentity(pair.accessToken))),before=await state(user.id);
 const catalogues=await Promise.all(identities.map(({binding})=>nativeReaderAudio(binding,f.steps.id,"steps",f.steps.lessons[1].id)));
 assert.equal(catalogues.length,140);assert.equal(new Set(catalogues.map(c=>c.sessionId)).size,140);
 for(const c of catalogues)assert.equal(c.sources.length,1);
 assert.deepEqual(await state(user.id),before);
});

test("een tekstwijziging verandert ook de identiteit van onveranderde audio in een andere taal",async()=>{
 const {f,pair}=await fixture();await recording(f.chapters[1].id);
 const en=await seedNativeCourses("en");fixtures.push(en);await prisma.contentCollection.update({where:{id:en.collection.id},data:{editionKey:f.collection.editionKey}});await recording(en.chapters[1].id);
 const p=route(f),before=await catalogue(pair.accessToken,p),old=before.sources.find(s=>s.language==="en")!;
 await prisma.verse.updateMany({where:{chapterId:f.chapters[1].id,number:1},data:{text:"Bijgewerkte Nederlandse tekst"}});
 const after=await catalogue(pair.accessToken,p),current=after.sources.find(s=>s.language==="en")!;
 assert.notEqual(after.readerHash,before.readerHash);assert.notEqual(current.id,old.id);assert.equal(current.sha256,old.sha256);
 const response=await request(pair.accessToken,p+`/audio/${old.id}/stream`,"GET",{Range:"bytes=0-99"});assert.ok([404,409].includes(response.status));
});

test("legacy-audio vereist bestaande actuele tekstcontrole; GET maakt die controle nooit zelf aan",async()=>{
 const {f,pair}=await fixture();await legacy(f.chapters[1].id);const p=route(f);assert.equal((await catalogue(pair.accessToken,p)).sources.length,1);
 await prisma.chapterAudioCheck.delete({where:{chapterId:f.chapters[1].id}});
 assert.deepEqual((await catalogue(pair.accessToken,p)).sources,[]);assert.equal(await prisma.chapterAudioCheck.count({where:{chapterId:f.chapters[1].id}}),0);
 await markAudioCurrent(prisma,f.chapters[1].id);await prisma.verse.updateMany({where:{chapterId:f.chapters[1].id,number:1},data:{text:"Andere tekst zonder audiocontrole"}});
 assert.deepEqual((await catalogue(pair.accessToken,p)).sources,[]);
});
