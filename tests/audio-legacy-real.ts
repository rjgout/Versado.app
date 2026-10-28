// Optionele acceptatie van reeds nieuw gedownloade officiële MP3's, alleen in de eigen wegwerpdatabase.
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { objectHash,sha256 } from "../src/lib/audio/contract";
import { legacySources,LEGACY_PILOT_IDS,prepareLegacyConversion } from "../src/lib/audio/legacyConversion";
import { requestLegacyAudio,runOfficialAudioTick,publishOfficialSelection } from "../src/lib/audio/officialJobs";
import { accessibleRecording,activeChapterAudio } from "../src/lib/audio/library";
import { mirrorFileName } from "../src/lib/audioMirror";
import { mockOfficialNetwork,type OfficialMock } from "./fixtures/audio/official-network";
const url=new URL(process.env.AUDIO_TEST_DATABASE_URL??"http://invalid"),root=process.env.AUDIO_TEST_ROOT!,input=process.env.AUDIO_LEGACY_REAL_RESULTS;
if(url.hostname!=="127.0.0.1"||url.pathname!=="/versado_audio_test"||process.env.DATABASE_URL!==url.href||!input||(!input.startsWith("/tmp/")&&input!==path.resolve(".audio-v2-work/legacy-acceptance/source-results.json")))throw Error("Eigen audiorunner en lokale broncontrole vereist");
try {
 const evidence=JSON.parse(await fs.readFile(input,"utf8")) as {root:string;recordings:{id:string;localFile:string;pageFile:string;expectedHashMatches:boolean;expectedBytesMatch:boolean}[]};
 if((!evidence.root.startsWith("/tmp/versado-legacy-official-")&&!evidence.root.startsWith(path.resolve(".audio-v2-work")+"/legacy-source-"))||evidence.recordings.length!==3)throw Error("Eigen bronbestanden vereist");
 const snapshot=async()=>objectHash(await prisma.chapter.findMany({orderBy:{id:"asc"},include:{verses:{orderBy:{number:"asc"}},audioCheck:true}}));
 const before=await snapshot(),actor=await prisma.user.create({data:{email:"legacy-real@audio.invalid",handle:"LegacyReal",discriminator:"01",passwordHash:"unused",isAdmin:true}});
 const config:OfficialMock={sources:[],pages:{},audio:{},logFile:path.join(root,"real-network.log"),controlFile:path.join(root,"real-controls.json")};
 for(const id of LEGACY_PILOT_IDS){
  const source=legacySources.find(s=>s.id===id)!,row=evidence.recordings.find(r=>r.id===id)!;assert.ok(row.expectedBytesMatch&&row.expectedHashMatches);
  const file=path.resolve(evidence.root,row.localFile);if(!file.startsWith(evidence.root+"/audio/"))throw Error("Ongeldig bronbestand");
  const bytes=await fs.readFile(file);assert.equal(sha256(bytes),source.sha256);assert.equal(bytes.length,source.bytes);
  const chapter=await prisma.chapter.findFirstOrThrow({where:{number:source.chapterNumber,book:{key:source.bookKey,contentCollectionId:source.collectionId}}});
  await fs.writeFile(path.join(root,mirrorFileName(chapter.audioUrl!)!),bytes,{flag:"wx"});
  config.sources.push(source);config.audio[source.url]=file;config.pages[source.pageUrl]=JSON.parse(await fs.readFile(row.pageFile,"utf8"));
 }
 const ids=[...LEGACY_PILOT_IDS],plan=await prepareLegacyConversion(ids);
 await requestLegacyAudio(actor,"download",ids,plan.planHash);await runOfficialAudioTick(prisma,mockOfficialNetwork(config));
 assert.equal(await prisma.officialAudioTask.count({where:{id:{in:ids},status:"VALIDATED"}}),3);assert.equal(await prisma.audioRecording.count(),0);assert.equal(await prisma.audioPublication.count(),0);
 await requestLegacyAudio(actor,"register",ids,undefined);await runOfficialAudioTick(prisma,mockOfficialNetwork(config));
 const tasks=await prisma.officialAudioTask.findMany({where:{id:{in:ids}},include:{recording:true}});assert.equal(tasks.length,3);assert.equal(await prisma.audioPublication.count(),0);
 for(const task of tasks){assert.equal(task.status,"REGISTERED");assert.ok(await accessibleRecording(actor,task.recordingId!,prisma,true));const expected=legacySources.find(s=>s.id===task.id)!;assert.equal(task.recording!.sha256,expected.sha256);assert.equal(task.recording!.byteSize,expected.bytes);}
 const published=await publishOfficialSelection(actor,tasks.map(t=>({id:t.id,recordingId:t.recordingId!})),prisma,undefined,true);assert.ok(published.results.every(r=>r.status==="PUBLISHED"));
 for(const task of tasks){const chapter=await prisma.chapter.findUniqueOrThrow({where:{id:task.recording!.chapterId!},include:{verses:{orderBy:{number:"asc"}}}});const active=await activeChapterAudio(chapter);assert.ok(active?.legacyFallback);assert.equal(active!.verses.length,chapter.verses.length);}
 assert.equal(await snapshot(),before);
 for(const b of plan.baselines)assert.equal(sha256(await fs.readFile(path.join(root,b.file!.name))),b.file!.sha256);
 console.log("Echte officiële pilot: drie MP3's, 109 verzen; gecontroleerd, afzonderlijk geregistreerd, preview en afzonderlijke publicatie uitsluitend in eigen wegwerpdatabase. Alle 205 legacy-metadata en drie aanwezige legacy-bestanden ongewijzigd.");
}finally{await prisma.$disconnect();}
