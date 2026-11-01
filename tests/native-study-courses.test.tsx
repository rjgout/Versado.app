import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nativeStudyCourseSchema,nativeStudyStepsSchema } from "../src/lib/native/studyCoursesContract";
import { NativeDataRuntime,nativeContentQueryKey } from "../src/lib/data/native";
import { accessRouteAllowed } from "../src/lib/native/access";
import { nativeRoute } from "../src/lib/native/navigation";
import { serializeKey,type LiveEnvironment } from "../src/lib/data/store";
import type { NativeSessionClient } from "../src/lib/native/client";
const context={version:1 as const,userId:"A",activeCollectionId:"source",selectionVersion:1,language:"nl" as const,courseId:"course"};
const overview={...context,courseName:"CFM",mode:"STEPS",scope:"weeks",today:"2026-11-01",timeZone:"Europe/Amsterdam",weeks:[],groups:[],activeWeekId:null,resumeReason:null,archivedCount:0,truncated:false};
const detail={...context,editionId:"edition",revisionId:"revision",state:{steps:Array.from({length:6},(_,i)=>({index:i+1,fingerprint:`fingerprint${i}`,status:"NOT_STARTED",completedAt:null})),lastOpenedIndex:null,completedCount:0,allCompleted:false},steps:Array.from({length:6},(_,i)=>({index:i+1,fingerprint:`fingerprint${i}`,title:`Stap ${i+1}`,continued:false,labels:[]}))};
test("CFM capability heeft uitsluitend de drie exacte GET-poorten in alle platforms",()=>{
 const allowed=["courses/c/weeks","courses/c/archive","courses/c/weeks/e/steps"];
 for(const path of allowed){assert.equal(accessRouteAllowed(path,"GET"),true);for(const method of ["POST","PUT","DELETE"])assert.equal(accessRouteAllowed(path,method),false);}
 for(const path of ["courses/c/weeks?x=1","courses/c/weeks/e/steps/x","courses/c/weeks/../steps","courses/c/weeks/%61/steps","courses/c/archive/e/steps"])assert.equal(accessRouteAllowed(path,"GET"),false);
 for(const file of ["ios/App/App/NativeAccessTransport.swift","android/app/src/main/java/app/versado/app/NativeAccessTransport.java"])assert.match(readFileSync(file,"utf8"),/courses\/\[A-Za-z0-9_-\]\{1,128\}\/weeks\/\[A-Za-z0-9_-\]\{1,128\}\/steps/);
 for(const [file,pattern] of [["ios/App/App/NativeAccessTransport.swift",/case "GET": pattern = "([^"]+)"/],["android/app/src/main/java/app/versado/app/NativeAccessTransport.java",/if \("GET".equals\(method\)\) return path.matches\("([^"]+)"\)/]] as const) {
  const actual=readFileSync(file,"utf8").match(pattern);assert.ok(actual,file);const expression=new RegExp(`^(?:${actual[1]})$`);for(const path of allowed)assert.ok(expression.test(path));for(const path of ["courses/c/weeks?x=1","courses/c/weeks/../steps","courses/c/weeks/e/steps/x"])assert.equal(expression.test(path),false);
 }
 assert.equal(nativeRoute("/courses/c/archief"),"/courses/c/archief");assert.equal(nativeRoute("/courses/c/archief?x=1"),null);
});
test("versie, zes stappen en afgeschermde publicatie-identiteit worden strikt gevalideerd",()=>{
 assert.ok(nativeStudyCourseSchema.safeParse(overview).success);assert.ok(nativeStudyStepsSchema.safeParse(detail).success);
 for(const patch of [{version:2},{scope:"other"},{groups:[{workKey:"cfm",year:2026,scripture:"other",weeks:[]}]}])assert.equal(nativeStudyCourseSchema.safeParse({...overview,...patch}).success,false);
 for(const patch of [{steps:detail.steps.slice(0,5)},{state:{...detail.state,completedCount:7}},{editionId:"../hidden"}])assert.equal(nativeStudyStepsSchema.safeParse({...detail,...patch}).success,false);
});
test("late CFM-antwoorden kunnen account, bron of publicatierevisie niet overschrijden",async()=>{
 let release!:(value:unknown)=>void;const env:LiveEnvironment={now:()=>0,isOnline:()=>true,isVisible:()=>true,random:()=>0,schedule:()=>()=>{}};
 const runtime=new NativeDataRuntime({api:()=>new Promise(r=>{release=r;})} as unknown as NativeSessionClient,env);
 const old=runtime.studyCourse("A","nl",context,"course","weeks");runtime.reset();release(overview);await assert.rejects(old,/session_changed/);
 const observed=runtime.store.observe(["native",runtime.getSnapshot(),...nativeContentQueryKey("A")],{scopes:["content"],initialData:{picker:context},fetcher:async()=>({picker:context})});
 const pending=runtime.studyCourse("A","nl",context,"course","weeks");runtime.store.setData(["native",runtime.getSnapshot(),...nativeContentQueryKey("A")],{picker:{activeCollectionId:"other",selectionVersion:2}});release(overview);await assert.rejects(pending,/content_context_changed/);
 observed.release();runtime.reset();
 const changed=runtime.studySteps("A","nl",context,"course","edition","new-revision");release(detail);await assert.rejects(changed,/content_context_changed/);runtime.reset();
 assert.notEqual(serializeKey(["steps","revision"]),serializeKey(["steps","new-revision"]));
});
