import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { prisma } from "../src/lib/db";
import { chapterSourceHash, sha256, type AudioManifest } from "../src/lib/audio/contract";
import { importAudioPackage, publishAudio, activeChapterAudio, accessibleRecording, scanAudioPackages } from "../src/lib/audio/library";
import { ensureHiddenAudioTextEditions } from "../src/lib/audio/hiddenEditions";
import { flagAudioForTextChanges, markAudioCurrent } from "../src/lib/audioCheck";
import { importChapterAudio } from "../prisma/importAudio";
const url = new URL(process.env.AUDIO_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_audio_test" || process.env.DATABASE_URL !== url.href) throw new Error("Eigen audiorunner vereist");
const root = process.env.AUDIO_TEST_ROOT!;
let chapterId: string, otherChapter: string, bytes: Buffer, duration: number, admin: {id:string;isAdmin:boolean;sessionVersion:number}, first: string;
async function chapter(id = chapterId) { return prisma.chapter.findUniqueOrThrow({where:{id},include:{verses:{orderBy:{number:"asc"}}}}); }
async function fixture(name: string, options: { chapterId?: string; quality?: "VALIDATED" | "NEEDS_REVIEW"; mutate?: (manifest: AudioManifest) => void } = {}) {
 const ch=await chapter(options.chapterId),folder=path.join(root,"incoming",name);await fs.mkdir(folder,{recursive:true});
 const segments=Buffer.from(JSON.stringify({schemaVersion:1,segments:ch.verses.map((v,i)=>({id:v.id,kind:"VERSE",sourceHash:sha256(v.text),start:i+0.2,end:i+1.2}))}));
 const manifest:AudioManifest={schemaVersion:1,packageId:name,collectionId:"audio-test-nl",work:"bofm",editionKey:"default",language:"nl",target:{kind:"CHAPTER",bookKey:"bofm/audio-test",chapterNumber:ch.number},sourceHash:chapterSourceHash(ch),sourceKind:"OFFICIAL",source:{name:"Synthetische bron",url:"https://assets.churchofjesuschrist.org/audio-fixture.mp3",checkedAt:new Date().toISOString(),rights:"Uitsluitend testfixture"},voice:{name:"test"},audio:{file:"audio.mp3",sha256:sha256(bytes),bytes:bytes.length,duration,format:"mp3"},segments:{file:"segments.json",sha256:sha256(segments)},quality:options.quality??"VALIDATED"};
 options.mutate?.(manifest);
 await fs.writeFile(path.join(folder,"audio.mp3"),bytes);await fs.writeFile(path.join(folder,"segments.json"),segments);await fs.writeFile(path.join(folder,"manifest.json"),JSON.stringify(manifest));await fs.writeFile(path.join(folder,"READY"),"1\n");
 return {folder,manifest};
}
async function imported(name:string,options:Parameters<typeof fixture>[1]={}) {const f=await fixture(name,options);const result=await importAudioPackage(f.folder);assert.equal(result.status,"READY",result.errorCode??"");return prisma.audioRecording.findUniqueOrThrow({where:{packageId:name}});}
before(async()=>{
 await fs.mkdir(path.join(root,"incoming"),{recursive:true});
 const file=path.join(root,"fixture.mp3");execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","sine=frequency=440:duration=4","-ac","1","-codec:a","libmp3lame",file]);bytes=await fs.readFile(file);duration=Number(execFileSync("ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",file],{encoding:"utf8"}));
 admin=await prisma.user.create({data:{email:"admin@audio.invalid",handle:"AudioAdmin",discriminator:"01",passwordHash:"unused",isAdmin:true}});
 await prisma.contentCollection.create({data:{id:"audio-test-nl",slug:"audio-test-nl",name:"Audio test",icon:"book",work:"bofm",language:"nl",publicationState:"PUBLISHED",enabled:true,visibleToUsers:true}});
 const book=await prisma.book.create({data:{slug:"audio-test-book",key:"bofm/audio-test",name:"Audio testboek",order:999,contentCollectionId:"audio-test-nl"}});
 for(let n=1;n<=2;n++){const ch=await prisma.chapter.create({data:{bookId:book.id,number:n,order:n,heading:"Testkop",audioUrl:"https://assets.churchofjesuschrist.org/legacy.mp3",verses:{create:[{number:1,text:"Synthetische eerste tekst",audioStart:0.2},{number:2,text:"Synthetische tweede tekst",audioStart:1.2}]}}});if(n===1)chapterId=ch.id;else otherChapter=ch.id;}
});
after(async()=>{await prisma.$disconnect();});

test("registreren publiceert nooit en wijzigt legacy, tekst, cursussen of voortgang niet",async()=>{
 const previous=await chapter(),r=await imported("first");first=r.id;
 assert.equal(await prisma.audioPublication.count(),0);assert.equal(await activeChapterAudio(previous),undefined);
 assert.equal((await chapter()).audioUrl,previous.audioUrl);assert.deepEqual((await chapter()).verses,previous.verses);
 assert.equal(await prisma.course.count({where:{contentCollectionId:"audio-test-nl"}}),0);
});
test("gelijktijdige import en replay produceren precies één registratie",async()=>{
 const f=await fixture("parallel");await Promise.all(Array.from({length:8},()=>importAudioPackage(f.folder)));
 assert.equal(await prisma.audioRecording.count({where:{packageId:"parallel"}}),1);
 assert.equal((await importAudioPackage(f.folder)).status,"READY");
});
test("twee afzonderlijke Node-processen claimen één pakket zonder dubbele registratie",async()=>{
 const f=await fixture("multi-process");
 await Promise.all(Array.from({length:2},()=>new Promise<void>((resolve,reject)=>{
  const child=spawn(process.execPath,["--import","tsx","tests/fixtures/audio/import-worker.ts",f.folder],{env:process.env,stdio:["ignore","pipe","pipe"]});
  let errors="";child.stderr.on("data",chunk=>{errors+=chunk;});
  child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(new Error(errors)));
 })));
 assert.equal(await prisma.audioRecording.count({where:{packageId:"multi-process"}}),1);
 assert.equal((await prisma.audioPackage.findUniqueOrThrow({where:{id:"multi-process"}})).status,"READY");
});
test("beheerpublicatie en toegang: gewone gebruiker geen preview of beheerrechten",async()=>{
 const ordinary={isAdmin:false};assert.equal(await accessibleRecording(ordinary,first),null);
 assert.equal(await accessibleRecording(ordinary,first,undefined,true),null);
 assert.ok(await accessibleRecording({isAdmin:true},first,undefined,true));
 await assert.rejects(publishAudio({...admin,isAdmin:false},first,0),/FORBIDDEN/);
 const p=await publishAudio(admin,first,0);assert.equal(p.version,1);
 assert.ok(await accessibleRecording(ordinary,first));assert.ok(await activeChapterAudio(await chapter()));
 await assert.rejects(publishAudio(admin,first,0),/PUBLICATION_CONFLICT/);
});
test("defecte checksum en verkeerde editie blijven FAILED; actieve opname blijft behouden",async()=>{
 for(const [name,mutate] of [["bad-checksum",(m:AudioManifest)=>{m.audio.sha256="0".repeat(64);}],["bad-language",(m:AudioManifest)=>{m.language="en";}],["bad-source",(m:AudioManifest)=>{m.sourceHash="0".repeat(64);}]] as const){
  const f=await fixture(name,{mutate});assert.equal((await importAudioPackage(f.folder)).status,"FAILED");assert.equal(await prisma.audioRecording.count({where:{packageId:name}}),0);
 }
 assert.equal((await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:`chapter:${chapterId}`}})).recordingId,first);
});
test("hergebruik van een pakket-ID met andere bytes kan registratie niet overschrijven",async()=>{
 const f=await fixture("immutable-identity");assert.equal((await importAudioPackage(f.folder)).status,"READY");
 await fs.appendFile(path.join(f.folder,"manifest.json")," ");
 await assert.rejects(importAudioPackage(f.folder),/PACKAGE_ID_REUSED/);
 assert.equal(await prisma.audioRecording.count({where:{packageId:"immutable-identity"}}),1);
});
test("beschadigde MP3 en onjuiste duur worden onafhankelijk gedecodeerd en geweigerd",async()=>{
 const f=await fixture("corrupt");const corrupt=Buffer.from("ID3geen echte audio");f.manifest.audio.bytes=corrupt.length;f.manifest.audio.sha256=sha256(corrupt);await fs.writeFile(path.join(f.folder,"audio.mp3"),corrupt);await fs.writeFile(path.join(f.folder,"manifest.json"),JSON.stringify(f.manifest));
 assert.equal((await importAudioPackage(f.folder)).status,"FAILED");
 const bad=await fixture("duration",{mutate:m=>{m.audio.duration+=5;}});assert.equal((await importAudioPackage(bad.folder)).status,"FAILED");
});
test("geldige MP3 met ingebedde albumafbeelding wordt onafhankelijk geaccepteerd",async()=>{
 const image=path.join(root,"cover.png"),file=path.join(root,"with-cover.mp3");
 execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","color=c=blue:s=64x64","-frames:v","1","-threads","1",image]);
 execFileSync("ffmpeg",["-v","error","-i",path.join(root,"fixture.mp3"),"-i",image,"-map","0:a:0","-map","1:v:0","-c","copy","-id3v2_version","3","-disposition:v","attached_pic",file]);
 const f=await fixture("with-cover"),data=await fs.readFile(file);f.manifest.audio.bytes=data.length;f.manifest.audio.sha256=sha256(data);
 await fs.writeFile(path.join(f.folder,"audio.mp3"),data);await fs.writeFile(path.join(f.folder,"manifest.json"),JSON.stringify(f.manifest));
 const receipt=await importAudioPackage(f.folder);assert.equal(receipt.status,"READY",receipt.errorCode??"");
});
test("een onbegrensde albumafbeelding wordt niet als veilige MP3 geaccepteerd",async()=>{
 const image=path.join(root,"large-cover.png"),file=path.join(root,"large-cover.mp3");
 execFileSync("ffmpeg",["-v","error","-f","lavfi","-i","color=c=blue:s=5000x2","-frames:v","1","-threads","1",image]);
 execFileSync("ffmpeg",["-v","error","-i",path.join(root,"fixture.mp3"),"-i",image,"-map","0:a:0","-map","1:v:0","-c","copy","-id3v2_version","3","-disposition:v","attached_pic",file]);
 const f=await fixture("large-cover"),data=await fs.readFile(file);f.manifest.audio.bytes=data.length;f.manifest.audio.sha256=sha256(data);
 await fs.writeFile(path.join(f.folder,"audio.mp3"),data);await fs.writeFile(path.join(f.folder,"manifest.json"),JSON.stringify(f.manifest));
 assert.equal((await importAudioPackage(f.folder)).status,"FAILED");
});
test("symlinks, paden en segmentwissels worden geweigerd",async()=>{
 const f=await fixture("symlink");await fs.unlink(path.join(f.folder,"audio.mp3"));await fs.symlink(path.join(root,"fixture.mp3"),path.join(f.folder,"audio.mp3"));assert.equal((await importAudioPackage(f.folder)).status,"FAILED");
 const other=await fixture("wrong-segments");const data=JSON.parse(await fs.readFile(path.join(other.folder,"segments.json"),"utf8"));data.segments[0].id="foreign-verse";const content=Buffer.from(JSON.stringify(data));other.manifest.segments.sha256=sha256(content);await fs.writeFile(path.join(other.folder,"segments.json"),content);await fs.writeFile(path.join(other.folder,"manifest.json"),JSON.stringify(other.manifest));assert.equal((await importAudioPackage(other.folder)).status,"FAILED");
});
test("complete pakketten met onleesbaar of te groot manifest krijgen een foutreceipt",async()=>{
 const f=await fixture("oversize-manifest");await fs.writeFile(path.join(f.folder,"manifest.json")," ".repeat(65537));
 const receipt=await importAudioPackage(f.folder);assert.equal(receipt.status,"FAILED");assert.equal(receipt.errorCode,"MANIFEST_UNREADABLE");
 await fs.writeFile(path.join(f.folder,"manifest.json"),JSON.stringify(f.manifest));
 await prisma.audioPackage.update({where:{id:receipt.id},data:{leaseUntil:new Date(0)}});
 const recovered=await importAudioPackage(f.folder);assert.equal(recovered.status,"READY");assert.equal(recovered.attempts,2);
});
test("kwaliteitscontrole blokkeert publicatie van onzekere uitlijning",async()=>{
 const r=await imported("review",{quality:"NEEDS_REVIEW"});await assert.rejects(publishAudio(admin,r.id,1),/QUALITY_REVIEW_REQUIRED/);
});
test("zonder veilige verstijden alleen reviewregistratie en expliciete beheerpreview, nooit publicatie",async()=>{
 const f=await fixture("no-alignment",{quality:"NEEDS_REVIEW"});
 const segments=Buffer.from(JSON.stringify({schemaVersion:1,segments:[]}));f.manifest.segments.sha256=sha256(segments);
 await fs.writeFile(path.join(f.folder,"segments.json"),segments);await fs.writeFile(path.join(f.folder,"manifest.json"),JSON.stringify(f.manifest));
 assert.equal((await importAudioPackage(f.folder)).status,"READY");
 const r=await prisma.audioRecording.findUniqueOrThrow({where:{packageId:"no-alignment"}});
 assert.equal(await accessibleRecording({isAdmin:false},r.id),null);assert.ok(await accessibleRecording(admin,r.id,undefined,true));
 await assert.rejects(publishAudio(admin,r.id,1),/QUALITY_REVIEW_REQUIRED/);
 const validated=await fixture("empty-validated");validated.manifest.segments.sha256=sha256(segments);await fs.writeFile(path.join(validated.folder,"segments.json"),segments);await fs.writeFile(path.join(validated.folder,"manifest.json"),JSON.stringify(validated.manifest));
 assert.equal((await importAudioPackage(validated.folder)).status,"FAILED");
});
test("verlopen proceslease hervat; verlopen eigenaar kan geen tweede registratie maken",async()=>{
 const f=await fixture("recover-lease");await prisma.audioPackage.create({data:{id:"recover-lease",manifestHash:sha256(await fs.readFile(path.join(f.folder,"manifest.json"))),leaseToken:"abandoned",leaseUntil:new Date(0)}});
 const r=await importAudioPackage(f.folder);assert.equal(r.status,"READY");assert.equal(r.attempts,2);assert.notEqual(r.leaseToken,"abandoned");assert.equal(await prisma.audioRecording.count({where:{packageId:r.id}}),1);
});
test("databasefout rolt READY en opnameregistratie samen terug; retry hergebruikt veilig object",async()=>{
 const f=await fixture("rollback");
 await prisma.$executeRawUnsafe(`CREATE FUNCTION audio_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."packageId" = 'rollback' THEN RAISE EXCEPTION 'synthetische databasefout'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe(`CREATE TRIGGER audio_test_failure BEFORE INSERT ON "AudioRecording" FOR EACH ROW EXECUTE FUNCTION audio_test_failure()`);
 try {assert.equal((await importAudioPackage(f.folder)).status,"FAILED");assert.equal(await prisma.audioRecording.count({where:{packageId:"rollback"}}),0);await fs.access(path.join(root,"objects",sha256(bytes)+".mp3"));}
 finally{await prisma.$executeRawUnsafe(`DROP TRIGGER audio_test_failure ON "AudioRecording"`);await prisma.$executeRawUnsafe(`DROP FUNCTION audio_test_failure()`);}
 await prisma.audioPackage.update({where:{id:"rollback"},data:{leaseUntil:new Date(0)}});assert.equal((await importAudioPackage(f.folder)).status,"READY");
});
test("twee gelijktijdige publicaties hebben één winnaar en één consistente pointer",async()=>{
 const a=await imported("race-a"),b=await imported("race-b");const results=await Promise.allSettled([publishAudio(admin,a.id,1),publishAudio(admin,b.id,1)]);
 assert.equal(results.filter(r=>r.status==="fulfilled").length,1);assert.equal(results.filter(r=>r.status==="rejected").length,1);
 assert.equal((await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:a.targetKey}})).version,2);
});
test("sessieversiecontrole weigert ingetrokken beheeridentiteit",async()=>{
 await prisma.user.update({where:{id:admin.id},data:{sessionVersion:{increment:1}}});await assert.rejects(publishAudio(admin,first,2),/FORBIDDEN/);admin={...admin,sessionVersion:admin.sessionVersion+1};
});
test("intrekking tijdens lockwachten verhindert een nieuwe beheerpublicatie",async()=>{
 let acquired!:()=>void, release!:()=>void;
 const held = new Promise<void>(r=>{acquired=r;}), gate = new Promise<void>(r=>{release=r;});
 const blocker = prisma.$transaction(async(tx)=>{
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${admin.id} FOR UPDATE`;
  acquired();await gate;
  await tx.user.update({where:{id:admin.id},data:{sessionVersion:{increment:1}}});
 },{timeout:15000});
 await held;
 const action=publishAudio(admin,first,2).then(()=>"COMMITTED",error=>String(error));
 try {
  let waiting=false;
  for(let i=0;i<100;i++){
   const rows=await prisma.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%User%FOR UPDATE%'`;
   if(Number(rows[0].count)>0){waiting=true;break;}
   await new Promise(r=>setTimeout(r,10));
  }
  assert.ok(waiting,"de publicatie moet aantoonbaar op de User-lock wachten");
 } finally {release();await blocker;}
 assert.match(await action,/FORBIDDEN/);
 assert.equal((await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:`chapter:${chapterId}`}})).version,2);
 admin={...admin,sessionVersion:admin.sessionVersion+1};
});
test("tekstupdate blokkeert oude opname én publicatie, behoudt bestanden en legacygegevens",async()=>{
 const previous=await chapter();
 await flagAudioForTextChanges(prisma,[{chapterId,hasAudio:true,before:previous.verses.map(v=>v.text),after:["Gewijzigde tekst",previous.verses[1].text]}]);
 await prisma.verse.update({where:{id:previous.verses[0].id},data:{text:"Gewijzigde tekst"}});
 try {
  assert.equal((await prisma.chapterAudioCheck.findUniqueOrThrow({where:{chapterId}})).status,"NEEDS_REVIEW");
  assert.equal(await activeChapterAudio(await chapter()),null);assert.equal(await accessibleRecording({isAdmin:false},first),null);
  await assert.rejects(publishAudio(admin,first,2),/SOURCE_MISMATCH/);
  await markAudioCurrent(prisma,chapterId,admin.id);
  assert.equal(await activeChapterAudio(await chapter()),null,"legacy-bevestiging omzeilt nooit de V2-brontekstbinding");
  await assert.rejects(publishAudio(admin,first,2),/SOURCE_MISMATCH/);
  assert.equal((await chapter()).audioUrl,previous.audioUrl);
  assert.deepEqual((await chapter()).verses.map(v=>v.audioStart),previous.verses.map(v=>v.audioStart));
 } finally {
  await prisma.verse.update({where:{id:previous.verses[0].id},data:{text:previous.verses[0].text}});
  await markAudioCurrent(prisma,chapterId);
 }
});
test("ontbrekend of corrupt gepubliceerd object valt terug op TTS en kan niet opnieuw worden gepubliceerd",async()=>{
 const file=path.join(root,"objects",sha256(bytes)+".mp3");
 try {await fs.writeFile(file,Buffer.alloc(bytes.length));assert.equal(await activeChapterAudio(await chapter()),null);await assert.rejects(publishAudio(admin,first,2),/OBJECT_CORRUPT/);}
 finally {await fs.writeFile(file,bytes);}
 await fs.rename(file,file+".missing");
 try {assert.equal(await activeChapterAudio(await chapter()),null);}
 finally {await fs.rename(file+".missing",file);}
 assert.ok(await activeChapterAudio(await chapter()));
});
test("contenttoegang volgt publicatie en zichtbaarheid; adminpreview blijft expliciet",async()=>{
 const p=await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:`chapter:${chapterId}`}});
 await prisma.contentCollection.update({where:{id:"audio-test-nl"},data:{publicationState:"DRAFT",visibleToUsers:false}});
 assert.equal(await accessibleRecording({isAdmin:false},p.recordingId),null);assert.equal(await accessibleRecording({isAdmin:true},p.recordingId),null);assert.ok(await accessibleRecording({isAdmin:true},p.recordingId,undefined,true));
 await prisma.contentCollection.update({where:{id:"audio-test-nl"},data:{publicationState:"PUBLISHED",visibleToUsers:true}});
});
test("onvolledige legacy-import wist geen Nederlandse hoofdstukaudio of verstijdcodes",async()=>{
 const previous=await chapter();await importChapterAudio(prisma,[],"audio-test-nl",()=>{});assert.deepEqual(await chapter(),previous);
});
test("ongeldige legacy-tijdcodes behouden audio en markeren de controle; ongewijzigde gegevens lossen die niet op",async()=>{
 const previous=await chapter();
 const entry={book:"bofm/audio-test",chapter:1,url:previous.audioUrl!,headingStart:previous.audioHeadingStart??0,headingEnd:previous.audioHeadingEnd??0,verseStarts:previous.verses.map(v=>v.audioStart!)};
 for(const invalid of [
  {...entry,headingStart:Number.NaN}, {...entry,headingEnd:Number.POSITIVE_INFINITY},
  {...entry,headingStart:2,headingEnd:1}, {...entry,headingStart:-1},
  {...entry,verseStarts:[0.2]}, {...entry,verseStarts:[1.2,0.2]},
  {...entry,verseStarts:[-1,1]}, {...entry,verseStarts:[0,Number.NaN]},
 ]) {
  await importChapterAudio(prisma,[invalid],"audio-test-nl",()=>{});
  assert.deepEqual(await chapter(),previous);
  assert.equal((await prisma.chapterAudioCheck.findUniqueOrThrow({where:{chapterId}})).status,"NEEDS_REVIEW");
 }
 // Maak kopgegevens gelijk voordat een ongewijzigde import wordt beoordeeld.
 await prisma.chapter.update({where:{id:chapterId},data:{audioHeadingStart:entry.headingStart,audioHeadingEnd:entry.headingEnd}});
 await importChapterAudio(prisma,[entry],"audio-test-nl",()=>{});
 assert.equal((await prisma.chapterAudioCheck.findUniqueOrThrow({where:{chapterId}})).status,"NEEDS_REVIEW");
 await prisma.chapter.update({where:{id:chapterId},data:{audioHeadingStart:previous.audioHeadingStart,audioHeadingEnd:previous.audioHeadingEnd}});
});
test("legacy-audio, verstijdcodes en controle rollen samen terug; een geldige retry behoudt V2-publicatie",async()=>{
 const previous=await chapter(),publication=await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:`chapter:${chapterId}`}});
 const check=await prisma.chapterAudioCheck.findUniqueOrThrow({where:{chapterId}});
 const entry={book:"bofm/audio-test",chapter:1,url:"https://assets.churchofjesuschrist.org/replacement.mp3",headingStart:0,headingEnd:0.5,verseStarts:[0.75,1.75]};
 await prisma.$executeRawUnsafe(`CREATE FUNCTION audio_legacy_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."audioStart" = 0.75 THEN RAISE EXCEPTION 'legacy timing test failure'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe(`CREATE TRIGGER audio_legacy_fail BEFORE UPDATE ON "Verse" FOR EACH ROW EXECUTE FUNCTION audio_legacy_fail()`);
 try {
  await assert.rejects(importChapterAudio(prisma,[entry],"audio-test-nl",()=>{}),/legacy timing test failure/);
  assert.deepEqual(await chapter(),previous);
  assert.deepEqual(await prisma.chapterAudioCheck.findUniqueOrThrow({where:{chapterId}}),check);
 } finally {
  await prisma.$executeRawUnsafe(`DROP TRIGGER audio_legacy_fail ON "Verse"`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION audio_legacy_fail()`);
 }
 await importChapterAudio(prisma,[entry],"audio-test-nl",()=>{});
 assert.equal((await prisma.chapterAudioCheck.findUniqueOrThrow({where:{chapterId}})).status,"CURRENT");
 assert.deepEqual((await chapter()).verses.map(v=>v.audioStart),entry.verseStarts);
 const approved=await prisma.chapterAudioCheck.findUniqueOrThrow({where:{chapterId}});
 await importChapterAudio(prisma,[entry],"audio-test-nl",()=>{});
 assert.deepEqual(await prisma.chapterAudioCheck.findUniqueOrThrow({where:{chapterId}}),approved,"een identieke retry schrijft geen controle opnieuw");
 assert.deepEqual(await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:`chapter:${chapterId}`}}),publication);
 assert.ok(await activeChapterAudio(await chapter()));
});
test("automatische scanner registreert een volgende vraag zonder publicatie of Redis",async()=>{
 for(let i=0;i<25;i++)await fs.mkdir(path.join(root,"incoming",`aaa-incomplete-${i}`));
 const f=await fixture("scanner",{chapterId:otherChapter});assert.ok(f.folder);await scanAudioPackages();
 assert.equal((await prisma.audioPackage.findUniqueOrThrow({where:{id:"scanner"}})).status,"READY");assert.equal(await prisma.audioPublication.count({where:{targetKey:`chapter:${otherChapter}`}}),0);
});
test("databaseconstraints beschermen collectiebinding, target en verwijdercascades",async()=>{
 const r=await prisma.audioRecording.findUniqueOrThrow({where:{packageId:"scanner"}});
 await assert.rejects(prisma.audioRecording.update({where:{id:r.id},data:{language:"es"}}));
 await assert.rejects(prisma.audioPublication.create({data:{targetKey:"chapter:foreign",recordingId:r.id,publishedBy:admin.id}}));
 await prisma.chapter.delete({where:{id:otherChapter}});assert.equal(await prisma.audioRecording.count({where:{id:r.id}}),0);
});

