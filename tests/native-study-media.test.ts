import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { nativeStudyDataUrl, nativeStudyImageSchema, studyMediaIdFromSource, NATIVE_STUDY_IMAGE_MAX_BYTES } from "../src/lib/native/studyMediaContract";
import { NativeDataRuntime, nativeContentQueryKey } from "../src/lib/data/native";
import { accessRouteAllowed } from "../src/lib/native/access";
import type { NativeSessionClient } from "../src/lib/native/client";
import { serializeKey, type LiveEnvironment } from "../src/lib/data/store";
async function image() {
 const bytes=await sharp({create:{width:8,height:8,channels:3,background:"#245ac0"}}).webp().toBuffer(),now=Date.parse("2026-10-31T12:00:00Z");
 return {version:1 as const,userId:"A",mediaId:"cover",selectionVersion:1,serverNow:now,expiresAt:new Date(now+60_000).toISOString(),mimeType:"image/webp" as const,width:8,height:8,byteSize:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),sourceChecksum:"a".repeat(64),base64:bytes.toString("base64")};
}
const expected={userId:"A",activeCollectionId:"source-nl",selectionVersion:1};
function fixture(api:(path:string)=>Promise<unknown>){
 let online=true,now=100;const env:LiveEnvironment={now:()=>now,isOnline:()=>online,isVisible:()=>true,random:()=>0,schedule:()=>()=>{}};
 const runtime=new NativeDataRuntime({api} as NativeSessionClient,env),context=runtime.store.observe(["native",0,...nativeContentQueryKey("A")],{scopes:["content"],initialData:{userId:"A",picker:expected},fetcher:async()=>({userId:"A",picker:expected})});
 return {runtime,context,env,age:(ms:number)=>{now+=ms;},offline:()=>{online=false;}};
}
test("only exact GET media IDs are permitted in TS, Swift and Java; no URL, query, traversal or preview",()=>{
 assert.equal(accessRouteAllowed("study-media/cover_1-2","GET"),true);
 for(const method of ["POST","DELETE","PUT","PATCH","HEAD"])assert.equal(accessRouteAllowed("study-media/cover",""+method),false);
 for(const src of ["/api/study-media/cover?token=secret","/api/study-media/../secret","/api/study-media/%2fsecret","https://example.invalid/a.png","//evil.invalid/x","/api/admin/study-media/cover"]){assert.equal(studyMediaIdFromSource(src),null);assert.equal(accessRouteAllowed(src.replace('/api/',''),"GET"),false);}
 assert.equal(studyMediaIdFromSource("/api/study-media/cover"),"cover");
 for(const path of ["ios/App/App/NativeAccessTransport.swift","android/app/src/main/java/app/versado/app/NativeAccessTransport.java"]){const source=readFileSync(path,"utf8");assert.match(source,/"GET"[^\n]*\(chapters\|study-media\)\//);assert.doesNotMatch(source,/"POST"[^\n]*study-media/);}
});
test("bounded image contract checks base64 length, real WebP signature/length and SHA-256 before rendering",async()=>{
 const value=await image(),url=await nativeStudyDataUrl(value);assert.match(url.src,/^data:image\/webp;base64,/);assert.equal(url.userId,"A");assert.equal(NATIVE_STUDY_IMAGE_MAX_BYTES,262144);
 for(const patch of [{sha256:"0".repeat(64)},{byteSize:value.byteSize+1},{base64:Buffer.from("not a webp image").toString("base64")}])await assert.rejects(nativeStudyDataUrl({...value,...patch}));
 for(const patch of [{mimeType:"image/svg+xml"},{byteSize:NATIVE_STUDY_IMAGE_MAX_BYTES+1},{width:641},{expiresAt:new Date(value.serverNow+60_001).toISOString()},{url:"https://evil.invalid/secret"},{base64:"x".repeat(400000)}])assert.equal(nativeStudyImageSchema.safeParse({...value,...patch}).success,false);
});
test("shared media queries deduplicate; invalidation purges protected bytes before a denied recheck",async()=>{
 const value=await image();let calls=0,deny=false;const f=fixture(async path=>{assert.equal(path,"study-media/cover");calls++;if(deny)throw Error("media_unavailable");return value;});
 const key=["native",0,"study-media","A","source-nl",1,"cover"],options={scopes:["studyContent","content"] as const,discardOnRevalidate:true,fetcher:()=>f.runtime.studyImage("cover",expected)};
 const a=f.runtime.store.observe(key,options),b=f.runtime.store.observe(key,options);
 // Wacht op dezelfde lopende query, inclusief WebCrypto; eventlooprondes zijn
 // geen voltooiingsbewijs. Ook deze derde afnemer moet dedupliceren.
 await f.runtime.store.refetch(serializeKey(key));assert.equal(calls,1);assert.ok(f.runtime.store.getSnapshot<{src:string}>(serializeKey(key)).data?.src.startsWith('data:'));
 deny=true;f.runtime.store.invalidate(["studyContent"]);assert.equal(f.runtime.store.getSnapshot(serializeKey(key)).data,undefined);await f.runtime.store.refetch(serializeKey(key));assert.equal(calls,2);assert.equal(f.runtime.store.getSnapshot(serializeKey(key)).data,undefined);assert.ok(f.runtime.store.getSnapshot(serializeKey(key)).error);a.release();b.release();f.context.release();f.runtime.reset();
});
test("late decoded images and old content identities never populate the next account/source",async()=>{
 let release!:(v:unknown)=>void;const value=await image(),f=fixture(()=>new Promise(r=>{release=r;}));
 const pending=f.runtime.studyImage("cover",expected);f.runtime.reset();release(value);await assert.rejects(pending,/session_changed/);
 const other=fixture(()=>new Promise(r=>{release=r;}));const old=other.runtime.studyImage("cover",expected);
 other.runtime.store.setData(["native",0,...nativeContentQueryKey("A")],{userId:"A",picker:{...expected,activeCollectionId:"source-en",selectionVersion:2}});release(value);await assert.rejects(old,/content_context_changed/);
 other.context.release();other.runtime.reset();f.context.release();
});

test("network/decode waiting never extends the protected cache validity window",async()=>{
 const value=await image();let release!:(v:unknown)=>void;
 const f=fixture(()=>new Promise(r=>{release=r;})),pending=f.runtime.studyImage("cover",expected);f.age(1000);release(value);assert.equal((await pending).validUntil,60100);f.context.release();f.runtime.reset();
 const late=fixture(()=>new Promise(r=>{release=r;})),old=late.runtime.studyImage("cover",expected);late.age(60_001);release(value);await assert.rejects(old,/media_expired/);late.context.release();late.runtime.reset();
});
