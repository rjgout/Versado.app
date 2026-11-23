import {isFocusRoute,isActivityRoute} from "../src/lib/focusMode.ts";
import {classifyContentRoute} from "../src/lib/contentRouting.ts";
import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {folderRoute,folderMutation,folderRefPath} from "../src/lib/native/studyFolderContract.ts";
import {accessRouteAllowed} from "../src/lib/native/access.ts";
import {nativeRoute,nativeDeepLink} from "../src/lib/native/navigation.ts";
import {nativeBackFallback} from "../src/lib/native/backTarget.ts";
import {NativeDataRuntime} from "../src/lib/data/native.ts";
import {NativeClientError} from "../src/lib/native/client.ts";
import {serializeKey} from "../src/lib/data/store.ts";
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),"utf8");
test("narrow transport and local passage routes; no private query strings or arbitrary source destinations",()=>{
 for(const [path,method] of [["study-folder/query","POST"],["study-folder/annotations","POST"],["study-folder/note/own_1/annotations","GET"],["study-folder/highlight/own-2/passage","GET"]]){assert.ok(folderRoute(path,method));assert.ok(accessRouteAllowed(path,method));}
 for(const path of ["study-folder/query?q=secret","study-folder/query\n","study-folder/note/x/passage\n","study-folder/note/x/passage/extra","study-folder/note/x%2Fy/passage","study-folder/admin/x/passage","study-folder/../me"]){assert.equal(folderRoute(path,"GET"),null);assert.equal(accessRouteAllowed(path,"POST"),false);}
 assert.equal(accessRouteAllowed("study-folder/query","GET"),false);assert.equal(accessRouteAllowed("study-folder/note/x/annotations","DELETE"),false);
 for(const path of ["/study-folder","/study-folder/note/abc_1"]){assert.equal(nativeRoute(path),path);assert.equal(isFocusRoute(path),true);assert.equal(isActivityRoute(path),false);assert.deepEqual(classifyContentRoute(path),{kind:"neutral"});assert.equal(nativeDeepLink(`https://api-test.versado.app${path}`,"https://api-test.versado.app"),path);}
 for(const path of ["/study-folder?q=PRIVATE","/study-folder/note/x?verse=2","/study-folder/other/x","/study-folder/note/x%2Fy"])assert.equal(nativeRoute(path),null);
 assert.equal(nativeBackFallback("/study-folder",[]),"/content");assert.equal(nativeBackFallback("/study-folder/note/x",[]),"/study-folder");
});
test("folder item identity is projected before strict transport validation",()=>{
 assert.equal(folderRefPath({kind:"note",id:"own_1",targetKey:"verse:v"}),"note/own_1");
 const request={ref:{kind:"note",id:"own_1",targetKey:"verse:v"},targetKey:"verse:v",operation:"delete",action:{kind:"note",expectedVersion:1,actionId:randomUUID()}};
 assert.equal(folderMutation.safeParse(request).success,false);
});
test("Swift and Android retain exactly bounded folder endpoints alongside TS",()=>{
 for(const file of ["ios/App/App/NativeAccessTransport.swift","android/app/src/main/java/app/versado/app/NativeAccessTransport.java"]){const source=read(file);assert.ok(source.includes("study-folder/(?:bookmark|highlight|note)/[A-Za-z0-9_-]{1,128}/(?:annotations|passage)"));assert.ok(source.includes("study-folder/(?:query|annotations)"));assert.ok(!source.includes("study-folder/.*"));}
});
function fixture(api){let stamp="account-a",online=true,writes=0;const client={getSessionStamp:()=>stamp,api,actionOnce:async()=>{writes++;throw new NativeClientError("network_unavailable");}};const environment={now:()=>0,isOnline:()=>online,isVisible:()=>true,random:()=>0,schedule:()=>()=>{}};const runtime=new NativeDataRuntime(client,environment);return {runtime,client,stamp:value=>{stamp=value;},offline:()=>{online=false;},writes:()=>writes};}
test("late query cannot cross logout/reset or session stamp; no second private cache",async()=>{
 let resolve;const f=fixture(()=>new Promise(done=>{resolve=done;}));
 const query=f.runtime.studyFolder("user-a",{});f.runtime.reset();resolve({version:1,userId:"user-a",data:{items:[],nextCursor:null}});await assert.rejects(query,/session_changed/);
 const next=f.runtime.studyFolder("user-a",{});f.stamp("account-b");resolve({version:1,userId:"user-a",data:{items:[],nextCursor:null}});await assert.rejects(next,/session_changed/);
 const key=[...f.runtime.sharedQueryPrefix(),"studyFolder","loadedPages"],entry=serializeKey(key),unsubscribe=f.runtime.store.subscribe(entry,()=>{});f.runtime.store.setData(key,{private:"memory only"});assert.ok(f.runtime.store.getSnapshot(entry).data);f.runtime.reset();assert.equal(f.runtime.store.getSnapshot(entry).data,undefined);unsubscribe();
});
test("wrong account and response discriminant rejected; session revocation clears private memory without a reset/retry loop for edge denials",async()=>{
 const wrong=fixture(async()=>({version:1,userId:"other-user",data:{items:[],nextCursor:null}}));await assert.rejects(wrong.runtime.studyFolder("user-a",{}),/session_changed/);
 const shape=fixture(async()=>({version:1,userId:"user-a",data:{sources:[]}}));await assert.rejects(shape.runtime.studyFolder("user-a",{}),/invalid_response/);
 for(const status of [401,403]){const denied=fixture(async()=>{throw new NativeClientError("session_expired",status);});await assert.rejects(denied.runtime.studyFolder("user-a",{}));assert.equal(denied.runtime.getSnapshot(),status===401?1:0);}
});
test("offline writes never reach transport, target/selector cannot be forged in the wire request",async()=>{
 const f=fixture(async()=>{throw Error("offline must not request account");});f.offline();await assert.rejects(f.runtime.mutateFolderAnnotation("u",{kind:"note",id:"n"},{kind:"note",target:{type:"verse",verseId:"v"},expectedVersion:1,actionId:randomUUID(),text:"private"},"PUT"),/network_unavailable/);assert.equal(f.writes(),0);
 const input={ref:{kind:"note",id:"n"},targetKey:"verse:v",operation:"put",action:{kind:"note",expectedVersion:1,actionId:randomUUID(),text:"private"}};assert.ok(folderMutation.safeParse(input).success);assert.equal(folderMutation.safeParse({...input,action:{...input.action,target:{type:"verse",verseId:"other"}}}).success,false);
});
test("the shared folder has no Next, cookie or private persistent storage dependency",()=>{
 const source=read("src/components/study-folder/StudyFolderClient.tsx");assert.doesNotMatch(source,/next\/|localStorage|sessionStorage|new Map|document\.cookie/);assert.match(source,/renderEditor/);assert.match(source,/discardOnRevalidate=false/);
 const native=read("src/components/native/NativeStudyFolder.tsx");assert.doesNotMatch(native,/location\.(?:assign|href)|localStorage|sessionStorage|setInterval/);assert.match(native,/studyFolderQuery\.parse/);assert.match(native,/<StudyFolderClient discardOnRevalidate /);
});