test("zes goedgekeurde ontbrekende tekstuitgaven blijven verborgen, idempotent en zonder leereffecten",async()=>{
 await ensureHiddenAudioTextEditions(prisma);
 for(const prefix of ["dc","pgp"])for(const language of ["de","fr","es"]){
  const id=`content_${prefix}_${language}`,c=await prisma.contentCollection.findUniqueOrThrow({where:{id}});
  assert.equal(c.editionKey,prefix === "dc" ? "dc-testament" : "pgp");assert.equal(c.enabled,false);assert.equal(c.visibleToUsers,false);assert.equal(c.publicationState,"DRAFT");
  assert.equal(await prisma.course.count({where:{contentCollectionId:id}}),0);
  assert.equal(await prisma.exercise.count({where:{chapter:{book:{contentCollectionId:id}}}}),0);
 }
 const verse=await prisma.verse.findFirstOrThrow({where:{chapter:{book:{contentCollectionId:"content_dc_de"}}}});
 const count=await prisma.verse.count({where:{chapter:{book:{contentCollectionId:"content_dc_de"}}}});
 await prisma.verse.update({where:{id:verse.id},data:{text:"Bestaande beheerwijziging voor idempotentietest"}});
 try {await ensureHiddenAudioTextEditions(prisma);assert.equal(await prisma.verse.count({where:{chapter:{book:{contentCollectionId:"content_dc_de"}}}}),count);assert.equal((await prisma.verse.findUniqueOrThrow({where:{id:verse.id}})).text,"Bestaande beheerwijziging voor idempotentietest");}
 finally{await prisma.verse.update({where:{id:verse.id},data:{text:verse.text}});}
});
