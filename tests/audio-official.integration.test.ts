import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { execFileSync,spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../src/lib/db";
import { sha256,type AudioManifest } from "../src/lib/audio/contract";
import { pilotSources,officialSources } from "../src/lib/audio/officialCatalogue";
import { requestOfficialAudio as requestProduction,runOfficialAudioTick,officialOverview } from "../src/lib/audio/officialJobs";
import { hasApprovedPilot,assertOfficialPublication } from "../src/lib/audio/officialGuard";
import { publishAudio,importAudioPackage,scanAudioPackages } from "../src/lib/audio/library";
import { officialSeed,officialPage } from "./fixtures/audio/official-source";
import { mockOfficialNetwork,type OfficialMock } from "./fixtures/audio/official-network";
const url=new URL(process.env.AUDIO_TEST_DATABASE_URL??"http://invalid");
if(url.hostname!=="127.0.0.1"||url.pathname!=="/versado_audio_test"||process.env.DATABASE_URL!==url.href)throw Error("Eigen audiorunner vereist");
const root=process.env.AUDIO_TEST_ROOT!,configFile=path.join(root,"official-mock.json");
let config:OfficialMock,actor:{id:string;sessionVersion:number},baseline:unknown;
const ids=pilotSources.map(s=>s.id),prefix="admin-official-";
const requestOfficialAudio=(a:{id:string;sessionVersion:number},action:Parameters<typeof requestProduction>[1],selected:string[])=>requestProduction(a,action,selected,prisma,officialSources.map(s=>config.sources.find(fake=>fake.id===s.id)??s));
async function snapshot(){
 const ordered=<T,>(rows:T[])=>rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 return {
  collections:await prisma.contentCollection.findMany({orderBy:{id:"asc"}}),
  chapters:await prisma.chapter.findMany({orderBy:{id:"asc"},include:{verses:{orderBy:{number:"asc"}},audioCheck:true}}),
  courses:await prisma.course.count(),exercises:await prisma.exercise.count(),
  hints:(await prisma.user.findUniqueOrThrow({where:{id:"audio-before-user"}})).hintBalance,
  actorProgress:await prisma.user.findUniqueOrThrow({where:{id:actor.id},select:{xpTotal:true,currentStreak:true,longestStreak:true,freezeCount:true}}),
  xp:ordered(await prisma.xPTransaction.findMany()),
  streaks:ordered(await prisma.streakActivity.findMany()),
  chapterProgress:ordered(await prisma.chapterProgress.findMany()),
  courseProgress:ordered(await prisma.userCourseProgress.findMany()),
  lessonProgress:ordered(await prisma.userCourseLessonProgress.findMany()),
 };
}
function worker(){const child=spawn(process.execPath,["--import","tsx","tests/fixtures/audio/official-worker.ts",configFile],{env:process.env,stdio:["ignore","pipe","pipe"]});let errors="";child.stderr.on("data",d=>{errors+=d;});const done=new Promise<void>((ok,no)=>{child.on("error",no);child.on("exit",(code,signal)=>code===0||signal==="SIGKILL"?ok():no(Error(errors)));});return {child,done};}
async function tick(){await runOfficialAudioTick(prisma,mockOfficialNetwork(config),config.sources);}
async function audioCalls(){const lines=await fs.readFile(config.logFile,"utf8").then(s=>s.trim().split("\n")).catch(()=>[]);return lines.filter(s=>s in config.audio).length;}
before(async()=>{
 actor=await prisma.user.create({data:{email:"official-admin@audio.invalid",handle:"OfficialAdmin",discriminator:"01",passwordHash:"unused",isAdmin:true}});
 config={sources:[],pages:{},audio:{},logFile:path.join(root,"official-requests.log"),controlFile:path.join(root,"official-controls.json")};
 for(const [index,original]of pilotSources.entries()){
  const seed=officialSeed(original),file=path.join(root,`official-synthetic-${original.language}.mp3`);
  execFileSync("ffmpeg",["-v","error","-f","lavfi","-i",`sine=frequency=${440+index*80}:duration=8`,"-ac","1","-codec:a","libmp3lame",file]);
  const bytes=await fs.readFile(file),duration=Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",file],{encoding:"utf8"}));
  // Vertrouwde testreferentie en gesimuleerde HTTP-bytes; dezelfde validators, geen runtime-/API-testvlag.
  const simulated={...original,sha256:sha256(bytes),bytes:bytes.length,duration,starts:original.starts.map(t=>t/original.duration*duration)};
  config.sources.push(simulated);config.audio[original.url]=file;config.pages[original.pageUrl]=officialPage(original);
  const collection=await prisma.contentCollection.upsert({where:{id:original.collectionId},create:{id:original.collectionId,slug:`official-${original.language}`,name:`Official ${original.language}`,icon:"book",work:"bofm",editionKey:"bofm",language:original.language,enabled:false,visibleToUsers:false,publicationState:"DRAFT"},update:{}});
  let book=await prisma.book.findFirst({where:{contentCollectionId:collection.id,key:"bofm/ether"}});
  if(!book)book=await prisma.book.create({data:{slug:`official-ether-${original.language}`,name:"Ether",key:"bofm/ether",order:13,contentCollectionId:collection.id}});
  if(!await prisma.chapter.findUnique({where:{bookId_number:{bookId:book.id,number:1}}}))await prisma.chapter.create({data:{bookId:book.id,number:1,order:0,heading:seed.heading,verses:{create:seed.verses.map((text,i)=>({number:i+1,text}))}}});
 }
 await fs.writeFile(configFile,JSON.stringify(config));baseline=await snapshot();
});
after(async()=>{await prisma.$disconnect();});
test("beheerstatus leest bestaande registraties/publicaties en maakt geen taak, bestand of content",async()=>{
 const count=await prisma.audioPublication.count(),data=await officialOverview();
 assert.equal(data.pilot.length,5);assert.equal(data.groups.length,15);assert.equal(data.groups.reduce((n,g)=>n+g.review,0),19);assert.equal(data.groups.reduce((n,g)=>n+g.protected,0),205);assert.equal(data.pilotApproved,false);
 assert.equal(await prisma.officialAudioTask.count(),0);assert.equal(await prisma.audioPublication.count(),count);assert.deepEqual(await snapshot(),baseline);
 assert.ok(data.groups.find(g=>g.work==="bofm"&&g.language==="en")!.missingText>0,"catalogus is geen bewijs dat alle teksten lokaal bestaan");
});
test("dubbele opdracht op twee beheerverzoeken claimt exact vijf taken zonder registratie",async()=>{
 await Promise.all([requestOfficialAudio(actor,"download",ids),requestOfficialAudio(actor,"download",ids)]);
 assert.equal(await prisma.officialAudioTask.count({where:{id:{in:ids}}}),5);assert.equal(await prisma.audioPackage.count({where:{id:{startsWith:prefix}}}),0);
 await assert.rejects(fs.access(path.join(root,"official-cache")));
});
test("twee echte Node-workers downloaden elke kandidaat eenmaal; download maakt geen importpakket",async()=>{
 await Promise.all([worker().done,worker().done]);
 assert.equal(await prisma.officialAudioTask.count({where:{id:{in:ids},status:"VALIDATED"}}),5);assert.equal(await audioCalls(),5);
 assert.equal(await prisma.audioPackage.count({where:{id:{startsWith:prefix}}}),0);assert.equal(await prisma.audioRecording.count({where:{packageId:{startsWith:prefix}}}),0);
 await scanAudioPackages();assert.equal(await prisma.audioRecording.count({where:{packageId:{startsWith:prefix}}}),0);
 assert.deepEqual(await snapshot(),baseline);
});
test("onbevoegde beheerder, oude sessionVersion, bulk en te vroege pilotgoedkeuring worden geweigerd",async()=>{
 const ordinary=await prisma.user.create({data:{email:"official-user@audio.invalid",handle:"OfficialUser",discriminator:"01",passwordHash:"unused"}});
 await assert.rejects(requestOfficialAudio(ordinary,"register",ids),/FORBIDDEN/);
 await assert.rejects(requestOfficialAudio({...actor,sessionVersion:actor.sessionVersion+1},"register",ids),/FORBIDDEN/);
 const outside=officialSources.find(s=>!s.pilot&&!s.legacyProtected&&s.quality==="VALIDATED")!;
 await assert.rejects(requestOfficialAudio(actor,"download",[outside.id]),/PILOT_REQUIRED/);
 await assert.rejects(requestOfficialAudio(actor,"approvePilot",[]),/PILOT_REQUIRED/);
});
test("scanner kan een adminpakket zonder expliciet registratiebesluit niet registreren",async()=>{
 const task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:ids[0]}}),source=config.sources.find(s=>s.id===task.id)!,manifest=task.manifest as unknown as AudioManifest;
 const chapter=await prisma.chapter.findFirstOrThrow({where:{number:1,book:{key:"bofm/ether",contentCollectionId:source.collectionId}},include:{verses:{orderBy:{number:"asc"}}}});
 const folder=path.join(root,"incoming",manifest.packageId);await fs.mkdir(folder);
 await fs.link(path.join(root,"official-cache",task.id,"audio.mp3"),path.join(folder,"audio.mp3"));
 await fs.writeFile(path.join(folder,"manifest.json"),JSON.stringify(manifest));
 await fs.writeFile(path.join(folder,"segments.json"),JSON.stringify({schemaVersion:1,segments:chapter.verses.map((v,i)=>({id:v.id,kind:"VERSE",sourceHash:sha256(v.text),start:source.starts[i],end:source.starts[i+1]??source.duration}))}));
 await fs.writeFile(path.join(folder,"quality-report.json"),JSON.stringify({quality:"VALIDATED",sourceHash:source.sourceHash,sha256:source.sha256,starts:source.starts,method:"PINNED_OFFICIAL_ALIGNMENT"}));await fs.writeFile(path.join(folder,"READY"),"1\n");
 assert.equal((await importAudioPackage(folder)).errorCode,"REGISTRATION_NOT_APPROVED");assert.equal(await prisma.audioRecording.count({where:{packageId:manifest.packageId}}),0);
 // Alleen de testklok: laat de bestaande receipt-backoff verlopen in deze wegwerp-DB.
 await prisma.audioPackage.update({where:{id:manifest.packageId},data:{leaseUntil:new Date(0)}});
});
test("rollback en expliciete retry registreren vijf opnamen zonder publicatie of contentwijziging",async()=>{
 await requestOfficialAudio(actor,"register",ids);
 const failed=prefix+ids[1];
 await prisma.$executeRawUnsafe(`CREATE FUNCTION official_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."packageId" = '${failed}' THEN RAISE EXCEPTION 'synthetische fout'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe('CREATE TRIGGER official_fail BEFORE INSERT ON "AudioRecording" FOR EACH ROW EXECUTE FUNCTION official_fail()');
 try{await tick();}finally{await prisma.$executeRawUnsafe('DROP TRIGGER official_fail ON "AudioRecording"');await prisma.$executeRawUnsafe('DROP FUNCTION official_fail()');}
 assert.equal(await prisma.audioRecording.count({where:{packageId:failed}}),0);assert.equal((await prisma.audioPackage.findUniqueOrThrow({where:{id:failed}})).status,"FAILED");
 await prisma.audioPackage.update({where:{id:failed},data:{leaseUntil:new Date(0)}});
 await requestOfficialAudio(actor,"resume",[ids[1]]);await tick();
 assert.equal(await prisma.officialAudioTask.count({where:{id:{in:ids},status:"REGISTERED"}}),5);assert.equal(await prisma.audioRecording.count({where:{packageId:{startsWith:prefix}}}),5);
 assert.equal(await prisma.audioPublication.count({where:{recording:{packageId:{startsWith:prefix}}}}),0);assert.equal(await audioCalls(),5);assert.deepEqual(await snapshot(),baseline);
});
test("verloren antwoord na commit en herhaalde registratie leveren geen tweede opname op",async()=>{
 const original=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:ids[2]}});
 await prisma.officialAudioTask.update({where:{id:ids[2]},data:{status:"FAILED",phase:"REGISTER",recordingId:null,errorCode:"RESPONSE_LOST"}});
 await requestOfficialAudio(actor,"resume",[ids[2]]);await tick();
 assert.equal((await prisma.officialAudioTask.findUniqueOrThrow({where:{id:ids[2]}})).recordingId,original.recordingId);
 assert.equal(await prisma.audioRecording.count({where:{packageId:prefix+ids[2]}}),1);assert.equal(await audioCalls(),5);
});
test("publicatie en pilotacceptatie zijn aparte besluiten; veranderde tekst sluit de bulkgate",async()=>{
 const tasks=await prisma.officialAudioTask.findMany({where:{id:{in:ids}}});
 for(const task of tasks)await publishAudio({...actor,isAdmin:true},task.recordingId!,0);
 assert.equal(await hasApprovedPilot(prisma),false);
 await requestOfficialAudio(actor,"approvePilot",[]);assert.equal(await hasApprovedPilot(prisma),true);
 const first=await prisma.audioRecording.findUniqueOrThrow({where:{id:tasks[0].recordingId!},include:{chapter:{include:{verses:{orderBy:{number:"asc"}}}}}}),verse=first.chapter!.verses[0];
 await prisma.verse.update({where:{id:verse.id},data:{text:verse.text+" gewijzigde testtekst"}});
 assert.equal(await hasApprovedPilot(prisma),false);
 const outside=officialSources.find(s=>!s.pilot&&!s.legacyProtected&&s.quality==="VALIDATED")!;
 await assert.rejects(requestOfficialAudio(actor,"download",[outside.id]),/PILOT_REQUIRED/);
 await prisma.verse.update({where:{id:verse.id},data:{text:verse.text}});
 assert.equal(await hasApprovedPilot(prisma),true);
 const protectedSource=officialSources.find(s=>s.legacyProtected)!;
 await assert.rejects(requestOfficialAudio(actor,"download",[protectedSource.id]),/SOURCE_PROTECTED/);
 assert.deepEqual(await snapshot(),baseline);
});
test("echt procesverlies tijdens download hervat veilig zonder bestaande cache te overschrijven",async()=>{
 const source=config.sources[4],cache=path.join(root,"official-cache",source.id,"audio.mp3");
 const stable=await fs.readFile(cache);await fs.rename(cache,path.join(root,"official-saved-cache.mp3"));
 await fs.rename(path.join(root,"objects",source.sha256+".mp3"),path.join(root,"official-saved-object.mp3"));
 await prisma.officialAudioTask.update({where:{id:source.id},data:{status:"QUEUED",phase:"DOWNLOAD",leaseToken:null,leaseUntil:null}});
 await fs.writeFile(config.controlFile,JSON.stringify({pauseUrl:source.url}));const launched=worker();
 let waiting=false;for(let i=0;i<100;i++){const task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:source.id}});if(task.status==="RUNNING"&&task.bytesDownloaded===1){waiting=true;break;}await delay(50);}
 assert.equal(waiting,true);launched.child.kill("SIGKILL");await launched.done;
 await fs.writeFile(config.controlFile,"{}");await prisma.officialAudioTask.update({where:{id:source.id},data:{leaseUntil:new Date(0)}});
 await worker().done;assert.equal((await prisma.officialAudioTask.findUniqueOrThrow({where:{id:source.id}})).status,"REGISTERED");assert.deepEqual(await fs.readFile(cache),stable);
 assert.equal(await prisma.audioRecording.count({where:{packageId:prefix+source.id}}),1);assert.deepEqual(await snapshot(),baseline);
});
test("foute SHA en verkeerde bronpagina worden niet vastgezet; expliciet hervatten kan de nieuwe cache herstellen",async()=>{
 const source=config.sources[0],cache=path.join(root,"official-cache",source.id,"audio.mp3"),object=path.join(root,"objects",source.sha256+".mp3");
 await fs.rename(cache,path.join(root,"checksum-saved-cache.mp3"));await fs.rename(object,path.join(root,"checksum-saved-object.mp3"));
 await fs.writeFile(config.controlFile,JSON.stringify({corruptUrl:source.url}));await requestOfficialAudio(actor,"download",[source.id]);await tick();
 let task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:source.id}});assert.equal(task.status,"FAILED");assert.equal(task.errorCode,"AUDIO_CHECKSUM");
 await assert.rejects(fs.access(cache));await assert.rejects(fs.access(object));
 const calls=await audioCalls();await fs.writeFile(config.controlFile,JSON.stringify({wrongPage:source.pageUrl}));await requestOfficialAudio(actor,"resume",[source.id]);await tick();
 task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:source.id}});assert.equal(task.errorCode,"SOURCE_IDENTITY");assert.equal(await audioCalls(),calls);
 await fs.writeFile(config.controlFile,"{}");await requestOfficialAudio(actor,"resume",[source.id]);await tick();
 assert.equal((await prisma.officialAudioTask.findUniqueOrThrow({where:{id:source.id}})).status,"REGISTERED");assert.equal(await prisma.audioRecording.count({where:{packageId:prefix+source.id}}),1);assert.deepEqual(await snapshot(),baseline);
});
test("rolintrekking tijdens een vertraagde actie blokkeert commit en publicatie",async()=>{
 const source=config.sources[3],cache=path.join(root,"official-cache",source.id,"audio.mp3"),object=path.join(root,"objects",source.sha256+".mp3");
 await fs.rename(cache,path.join(root,"role-saved-cache.mp3"));await fs.rename(object,path.join(root,"role-saved-object.mp3"));
 await fs.writeFile(config.controlFile,JSON.stringify({pauseUrl:source.url}));await requestOfficialAudio(actor,"download",[source.id]);const launched=worker();
 let paused=false;for(let i=0;i<100;i++){const task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:source.id}});if(task.status==="RUNNING"&&task.bytesDownloaded===1){paused=true;break;}await delay(50);}
 assert.equal(paused,true);await prisma.user.update({where:{id:actor.id},data:{isAdmin:false}});await fs.writeFile(config.controlFile,"{}");await launched.done;
 const task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:source.id}});assert.equal(task.status,"FAILED");assert.equal(task.errorCode,"FORBIDDEN");
 await assert.rejects(requestOfficialAudio(actor,"resume",[source.id]),/FORBIDDEN/);
 await prisma.user.update({where:{id:actor.id},data:{isAdmin:true}});await requestOfficialAudio(actor,"resume",[source.id]);
 assert.equal(await prisma.audioRecording.count({where:{packageId:prefix+source.id}}),1);assert.deepEqual(await snapshot(),baseline);
});
test("tekstwijziging tijdens wachten op de commitlock rolt de registratie terug; scanner omzeilt FAILED niet",async()=>{
 const original=officialSources.find(s=>s.language==="en"&&s.bookKey==="bofm/ether"&&s.chapterNumber===1&&s.voice==="female")!;
 const file=path.join(root,"official-synthetic-en-female.mp3");execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","sine=frequency=900:duration=8","-ac","1","-codec:a","libmp3lame",file]);
 const bytes=await fs.readFile(file),duration=Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",file],{encoding:"utf8"}));
 const source={...original,sha256:sha256(bytes),bytes:bytes.length,duration,starts:original.starts.map(t=>t/original.duration*duration)};
 config.sources.push(source);config.audio[source.url]=file;config.pages[source.pageUrl].meta.audio.push({mediaUrl:source.url,variant:"female"});await fs.writeFile(configFile,JSON.stringify(config));
 await requestOfficialAudio(actor,"download",[source.id]);await tick();await requestOfficialAudio(actor,"register",[source.id]);
 const chapter=await prisma.chapter.findFirstOrThrow({where:{number:1,book:{key:"bofm/ether",contentCollectionId:source.collectionId}},include:{verses:{orderBy:{number:"asc"}}}}),verse=chapter.verses[0];
 let release!:()=>void,held!:()=>void;const gate=new Promise<void>(r=>{release=r;}),acquired=new Promise<void>(r=>{held=r;});
 const holding=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "Chapter" WHERE "id" = ${chapter.id} FOR UPDATE`;await tx.verse.update({where:{id:verse.id},data:{text:verse.text+" gewijzigde testtekst"}});held();await gate;},{timeout:15000});
 await acquired;const launched=worker();let blocked=false;
 try{for(let i=0;i<100;i++){const rows=await prisma.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%FOR SHARE%'`;if(Number(rows[0].count)>0){blocked=true;break;}await delay(50);}assert.equal(blocked,true);}finally{release();await holding;await launched.done;}
 assert.equal(await prisma.audioRecording.count({where:{packageId:prefix+source.id}}),0);
 assert.equal((await prisma.officialAudioTask.findUniqueOrThrow({where:{id:source.id}})).status,"FAILED");assert.equal((await prisma.audioPackage.findUniqueOrThrow({where:{id:prefix+source.id}})).status,"FAILED");
 await prisma.verse.update({where:{id:verse.id},data:{text:verse.text}});await prisma.audioPackage.update({where:{id:prefix+source.id},data:{leaseUntil:new Date(0)}});
 await scanAudioPackages();assert.equal(await prisma.audioRecording.count({where:{packageId:prefix+source.id}}),0);
 assert.deepEqual(await snapshot(),baseline);
});
test("ontbrekende tekst wordt zichtbaar FAILED zonder tekstimport; ontbrekende opslag maakt geen taak",async()=>{
 const missing=officialSources.find(s=>s.language==="en"&&s.bookKey==="bofm/1-ne"&&s.chapterNumber===1&&s.quality==="VALIDATED")!;
 await requestOfficialAudio(actor,"download",[missing.id]);
 const task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:missing.id}});assert.equal(task.status,"FAILED");assert.equal(task.errorCode,"TARGET_MISSING");assert.deepEqual(await snapshot(),baseline);
 const previous=process.env.AUDIO_DIR;
 try{
  process.env.AUDIO_DIR=path.join(root,"missing-volume");const count=await prisma.officialAudioTask.count();
  const status=await officialOverview();assert.equal(status.storageAvailable,false);assert.ok(status.pilot.every(r=>r.blockReason==="STORAGE_UNAVAILABLE"));
  await assert.rejects(requestOfficialAudio(actor,"download",[ids[0]]));assert.equal(await prisma.officialAudioTask.count(),count);
 }finally{process.env.AUDIO_DIR=previous;}
});
test("bestaande geldige officiële opname wordt gekoppeld zonder download, dubbele registratie of publicatie",async()=>{
 const id=ids[0],task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id}}),beforeCalls=await audioCalls(),pointers=await prisma.audioPublication.findMany({orderBy:{targetKey:"asc"}});
 await prisma.officialAudioTask.delete({where:{id}});assert.equal(await hasApprovedPilot(prisma),false);
 await requestOfficialAudio(actor,"download",[id]);const adopted=await prisma.officialAudioTask.findUniqueOrThrow({where:{id}});
 assert.equal(adopted.status,"REGISTERED");assert.equal(adopted.recordingId,task.recordingId);assert.equal(await audioCalls(),beforeCalls);
 assert.equal(await prisma.audioRecording.count({where:{packageId:prefix+id}}),1);assert.deepEqual(await prisma.audioPublication.findMany({orderBy:{targetKey:"asc"}}),pointers);
 await requestOfficialAudio(actor,"approvePilot",[]);assert.equal(await hasApprovedPilot(prisma),true);
});
test("publicatiebescherming kan niet met een andere stemnaam, kwaliteitslabel of bronsoort worden omzeild",async()=>{
 const source=officialSources.find(s=>s.work==="pgp"&&s.language==="de"&&s.quality!=="VALIDATED")!;
 const chapter=await prisma.chapter.findFirstOrThrow({where:{number:source.chapterNumber,book:{key:source.bookKey,contentCollectionId:source.collectionId}}});
 const record=await prisma.audioRecording.findFirstOrThrow({where:{packageId:{startsWith:prefix}}});
 await assert.rejects(prisma.$transaction(tx=>assertOfficialPublication(tx,{...record,chapterId:chapter.id,work:source.work,editionKey:source.editionKey,language:source.language,sourceHash:source.sourceHash,sha256:source.sha256,voice:{name:"renamed"},quality:{status:"VALIDATED"},sourceMetadata:{url:source.url}})),/SOURCE_PROTECTED/);
 const protectedSource=officialSources.find(s=>s.legacyProtected)!,protectedChapter=await prisma.chapter.findFirstOrThrow({where:{number:protectedSource.chapterNumber,book:{key:protectedSource.bookKey,contentCollectionId:protectedSource.collectionId}}});
 await assert.rejects(prisma.$transaction(tx=>assertOfficialPublication(tx,{...record,chapterId:protectedChapter.id,sourceKind:"GENERATED"})),/SOURCE_PROTECTED/);
});

