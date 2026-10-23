import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { chapterSourceHash } from "../src/lib/audio/contract";
import { ensureHiddenAudioTextEditions } from "../src/lib/audio/hiddenEditions";
import { importChapterAudio } from "../prisma/importAudio";
import type { ChapterAudioSeed } from "../prisma/importAudio";
const url = new URL(process.env.AUDIO_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_audio_test" || process.env.DATABASE_URL !== url.href) throw new Error("Eigen audiorunner vereist");
const root = path.resolve(".audio-v2-work");
try {
 if (process.argv[2] === "prepare") {
  await ensureHiddenAudioTextEditions(prisma);
  const headings = new Map<string,string>((JSON.parse(await fs.readFile("prisma/bomChapterHeadings.json","utf8")) as [string,number,string][]).map(([slug,n,h])=>[`${slug}:${n}`,h]));
  for (const language of ["nl","en","de","fr","es"]) for (const [prefix,work] of [["bom","bofm"],["dc","dc-testament"],["pgp","pgp"]]) {
   if (language !== "nl" && language !== "en" && prefix !== "bom") continue;
   const id=`content_${prefix}${language==="nl"?"":"_"+language}`;
   await prisma.contentCollection.upsert({where:{id},update:{},create:{id,slug:id.replaceAll("_","-"),name:`${work} ${language}`,icon:"book",work,language,editionKey:work,enabled:false,visibleToUsers:false,publicationState:"DRAFT"}});
   const books=JSON.parse(await fs.readFile(`prisma/${prefix}Content${language==="nl"?"":"."+language}.json`,"utf8"));
   const keys: Record<string,string[]>={bom:["1-ne","2-ne","jacob","enos","jarom","omni","w-of-m","mosiah","alma","hel","3-ne","4-ne","morm","ether","moro"],dc:["dc"],pgp:["moses","abr","js-m","js-h","a-of-f"]};
   for(const [order,b] of books.entries()) {
    const key=`${work}/${keys[prefix][order]}`;
    const existing=await prisma.book.findFirst({where:{contentCollectionId:id,key}});
    const book=existing??await prisma.book.create({data:{slug:b.slug,key,name:b.name,order,contentCollectionId:id}});
    for(const [index,ch] of b.chapters.entries()) await prisma.chapter.upsert({where:{bookId_number:{bookId:book.id,number:ch.number}},update:{},create:{bookId:book.id,number:ch.number,order:index,heading:headings.get(`${b.slug}:${ch.number}`)??ch.heading??null,verses:{create:ch.verses.map((text:string,i:number)=>({number:i+1,text}))}}});
   }
   if(prefix==="bom")await importChapterAudio(prisma,JSON.parse(await fs.readFile(`prisma/bomAudio${language==="nl"?"":"."+language}.json`,"utf8")) as ChapterAudioSeed[],id,()=>{});
  }
  console.log("Alle 15 exacte tekstuitgaven voorbereid in wegwerpdatabase; zes nieuwe blijven verborgen en zonder cursussen/oefeningen.");
 } else {
  const inventory=JSON.parse(await fs.readFile(path.join(root,"inventory.json"),"utf8"));
  const report=[];
  const chapterResults: { work: string; language: string; bookKey: string | null; chapterNumber: number; sha256: string; quality: string; segments: number }[] = [];
  for(const language of ["nl","en","de","fr","es"]) for(const work of ["bofm","dc-testament","pgp"]) {
   const rows=inventory.chapters.filter((r:{language:string;work:string})=>r.language===language&&r.work===work),prefix=rows[0].prefix,id=`content_${prefix}${language==="nl"?"":"_"+language}`;
   const expected = rows.reduce((sum:number, row:{recordings:{status:string}[]}) => sum + row.recordings.filter((r) => r.status === "DOWNLOADED_VALIDATED").length, 0);
   const recordings=await prisma.audioRecording.findMany({where:{collectionId:id},include:{chapter:{include:{book:{select:{key:true}},verses:{orderBy:{number:"asc"}}}}}});
   assert.equal(recordings.length, expected, `${language}/${work}: alle geldige bestanden moeten geregistreerd zijn, onzekere uitlijning alleen voor review`);
   for(const r of recordings){assert.ok(r.chapter);assert.equal(chapterSourceHash(r.chapter!),r.sourceHash);assert.equal(r.language,language);assert.equal(r.work,work);chapterResults.push({work,language,bookKey:r.chapter!.book.key,chapterNumber:r.chapter!.number,sha256:r.sha256,quality:(r.quality as {status:string}).status,segments:Array.isArray(r.segments)?r.segments.length:0});}
   report.push({language,work,chapters:rows.length,officialChapters:rows.filter((r:{recordings:unknown[]})=>r.recordings.length>0).length,downloaded:rows.reduce((sum:number,r:{recordings:unknown[]})=>sum+r.recordings.length,0),registered:recordings.length,registeredChapters:new Set(recordings.map(r=>r.chapterId)).size,validated:recordings.filter(r=>(r.quality as {status:string}).status==="VALIDATED").length,review:recordings.filter(r=>(r.quality as {status:string}).status==="NEEDS_REVIEW").length});
   if(language!=="nl"&&language!=="en"&&prefix!=="bom") {const collection=await prisma.contentCollection.findUniqueOrThrow({where:{id}});assert.equal(collection.visibleToUsers,false);assert.equal(collection.enabled,false);assert.equal(collection.publicationState,"DRAFT");assert.equal(await prisma.course.count({where:{contentCollectionId:id}}),0);assert.equal(await prisma.exercise.count({where:{chapter:{book:{contentCollectionId:id}}}}),0);}
  }
  const published=await prisma.audioPublication.count({where:{recording:{packageId:{startsWith:"official-"}}}});assert.equal(published,0);
  const failed=await prisma.audioPackage.findMany({where:{id:{startsWith:"official-"},status:"FAILED"},select:{id:true,errorCode:true}});assert.equal(failed.length,0,JSON.stringify(failed));
  await fs.writeFile("/tmp/versado-audio-official-registration.json",JSON.stringify({isolated:true,published,report,chapters:chapterResults},null,2));console.log(JSON.stringify({isolated:true,published,report},null,2));
 }
} finally { await prisma.$disconnect(); }
