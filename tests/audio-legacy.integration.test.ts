import test,{before,after} from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { execFileSync,spawn } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "../src/lib/db";
import { sha256, objectHash } from "../src/lib/audio/contract";
import { LEGACY_PILOT_IDS, legacySources, legacyInventory, prepareLegacyConversion, legacyPilotApproved, legacyFallback } from "../src/lib/audio/legacyConversion";
import { requestLegacyAudio, requestOfficialAudio, runOfficialAudioTick, publishOfficialSelection, approveLegacyPilot } from "../src/lib/audio/officialJobs";
import { publishAudio, activeChapterAudio, accessibleRecording } from "../src/lib/audio/library";
import { mirrorFileName } from "../src/lib/audioMirror";
import { officialPage } from "./fixtures/audio/official-source";
import { mockOfficialNetwork,type OfficialMock } from "./fixtures/audio/official-network";
const url=new URL(process.env.AUDIO_TEST_DATABASE_URL??"http://invalid"),root=process.env.AUDIO_TEST_ROOT!;
if(url.hostname!=="127.0.0.1"||url.pathname!=="/versado_audio_test"||process.env.DATABASE_URL!==url.href)throw Error("Eigen audiorunner vereist");
let actor:{id:string;sessionVersion:number;isAdmin:boolean},baseline:string;
const config:OfficialMock={sources:[],pages:{},audio:{},logFile:path.join(root,"legacy-requests.log"),controlFile:path.join(root,"legacy-controls.json")},configFile=path.join(root,"legacy-mock.json");
const ids=[...LEGACY_PILOT_IDS];
const snapshot=async()=>objectHash({
 collections:await prisma.contentCollection.findMany({orderBy:{id:"asc"}}),
 chapters:await prisma.chapter.findMany({orderBy:{id:"asc"},include:{verses:{orderBy:{number:"asc"}},audioCheck:true}}),
 courses:await prisma.course.findMany({orderBy:{id:"asc"}}),exercises:await prisma.exercise.findMany({orderBy:{id:"asc"}}),
 users:await prisma.user.findMany({orderBy:{id:"asc"},select:{id:true,xpTotal:true,hintBalance:true,currentStreak:true,freezeCount:true}}),
 xp:await prisma.xPTransaction.findMany({orderBy:{id:"asc"}}),progress:await prisma.chapterProgress.findMany({orderBy:{id:"asc"}}),
});
async function tick(){await runOfficialAudioTick(prisma,mockOfficialNetwork(config),config.sources);}
function launchWorker(){const child=spawn(process.execPath,["--import","tsx","tests/fixtures/audio/official-worker.ts",configFile],{env:process.env,stdio:["ignore","ignore","pipe"]});const done=new Promise<void>((ok,no)=>{let error="";child.stderr.on("data",d=>error+=d);child.on("error",no);child.on("exit",(code,signal)=>code===0||signal==="SIGKILL"?ok():no(Error(error)));});return {child,done};}
function worker(){return launchWorker().done;}
const request=(action:"download"|"register"|"resume",selected:string[]=ids,planHash?:string)=>requestLegacyAudio(actor,action,selected,planHash,prisma,config.sources);
async function calls(){return (await fs.readFile(config.logFile,"utf8")).trim().split("\n").filter(s=>s in config.audio).length;}
before(async()=>{
 actor=await prisma.user.create({data:{email:"legacy-admin@audio.invalid",handle:"LegacyAdmin",discriminator:"01",passwordHash:"unused",isAdmin:true}});
 for(const [i,id] of ids.entries()) {
  const source=legacySources.find(s=>s.id===id)!,file=path.join(root,`legacy-new-${i}.mp3`);
  execFileSync("ffmpeg",["-v","error","-f","lavfi","-i",`sine=frequency=${900+i*100}:duration=9`,"-ac","1","-codec:a","libmp3lame",file]);
  const bytes=await fs.readFile(file),duration=Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",file],{encoding:"utf8"}));
  config.sources.push({...source,sha256:sha256(bytes),bytes:bytes.length,duration,starts:source.starts.map(t=>t/source.duration*duration)});
  config.audio[source.url]=file;config.pages[source.pageUrl]=officialPage(source);
  const chapter=await prisma.chapter.findFirstOrThrow({where:{number:source.chapterNumber,book:{key:source.bookKey,contentCollectionId:source.collectionId}}});
  // Eigen oude fixture staat op de exacte legacy-locatie. Nieuwe download mag die bytes nooit raken.
  execFileSync("ffmpeg",["-v","error","-n","-f","lavfi","-i",`sine=frequency=300:duration=${source.duration}`,"-ac","1","-codec:a","libmp3lame",path.join(root,mirrorFileName(chapter.audioUrl!)!)]);
 }
 await fs.writeFile(configFile,JSON.stringify(config));baseline=await snapshot();
});
after(async()=>{await prisma.$disconnect();});
test("inventarisatie van alle 205 is alleen lezen; 19 reviewgevallen blijven buiten gewone downloads",async()=>{
 const before=await prisma.officialAudioTask.count(),inventory=await legacyInventory();
 assert.equal(inventory.rows.length,205);assert.equal(inventory.rows.filter(r=>r.review).length,1);assert.equal(inventory.rows.filter(r=>r.pilot).length,3);assert.equal(inventory.pilotApproved,false);
 assert.equal(await prisma.officialAudioTask.count(),before);assert.equal(await snapshot(),baseline);
 for(const source of legacySources)await assert.rejects(requestOfficialAudio(actor,"download",[source.id]),/SOURCE_PROTECTED/);
 await assert.rejects(prepareLegacyConversion([legacySources.find(s=>s.quality!=="VALIDATED")!.id]),/SOURCE_PROTECTED/);
});
test("voorbereiden hasht oude bestanden en tijdcodes zonder taak; verkeerd plan en te grote selectie geweigerd",async()=>{
 const count=await prisma.officialAudioTask.count(),plan=await prepareLegacyConversion(ids);
 assert.equal(plan.baselines.length,3);assert.ok(plan.baselines.every(b=>b.file?.sha256&&b.verseStarts.length>0));
 assert.equal(await prisma.officialAudioTask.count(),count);
 await assert.rejects(request("download",ids,"0".repeat(64)),/LEGACY_BASELINE_CHANGED/);
 await assert.rejects(prepareLegacyConversion([...ids,legacySources.find(s=>!ids.includes(s.id as typeof ids[number])&&s.quality==="VALIDATED")!.id]),/INVALID_ACTION/);
 const outside=legacySources.find(s=>!ids.includes(s.id as typeof ids[number])&&s.quality==="VALIDATED")!;
 const other=await prepareLegacyConversion([outside.id]);
 await assert.rejects(requestLegacyAudio(actor,"download",[outside.id],other.planHash),/LEGACY_PILOT_REQUIRED/);
 assert.equal(await snapshot(),baseline);
});
test("twee gelijktijdige conversieopdrachten leggen één onveranderlijke uitgangssituatie per hoofdstuk vast",async()=>{
 const plan=await prepareLegacyConversion(ids);
 await Promise.all([request("download",ids,plan.planHash),request("download",ids,plan.planHash)]);
 assert.equal(await prisma.officialAudioTask.count({where:{id:{in:ids}}}),3);
 assert.equal(await prisma.audioRecording.count({where:{officialTasks:{some:{id:{in:ids}}}}}),0);
 for(const b of plan.baselines)assert.deepEqual((await prisma.officialAudioTask.findUniqueOrThrow({where:{id:b.sourceId}})).legacyBaseline,b);
 assert.equal(await snapshot(),baseline);
});
test("twee echte Node-processen halen drie nieuwe MP3's eenmaal op zonder oude bestanden, registratie of publicatie te wijzigen",async()=>{
 await Promise.all([worker(),worker()]);assert.equal(await calls(),3);
 assert.equal(await prisma.officialAudioTask.count({where:{id:{in:ids},status:"VALIDATED"}}),3);
 for(const id of ids){const task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id}});assert.equal(task.recordingId,null);const b=task.legacyBaseline as {file:{name:string;sha256:string}};assert.equal(sha256(await fs.readFile(path.join(root,b.file.name))),b.file.sha256);}
 assert.equal(await snapshot(),baseline);
});
test("oude sessieversie stopt registratie; een rollback laat geen opname achter",async()=>{
 await assert.rejects(requestLegacyAudio({...actor,sessionVersion:actor.sessionVersion+1},"register",ids,undefined,prisma,config.sources),/FORBIDDEN/);
 await request("register");
 await prisma.$executeRawUnsafe(`CREATE FUNCTION legacy_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."packageId" = 'admin-official-${ids[1]}' THEN RAISE EXCEPTION 'synthetische rollback'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe('CREATE TRIGGER legacy_fail BEFORE INSERT ON "AudioRecording" FOR EACH ROW EXECUTE FUNCTION legacy_fail()');
 try{await tick();}finally{await prisma.$executeRawUnsafe('DROP TRIGGER legacy_fail ON "AudioRecording"');await prisma.$executeRawUnsafe('DROP FUNCTION legacy_fail()');}
 assert.equal((await prisma.officialAudioTask.findUniqueOrThrow({where:{id:ids[1]}})).status,"FAILED");
 assert.equal(await prisma.audioRecording.count({where:{packageId:`admin-official-${ids[1]}`}}),0);
 await prisma.audioPackage.update({where:{id:`admin-official-${ids[1]}`},data:{leaseUntil:new Date(0)}});
 await request("resume",[ids[1]]);await tick();
 assert.equal(await prisma.officialAudioTask.count({where:{id:{in:ids},status:"REGISTERED"}}),3);
 assert.equal(await prisma.audioPublication.count({where:{recording:{officialTasks:{some:{id:{in:ids}}}}}}),0);assert.equal(await snapshot(),baseline);
});
test("tekst of oude verstijdcode wijzigen blokkeert conversiepublicatie zonder terugval te veranderen",async()=>{
 const task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:ids[0]}}),record=await prisma.audioRecording.findUniqueOrThrow({where:{id:task.recordingId!}});
 const chapter=await prisma.chapter.findUniqueOrThrow({where:{id:record.chapterId!},include:{verses:{orderBy:{number:"asc"}}}}),verse=chapter.verses[0];
 const audioCheck=await prisma.chapterAudioCheck.findUniqueOrThrow({where:{chapterId:chapter.id}});
 try{await prisma.chapterAudioCheck.update({where:{chapterId:chapter.id},data:{status:"NEEDS_REVIEW"}});await assert.rejects(publishAudio(actor,record.id,0),/LEGACY_BASELINE_CHANGED/);assert.equal(await legacyFallback(chapter.id),null);}
 finally{await prisma.chapterAudioCheck.update({where:{chapterId:chapter.id},data:{status:audioCheck.status,updatedAt:audioCheck.updatedAt}});}
 try {
  await prisma.verse.update({where:{id:verse.id},data:{audioStart:(verse.audioStart??0)+1}});
  await assert.rejects(publishAudio(actor,record.id,0),/LEGACY_BASELINE_CHANGED/);assert.equal(await legacyFallback(chapter.id),null);
  await prisma.verse.update({where:{id:verse.id},data:{audioStart:verse.audioStart,text:verse.text+" veranderd"}});
  await assert.rejects(publishAudio(actor,record.id,0),/SOURCE_MISMATCH/);
 }finally{await prisma.verse.update({where:{id:verse.id},data:{audioStart:verse.audioStart,text:verse.text}});}
 assert.equal(await snapshot(),baseline);
});
test("een vooraf bestaande opname krijgt pas publicatierecht na verse download én afzonderlijke registratiegoedkeuring",async()=>{
 const task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:ids[0]}}),recordingId=task.recordingId!,count=await prisma.audioRecording.count();
 await prisma.officialAudioTask.update({where:{id:task.id},data:{checkedAt:null,registrationApprovedAt:null}});
 await assert.rejects(publishAudio(actor,recordingId,0),/SOURCE_PROTECTED/);
 const plan=await prepareLegacyConversion([task.id]);await request("download",[task.id],plan.planHash);await tick();
 const downloaded=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:task.id}});assert.equal(downloaded.status,"VALIDATED");assert.equal(downloaded.registrationApprovedAt,null);assert.ok(downloaded.checkedAt);
 await assert.rejects(publishAudio(actor,recordingId,0),/SOURCE_PROTECTED/);
 await request("register",[task.id]);assert.equal((await prisma.officialAudioTask.findUniqueOrThrow({where:{id:task.id}})).recordingId,recordingId);assert.equal(await prisma.audioRecording.count(),count);
 assert.equal(await snapshot(),baseline);
});
test("preview werkt vóór publicatie, publicatie is afzonderlijk en replay vervangt geen pointer",async()=>{
 const tasks=await prisma.officialAudioTask.findMany({where:{id:{in:ids}}});
 await assert.rejects(approveLegacyPilot(actor),/LEGACY_PILOT_INCOMPLETE/);
 for(const task of tasks)assert.ok(await accessibleRecording(actor,task.recordingId!,prisma,true));
 const selections=tasks.map(t=>({id:t.id,recordingId:t.recordingId!}));
 assert.ok((await publishOfficialSelection(actor,selections,prisma,config.sources,true)).results.every(r=>r.status==="PUBLISHED"));
 const pointers=await prisma.audioPublication.findMany({where:{recordingId:{in:selections.map(s=>s.recordingId)}},orderBy:{targetKey:"asc"}});
 await publishOfficialSelection(actor,selections,prisma,config.sources,true);
 assert.deepEqual(await prisma.audioPublication.findMany({where:{recordingId:{in:selections.map(s=>s.recordingId)}},orderBy:{targetKey:"asc"}}),pointers);
 assert.equal(await prisma.audioRecording.count({where:{officialTasks:{some:{id:{in:ids}}}}}),3);assert.equal(await calls(),4);assert.equal(await snapshot(),baseline);
});
test("afgekeurde V2-bytes vallen terug op dezelfde oude bron/tijdcodes; gewijzigde tekst krijgt geen oude audio",async()=>{
 const task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:ids[0]}}),record=await prisma.audioRecording.findUniqueOrThrow({where:{id:task.recordingId!}});
 const chapter=await prisma.chapter.findUniqueOrThrow({where:{id:record.chapterId!},include:{verses:{orderBy:{number:"asc"}}}});
 const active=await activeChapterAudio(chapter);assert.ok(active?.legacyFallback);assert.ok(active!.legacyFallback!.url?.startsWith("/api/audio/"));
 const object=path.join(root,"objects",record.sha256+".mp3"),saved=object+".saved";
 await fs.rename(object,saved);
 try{assert.equal(await activeChapterAudio(chapter),undefined);assert.ok(await legacyFallback(chapter.id));}finally{await fs.rename(saved,object);}
 const v=chapter.verses[0];await prisma.verse.update({where:{id:v.id},data:{text:v.text+" changed"}});
 try{assert.equal(await legacyFallback(chapter.id),null);const changed={...chapter,verses:chapter.verses.map(x=>x.id===v.id?{...x,text:x.text+" changed"}:x)};assert.equal(await activeChapterAudio(changed),null);}finally{await prisma.verse.update({where:{id:v.id},data:{text:v.text}});}
 assert.equal(await snapshot(),baseline);
});
test("afzonderlijke proefgoedkeuring ontsluit uitsluitend overige geldige legacy-identiteiten",async()=>{
 assert.equal(await legacyPilotApproved(prisma),false);await approveLegacyPilot(actor);assert.equal(await legacyPilotApproved(prisma),true);
 const next=legacySources.find(s=>!ids.includes(s.id as typeof ids[number])&&s.quality==="VALIDATED")!,plan=await prepareLegacyConversion([next.id]);
 await requestLegacyAudio(actor,"download",[next.id],plan.planHash);assert.ok((await prisma.officialAudioTask.findUniqueOrThrow({where:{id:next.id}})).legacyApprovedAt);
 // Geen ongevraagde vierde netwerkopdracht in deze proeven; laat de expliciete taak zichtbaar gestopt achter.
 await prisma.officialAudioTask.update({where:{id:next.id},data:{status:"FAILED",errorCode:"TEST_STOPPED"}});
 assert.equal(await snapshot(),baseline);
});

async function pausedRepair() {
 await prisma.officialAudioTask.update({where:{id:ids[0]},data:{status:"FAILED",phase:"DOWNLOAD",checkedAt:null,leaseUntil:null}});
 await request("resume",[ids[0]]);
 await fs.writeFile(config.controlFile,JSON.stringify({pauseUrl:config.sources[0].url}));
 const launched=launchWorker();let paused=false;
 for(let i=0;i<160;i++){const task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:ids[0]}});if(task.status==="RUNNING"&&task.bytesDownloaded===1){paused=true;break;}await delay(25);}
 if(!paused){launched.child.kill("SIGKILL");await launched.done;throw Error("Download niet gepauzeerd");}
 return launched;
}
test("procesuitval tijdens nieuwe legacy-download hervat met fencing en behoudt bestanden en publicatie",async()=>{
 const pointers=await prisma.audioPublication.findMany({orderBy:{targetKey:"asc"}}),count=await prisma.audioRecording.count();
 const launched=await pausedRepair();launched.child.kill("SIGKILL");await launched.done;
 await fs.writeFile(config.controlFile,"{}");await prisma.officialAudioTask.update({where:{id:ids[0]},data:{leaseUntil:new Date(0)}});await worker();
 assert.equal((await prisma.officialAudioTask.findUniqueOrThrow({where:{id:ids[0]}})).status,"REGISTERED");assert.equal(await prisma.audioRecording.count(),count);
 assert.deepEqual(await prisma.audioPublication.findMany({orderBy:{targetKey:"asc"}}),pointers);assert.equal(await snapshot(),baseline);
});
test("rolintrekking tijdens een vertraagde legacy-download blokkeert commit; expliciete retry is veilig",async()=>{
 const pointers=await prisma.audioPublication.findMany({orderBy:{targetKey:"asc"}}),count=await prisma.audioRecording.count();
 const launched=await pausedRepair();await prisma.user.update({where:{id:actor.id},data:{isAdmin:false}});
 try{await fs.writeFile(config.controlFile,"{}");await launched.done;const task=await prisma.officialAudioTask.findUniqueOrThrow({where:{id:ids[0]}});assert.equal(task.status,"FAILED");assert.equal(task.errorCode,"FORBIDDEN");}
 finally{await prisma.user.update({where:{id:actor.id},data:{isAdmin:true}});}
 await request("resume",[ids[0]]);await tick();assert.equal((await prisma.officialAudioTask.findUniqueOrThrow({where:{id:ids[0]}})).status,"REGISTERED");
 assert.equal(await prisma.audioRecording.count(),count);assert.deepEqual(await prisma.audioPublication.findMany({orderBy:{targetKey:"asc"}}),pointers);assert.equal(await snapshot(),baseline);
});