test("volledige Duitse selectie blijft duurzaam bij meer dan 30 seconden voorbereiding",async()=>{
 const selected=officialSources.filter(s=>s.work==="bofm"&&s.language==="de"&&!s.legacyProtected&&s.quality==="VALIDATED"&&!s.pilot).map(s=>s.id);
 assert.equal(selected.length,237);
 await prisma.$executeRawUnsafe("CREATE FUNCTION official_bulk_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.14); RETURN NEW; END $$");
 await prisma.$executeRawUnsafe('CREATE TRIGGER official_bulk_delay BEFORE INSERT ON "OfficialAudioTask" FOR EACH ROW EXECUTE FUNCTION official_bulk_delay()');
 try{
  await requestOfficialAudio(actor,"download",selected);
  assert.equal(await prisma.officialAudioTask.count({where:{id:{in:selected}}}),selected.length);
 }finally{
  await prisma.$executeRawUnsafe('DROP TRIGGER official_bulk_delay ON "OfficialAudioTask"');
  await prisma.$executeRawUnsafe('DROP FUNCTION official_bulk_delay()');
  await prisma.officialAudioTask.deleteMany({where:{id:{in:selected}}});
 }
});

test("volledige vijf taalcollecties: begrensde aanvragen, gelijktijdige voorbereiding, geen dubbele taken of publicaties",async()=>{
 const {BOOK_KEYS_BY_SLUG}=await import("../prisma/bookKeys");
 const {officialBatches}=await import("../src/lib/audio/officialControls");
 const addedBooks:string[]=[],addedChapters:string[]=[],beforeTasks=await prisma.officialAudioTask.findMany(),pointers=await prisma.audioPublication.findMany({orderBy:{targetKey:"asc"}});
 type SeedBook={slug:string;key?:string;name:string;chapters:{number:number;heading?:string;verses:string[]}[]};
 const headings=JSON.parse(await fs.readFile("prisma/bomChapterHeadings.json","utf8")) as [string,number,string][];
 try {
  for(const language of ["nl","en","de","fr","es"]) {
   const collection=pilotSources.find(s=>s.language===language)!.collectionId;
   const books=JSON.parse(await fs.readFile(`prisma/bomContent${language==="nl"?"":"."+language}.json`,"utf8")) as SeedBook[];
   for(const [order,seed]of books.entries()) {
    const key=seed.key??BOOK_KEYS_BY_SLUG[seed.slug];
    let book=await prisma.book.findFirst({where:{contentCollectionId:collection,key}});
    if(!book){book=await prisma.book.create({data:{slug:`bulk-${language}-${order}`,name:seed.name,key,order,contentCollectionId:collection}});addedBooks.push(book.id);}
    const existingChapters=new Set((await prisma.chapter.findMany({where:{bookId:book.id},select:{number:true}})).map(c=>c.number));
    for(const chapter of seed.chapters)if(!existingChapters.has(chapter.number)) {
     const row=await prisma.chapter.create({data:{bookId:book.id,number:chapter.number,order:chapter.number,heading:language==="nl"?headings.find(([slug,n])=>slug===seed.slug&&n===chapter.number)?.[2]??null:chapter.heading??null,verses:{create:chapter.verses.map((text,i)=>({number:i+1,text}))}}});addedChapters.push(row.id);
    }
   }
  }
  const contentBefore=await snapshot();
  const otherAdmin=await prisma.user.create({data:{email:"bulk-other-admin@audio.invalid",handle:"BulkOther",discriminator:"01",passwordHash:"unused",isAdmin:true}});
  const all=officialSources.filter(s=>s.work==="bofm"&&!s.legacyProtected&&s.quality==="VALIDATED"&&!s.pilot);
  for(const language of ["nl","en","de","fr","es"]) {
   const selection=all.filter(s=>s.language===language).map(s=>s.id);
   if(language==="en")assert.equal(selection.length,477,"de oude API-grens van 300 is te klein voor deze echte selectie");
   const batches=officialBatches(selection);assert.ok(batches.every(b=>b.length<=20));
   for(const batch of batches) {
    const results=await Promise.all([requestOfficialAudio(actor,"download",batch),requestOfficialAudio(otherAdmin,"download",batch)]);
    assert.ok(results.every(r=>r.accepted===batch.length));
   }
   assert.equal(await prisma.officialAudioTask.count({where:{id:{in:selection}}}),selection.length);
  }
  assert.deepEqual(await snapshot(),contentBefore);assert.deepEqual(await prisma.audioPublication.findMany({orderBy:{targetKey:"asc"}}),pointers);
  const failures=await prisma.officialAudioTask.findMany({where:{id:{in:all.map(s=>s.id)},status:"FAILED"},select:{id:true,errorCode:true}});
  assert.deepEqual(failures,[],"alle bronhashes zijn tegen de volledige echte tekstuitgaven gecontroleerd");
  const start=performance.now(),overview=await officialOverview();
  console.log(JSON.stringify({fullCatalogueOverviewMs:Math.round(performance.now()-start),rows:overview.groups.reduce((n,g)=>n+g.jobs.length,0),bytes:Buffer.byteLength(JSON.stringify(overview)),pollActiveMs:15000,pollIdleMs:120000,nasMeasured:false}));
 }finally {
  await prisma.officialAudioTask.deleteMany({where:{id:{notIn:beforeTasks.map(t=>t.id)}}});
  for(const task of beforeTasks)await prisma.officialAudioTask.update({where:{id:task.id},data:{actorId:task.actorId,actorSessionVersion:task.actorSessionVersion,status:task.status,phase:task.phase,leaseToken:task.leaseToken,leaseUntil:task.leaseUntil}});
  await prisma.chapter.deleteMany({where:{id:{in:addedChapters}}});await prisma.book.deleteMany({where:{id:{in:addedBooks}}});
 }
 assert.deepEqual(await snapshot(),baseline);
});

