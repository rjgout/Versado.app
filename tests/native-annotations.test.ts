import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nativeReaderSchema } from "../src/lib/native/readerContract";
import { nativeAnnotationScope,nativeAnnotationContext,nativeAnnotationList,nativeAnnotationMutation,type NativeAnnotationList } from "../src/lib/native/annotationsContract";
import { NativeDataRuntime,nativeAnnotationQueryKey,nativeContentQueryKey } from "../src/lib/data/native";
import { NativeClientError,type NativeSessionClient } from "../src/lib/native/client";
import { serializeKey,type LiveEnvironment } from "../src/lib/data/store";
import { accessRouteAllowed } from "../src/lib/native/access";
const reader=nativeReaderSchema.parse({version:1,userId:"A",activeCollectionId:"bom",selectionVersion:0,language:"nl",courseId:"course",kind:"steps",targetId:"step",chapterId:"chapter",collectionName:"Schriften",bookName:"Alma",chapterNumber:1,sourceLanguage:"nl",startVerse:2,endVerse:3,focusVerse:2,verses:[{id:"verse2",number:2,text:"Twee"},{id:"verse3",number:3,text:"Drie"}]});
const scope=nativeAnnotationScope.parse(reader), empty=nativeAnnotationList.parse({...scope,annotations:[],complete:true});
const actor={id:"A",handle:"Tester",uiLanguage:"nl",onboardingRequired:false,appleLinked:false,passwordLoginEnabled:true};
const row={id:"bookmark",kind:"bookmark" as const,targetKey:"verse:verse2",target:{type:"verse" as const,verseId:"verse2"},mutationVersion:1,deleted:false,anchorStatus:"EXACT"};
const action={kind:"bookmark" as const,target:row.target,expectedVersion:0,actionId:"00000000-0000-4000-8000-000000000001"};
const environment:LiveEnvironment={now:()=>1000,random:()=>0,isOnline:()=>true,isVisible:()=>true,schedule:()=>()=>{}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(api:(path:string)=>Promise<unknown>,write:(path:string,body:unknown)=>Promise<unknown>=async()=>({ ...scope,actionId:action.actionId,changed:true,annotation:row }),env=environment){return new NativeDataRuntime({api,actionOnce:write} as unknown as NativeSessionClient,env);}

test("native annotaties gebruiken bestaande UUID/versie/kleur/notitielimiet en alleen verzen",()=>{
 const base={operation:"put",context:nativeAnnotationContext.parse(reader),action};
 assert.ok(nativeAnnotationMutation.safeParse(base).success);
 for(const color of ["yellow","green","blue","pink","purple"])assert.ok(nativeAnnotationMutation.safeParse({...base,action:{...action,kind:"highlight",color}}).success);
 assert.ok(nativeAnnotationMutation.safeParse({...base,action:{...action,kind:"note",text:"😀".repeat(1000)}}).success);
 for(const extra of [{kind:"highlight",color:"red"},{kind:"note",text:"x".repeat(2001)},{kind:"note",text:" "},{actionId:"not-uuid"},{expectedVersion:-1}])assert.equal(nativeAnnotationMutation.safeParse({...base,action:{...action,...extra}}).success,false);
 assert.equal(nativeAnnotationMutation.safeParse({...base,context:{...base.context,userId:"B"}}).success,false);
 assert.equal(nativeAnnotationMutation.safeParse({...base,operation:"toggle"}).success,false);
 assert.equal(nativeAnnotationList.safeParse({...empty,annotations:[{...row,targetKey:"verse:other"}]}).success,false);
});
test("alleen exact begrensde annotatie-GET/POST-routes, in alle drie bridges",()=>{
 for(const kind of ["steps","chapters"]){
  const path=`courses/c/read/${kind}/target/annotations`;
  for(const p of [path,path+"/verse_1"])assert.equal(accessRouteAllowed(p,"GET"),true);
  assert.equal(accessRouteAllowed(path,"POST"),true);assert.equal(accessRouteAllowed(path+"/verse_1","POST"),false);
  for(const method of ["PUT","PATCH","DELETE","HEAD"])assert.equal(accessRouteAllowed(path,method),false);
  for(const suffix of ["/","?user=B","/verse/extra","/%2f","/../me","\n"])for(const method of ["GET","POST"])assert.equal(accessRouteAllowed(path+suffix,method),false);
 }
 for(const file of ["ios/App/App/NativeAccessTransport.swift","android/app/src/main/java/app/versado/app/NativeAccessTransport.java"])assert.match(readFileSync(file,"utf8"),/annotations\(\?:\/\[A-Za-z0-9_\-\]/);
});
test("annotatiequery-identiteiten scheiden account, bron, taal, cursus en losse versstap",()=>{
 const key=serializeKey(nativeAnnotationQueryKey(reader));
 for(const changed of [{userId:"B"},{activeCollectionId:"other"},{selectionVersion:2},{language:"en" as const},{courseId:"other"},{targetId:"other"},{startVerse:1}])assert.notEqual(serializeKey(nativeAnnotationQueryKey({...reader,...changed})),key);
});
test("late annotatie-GET na epochreset of bronwissel wordt verworpen",async()=>{
 for(const change of ["account","source"]){
  let resolve!:(v:unknown)=>void;
  const runtime=fixture(()=>new Promise(done=>{resolve=done;}));
  const contextKey=["native",0,...nativeContentQueryKey("A")];
  const watch=runtime.store.observe(contextKey,{scopes:["content"],staleTime:Infinity,fetcher:async()=>null,initialData:{picker:{activeCollectionId:"bom",selectionVersion:0}}});
  const pending=runtime.readerAnnotations(reader);
  if(change==="account")runtime.reset();else runtime.store.setData(contextKey,{picker:{activeCollectionId:"other",selectionVersion:1}});
  resolve(empty);await assert.rejects(pending,/session_changed|content_context_changed/);watch.release();runtime.reset();
 }
});
test("misvormde annotatierespons mag geen vreemde vers- of cursusgegevens tonen",async()=>{
 for(const response of [{...empty,userId:"B"},{...empty,courseId:"other"},{...empty,annotations:[{...row,target:{type:"verse",verseId:"outside"},targetKey:"verse:outside"}]}])await assert.rejects(fixture(async()=>response).readerAnnotations(reader));
 let calls=0;await assert.rejects(fixture(async()=>{calls++;return empty;}).readerAnnotations(reader,"outside"),/content_unavailable/);assert.equal(calls,0);
});
test("bevestigde annotatie heeft voorrang op oudere GET; alleen annotations wordt ongeldig",async()=>{
 let resolve!:(v:NativeAnnotationList)=>void,writes=0;
 const runtime=fixture(async()=>actor,async(_path,body)=>{writes++;assert.deepEqual(body,{operation:"put",context:nativeAnnotationContext.parse(reader),action});return {...scope,actionId:action.actionId,changed:true,annotation:row};});
 const key=["native",0,...nativeAnnotationQueryKey(reader)];
 const watcher=runtime.store.observe(key,{scopes:["annotations"],staleTime:Infinity,fetcher:()=>new Promise<NativeAnnotationList>(done=>{resolve=done;}),initialData:empty});
 const pending=runtime.store.refetch(watcher.entryKey);await flush();
 await runtime.mutateReaderAnnotation(reader,action,"PUT");
 resolve(empty);await pending;
 assert.equal(runtime.store.getSnapshot<NativeAnnotationList>(watcher.entryKey).data?.annotations[0].id,"bookmark");assert.equal(writes,1);
 watcher.release();runtime.reset();
});
test("offline/late me, verlopen sessie en onzekere POST sturen nooit automatisch een tweede write",async()=>{
 let writes=0;
 const write=async()=>{writes++;throw new NativeClientError("network_unavailable");};
 const offline=fixture(async()=>actor,write,{...environment,isOnline:()=>false});await assert.rejects(offline.mutateReaderAnnotation(reader,action,"PUT"),/network_unavailable/);assert.equal(writes,0);
 let release!:(v:unknown)=>void;const changed=fixture(()=>new Promise(done=>{release=done;}),write);const pending=changed.mutateReaderAnnotation(reader,action,"PUT");changed.reset();release(actor);await assert.rejects(pending,/session_changed/);assert.equal(writes,0);
 const runtime=fixture(async()=>actor,write);await assert.rejects(runtime.mutateReaderAnnotation(reader,action,"PUT"),/network_unavailable/);runtime.resume();await flush();assert.equal(writes,1);
});
test("late POST-bevestiging mag account B nooit cachedata of opgeslagen-status van A geven",async()=>{
 let release!:(v:unknown)=>void;const runtime=fixture(async()=>actor,()=>new Promise(done=>{release=done;}));
 const pending=runtime.mutateReaderAnnotation(reader,action,"PUT");await flush();runtime.reset();release({...scope,actionId:action.actionId,changed:true,annotation:row});await assert.rejects(pending,/session_changed/);
});
test("web/native gebruiken dezelfde menu- en versbediening zonder webtransport in native presentatie",()=>{
 const read=(p:string)=>readFileSync(p,"utf8");
 for(const p of ["src/components/LessonFlow.tsx","src/components/native/NativeReaderView.tsx"])assert.match(read(p),/useVerseAnnotationMenu/);
 assert.match(read("src/components/annotations/AnnotationActions.tsx"),/<AnnotationActionsView/);
 assert.match(read("src/components/native/NativeReaderView.tsx"),/<AnnotationActionsView/);
 assert.doesNotMatch(read("src/components/annotations/AnnotationActionsView.tsx"),/data\/client|fetchJson|jsonMutation|next\//);
 assert.match(read("src/components/native/NativeFoundation.tsx"),/annotationsEnabled=\{features\.includes\("scripture-annotations-v1"\)\}/);
});

test("een late POST-respons kan een reeds bevestigde nieuwere verwijdering niet in de cache terugdraaien",async()=>{
 let release!:(value:unknown)=>void;
 const runtime=fixture(async()=>actor,()=>new Promise(resolve=>{release=resolve;}));
 const key=["native",0,...nativeAnnotationQueryKey(reader)];
 const watcher=runtime.store.observe(key,{scopes:["annotations"],staleTime:Infinity,fetcher:()=>new Promise<NativeAnnotationList>(()=>{}),initialData:empty});
 const pending=runtime.mutateReaderAnnotation(reader,action,"PUT");await flush();
 runtime.store.setData(key,{...empty,annotations:[{...row,deleted:true,mutationVersion:2}]});
 release({...scope,actionId:action.actionId,changed:true,annotation:row});await pending;
 const current=runtime.store.getSnapshot<NativeAnnotationList>(watcher.entryKey).data!.annotations[0];
 assert.equal(current.mutationVersion,2,"nieuwere GET-versie blijft leidend");assert.equal(current.deleted,true,"verwijderde annotatie verschijnt niet opnieuw");
 watcher.release();runtime.reset();
});
