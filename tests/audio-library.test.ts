import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { chapterSourceHash, sha256, validateSegments, manifestSchema } from "../src/lib/audio/contract";
import { readBounded, safeDirectory } from "../src/lib/audio/storage";
import { streamAudio } from "../src/lib/audio/stream";
import { BOOK_KEYS_BY_SLUG } from "../prisma/bookKeys";
import nlAudio from "../prisma/bomAudio.json";

test("canonieke tekstversie bindt kop, volgorde, versnummer en exacte tekst zonder normalisatieverlies", () => {
 const base = {heading:"Kop",verses:[{number:1,text:"Eén tekst"},{number:2,text:"Volgende"}]};
 const hash=chapterSourceHash(base);assert.equal(hash,chapterSourceHash({...base}));
 for(const change of [{...base,heading:null},{...base,verses:[...base.verses].reverse()},{...base,verses:[{number:1,text:"Een tekst"},base.verses[1]]}]) assert.notEqual(hash,chapterSourceHash(change));
});
test("segmenten weigeren verkeerde ankers/tekst, overlap, NaN, ontbrekende verzen en overschrijding",()=>{
 const expected=[{id:"v1",text:"Eén"},{id:"v2",text:"Twee"}], segments=expected.map((v,i)=>({id:v.id,sourceHash:sha256(v.text),kind:"VERSE" as const,start:i+1,end:i+2}));
 validateSegments(segments,expected,4);
 for(const change of [[segments[0]],[{...segments[0],id:"ander"},segments[1]],[{...segments[0],sourceHash:sha256("ander")},segments[1]],[{...segments[0],end:2.5},segments[1]],[{...segments[0],start:NaN},segments[1]],[segments[0],{...segments[1],end:5}]]) assert.throws(()=>validateSegments(change,expected,4));
});
test("pakketschema weigert paden en onbekende contractversie",()=>{
 assert.equal(manifestSchema.safeParse({schemaVersion:2}).success,false);
 assert.equal(manifestSchema.shape.audio.shape.file.safeParse("../audio.mp3").success,false);
 assert.equal(manifestSchema.shape.audio.shape.file.safeParse("audio.mp3").success,true);
 assert.equal(manifestSchema.shape.source.shape.url.safeParse("javascript:alert(1)").success,false);
 assert.equal(manifestSchema.shape.source.shape.url.safeParse("https://user:secret@example.invalid/audio.mp3").success,false);
 assert.equal(manifestSchema.shape.source.shape.checkedAt.safeParse("2026-10-23T12:00:00+00:00").success,true);
});
test("Nederlandse bestaande BOM-metadataset blijft volledig en bruikbaar",()=>{
 assert.equal(nlAudio.length,205);assert.equal(nlAudio.reduce((sum,c)=>sum+c.verseStarts.length,0),5781);
 for(const chapter of nlAudio){assert.ok(chapter.url.startsWith("https://"));assert.ok(chapter.verseStarts.length);assert.ok(chapter.verseStarts.every(Number.isFinite));}
});
test("bestandsbeveiliging weigert symlinks, mappen en overgrote bestanden",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"audio-unit-"));
 try{await fs.writeFile(path.join(dir,"plain"),"abcd");await fs.symlink(path.join(dir,"plain"),path.join(dir,"link"));await fs.mkdir(path.join(dir,"nested"));
 assert.equal((await readBounded(path.join(dir,"plain"),4)).toString(),"abcd");
 await assert.rejects(readBounded(path.join(dir,"plain"),3));await assert.rejects(readBounded(path.join(dir,"link"),10));await assert.rejects(readBounded(path.join(dir,"nested"),10));await assert.rejects(safeDirectory(dir,".."));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test("streaming bewaakt Range, veilige integers, HEAD, suffix en no-store",async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),"audio-stream-")),file=path.join(dir,"audio.mp3");await fs.writeFile(file,"0123456789");
 try{const response=await streamAudio(file,"bytes=2-4",true);assert.equal(response.status,206);assert.equal(await response.text(),"234");assert.equal(response.headers.get("cache-control"),"private, no-store");
 const head=await streamAudio(file,null,false);assert.equal(head.headers.get("content-length"),"10");assert.equal(await head.text(),"");
 assert.equal(await (await streamAudio(file,"bytes=-3",true)).text(),"789");
 for(const range of ["bytes=-0","bytes=9-2","bytes=999-","bytes=90071992547409920-","bytes=0-90071992547409920","bytes=0-1,3-4"]){assert.equal((await streamAudio(file,range,true)).status,416);}
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test("gepubliceerde controlemetadata bindt alle doelen aan de echte tekstuitgave en elke uitlijning aan audiobytes",async()=>{
 const inventory=JSON.parse(await fs.readFile("data/audio/official-inventory.json","utf8"));
 const timings=JSON.parse(await fs.readFile("data/audio/official-alignments.json","utf8"));
 const headings=new Map<string,string>((JSON.parse(await fs.readFile("prisma/bomChapterHeadings.json","utf8")) as [string,number,string][]).map(([slug,n,h])=>[`${slug}:${n}`,h]));
 const seeds=new Map<string, {key?:string;slug:string;chapters:{number:number;heading?:string;verses:string[]}[]}[]>();
 const seen=new Set<string>(),referenced=new Set<string>();
 for(const row of inventory.chapters){
  assert.equal(row.editionKey,row.work);assert.equal(row.pageIdentityStatus,"EXACT_LANGUAGE_AND_CHAPTER");assert.equal(row.textStatus,"EXACT_TEXT_MATCH");
  const target=`${row.work}:${row.language}:${row.bookKey}:${row.chapterNumber}`;assert.ok(!seen.has(target));seen.add(target);
  const file=`prisma/${row.prefix}Content${row.language==="nl"?"":"."+row.language}.json`;
  if(!seeds.has(file))seeds.set(file,JSON.parse(await fs.readFile(file,"utf8")));
  const books=seeds.get(file)! as unknown as {key?:string;slug:string;chapters:{number:number;heading?:string;verses:string[]}[]}[];
  const book=books.find(b=>(b.key??BOOK_KEYS_BY_SLUG[b.slug])===row.bookKey)!;
  const ch=book.chapters.find(c=>c.number===row.chapterNumber)!;assert.ok(ch);
  assert.equal(row.sourceHash,chapterSourceHash({heading:row.language==="nl"&&row.prefix==="bom"?headings.get(`${book.slug}:${ch.number}`)??null:ch.heading??null,verses:ch.verses.map((text,i)=>({number:i+1,text}))}));
  for(const recording of row.recordings){
   assert.equal(recording.status,"DOWNLOADED_VALIDATED");assert.ok(recording.bytes>0);assert.ok(recording.duration>0);
   const key=`${recording.sha256}-${row.sourceHash}`;referenced.add(key);
   const alignment=timings.recordings[key];
   if(!alignment){assert.ok(timings.failures[key]);continue;}
   assert.equal(alignment.sha256,recording.sha256);assert.equal(alignment.sourceHash,row.sourceHash);assert.equal(alignment.starts.length,ch.verses.length);
   assert.ok(alignment.starts.every((time:number,i:number)=>Number.isFinite(time)&&time>=0&&time<recording.duration&&(i===0||time>alignment.starts[i-1])));
  }
 }
 assert.equal(seen.size,1965);
 assert.ok([...Object.keys(timings.recordings),...Object.keys(timings.failures)].every(key=>referenced.has(key)));
});