test("gedeeltelijke voorbereidingsfout bewaart eerdere commits; retry verwerkt alleen de rest",async()=>{
 const selected=officialSources.filter(s=>s.work==="bofm"&&s.language==="de"&&!s.pilot&&s.quality==="VALIDATED").slice(0,4).map(s=>s.id).sort();
 const failed=selected[2];
 await prisma.$executeRawUnsafe(`CREATE FUNCTION official_partial_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${failed}' THEN RAISE EXCEPTION 'synthetische fout'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe('CREATE TRIGGER official_partial_fail BEFORE INSERT ON "OfficialAudioTask" FOR EACH ROW EXECUTE FUNCTION official_partial_fail()');
 try {
  const result=await requestOfficialAudio(actor,"download",selected);
  assert.equal(result.accepted,2);assert.equal("errorCode" in result&&result.errorCode,"AUDIO_TASK_FAILED");
  assert.equal(await prisma.officialAudioTask.count({where:{id:{in:selected}}}),2);
 }finally {await prisma.$executeRawUnsafe('DROP TRIGGER official_partial_fail ON "OfficialAudioTask"');await prisma.$executeRawUnsafe('DROP FUNCTION official_partial_fail()');}
 await requestOfficialAudio(actor,"download",selected);assert.equal(await prisma.officialAudioTask.count({where:{id:{in:selected}}}),4);
 await prisma.officialAudioTask.deleteMany({where:{id:{in:selected}}});
});

test("bulkpublicatie is expliciet, idempotent en vervangt bij twee beheerders nooit een bestaande pointer",async()=>{
 const {publishOfficialSelection}=await import("../src/lib/audio/officialJobs");
 const catalogue=officialSources.map(s=>config.sources.find(fake=>fake.id===s.id)??s);
 const source=config.sources[1],task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:source.id}}),record=await prisma.audioRecording.findUniqueOrThrow({where:{id:task.recordingId!}});
 const original=await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:record.targetKey}});
 const otherAdmin=await prisma.user.create({data:{email:"publish-other-admin@audio.invalid",handle:"PublishOther",discriminator:"01",passwordHash:"unused",isAdmin:true}});
 // Alleen eigen testfixture: maak het pilotdoel tijdelijk vrij. Daardoor zijn uitsluitend pilotacties toegestaan.
 await prisma.audioPublication.delete({where:{targetKey:record.targetKey}});
 try {
  const selection=[{id:source.id,recordingId:record.id}];
  const results=await Promise.all([publishOfficialSelection({...actor,isAdmin:true},selection,prisma,catalogue),publishOfficialSelection(otherAdmin,selection,prisma,catalogue)]);
  assert.ok(results.every(r=>r.results[0].status==="PUBLISHED"));
  const current=await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:record.targetKey}});
  const retry=await publishOfficialSelection({...actor,isAdmin:true},selection,prisma,catalogue);assert.equal(retry.results[0].status,"PUBLISHED");
  assert.deepEqual(await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:record.targetKey}}),current);
  const alternatePackage=await prisma.audioPackage.create({data:{id:"bulk-alternate",manifestHash:"alternate",leaseToken:"unused",leaseUntil:new Date(),status:"READY"}});
  const alternate=await prisma.audioRecording.create({data:{...Object.fromEntries(Object.entries(record).filter(([key])=>!["id","createdAt","packageId"].includes(key))),packageId:alternatePackage.id}} as Parameters<typeof prisma.audioRecording.create>[0]);
  const conflict=await publishOfficialSelection({...actor,isAdmin:true},[{id:source.id,recordingId:alternate.id}],prisma,catalogue);
  assert.equal(conflict.results[0].errorCode,"PUBLICATION_CONFLICT");assert.deepEqual(await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:record.targetKey}}),current);
  await prisma.audioRecording.delete({where:{id:alternate.id}});await prisma.audioPackage.delete({where:{id:alternatePackage.id}});
  const denied=await publishOfficialSelection({...actor,isAdmin:true,sessionVersion:actor.sessionVersion+1},selection,prisma,catalogue);
  assert.equal(denied.results[0].errorCode,"FORBIDDEN");
  const protectedSource=officialSources.find(s=>s.legacyProtected)!,review=officialSources.find(s=>s.quality!=="VALIDATED")!;
  const blocked=await publishOfficialSelection({...actor,isAdmin:true},[protectedSource,review].map(s=>({id:s.id,recordingId:record.id})),prisma,catalogue);
  assert.ok(blocked.results.every(r=>r.errorCode==="SOURCE_PROTECTED"));
  const partial=await publishOfficialSelection({...actor,isAdmin:true},[selection[0],{id:review.id,recordingId:record.id}],prisma,catalogue);
  assert.deepEqual(partial.results.map(r=>r.status),["PUBLISHED","FAILED"]);
 }finally {await prisma.audioPublication.deleteMany({where:{targetKey:record.targetKey}});await prisma.audioPublication.create({data:original});}
 assert.deepEqual(await snapshot(),baseline);
});


test("wachten op een concurrerende policylock geeft een veilige databasebezetcode, geen ongeldige invoer",async()=>{
 const {officialErrorCode}=await import("../src/lib/audio/officialJobs");
 const source=officialSources.find(s=>s.work==="bofm"&&s.language==="de"&&!s.pilot&&s.quality==="VALIDATED")!;
 let acquired!:()=>void,release!:()=>void;const held=new Promise<void>(r=>{acquired=r;}),gate=new Promise<void>(r=>{release=r;});
 const holder=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(726540108)::text`;acquired();await gate;},{timeout:15000});
 await held;const started=performance.now(),timer=setTimeout(release,6000);
 try {await assert.rejects(requestOfficialAudio(actor,"download",[source.id]),error=>officialErrorCode(error)==="DATABASE_BUSY");}
 finally{clearTimeout(timer);release();await holder;}
 assert.ok(performance.now()-started<5000,"PostgreSQL annuleert de lockwacht vóór de Prisma-deadline");
 assert.equal(await prisma.officialAudioTask.count({where:{id:source.id}}),0);
});
