import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeDataRuntime,nativeAnnotationQueryKey} from '../src/lib/data/native.ts';
import {nativeGameAnnotationScope,nativeGameAnnotationList,gameAnnotationRoute} from '../src/lib/native/annotationsContract.ts';
import {nativeGameAudioSelection} from '../src/lib/native/gamesAudioContract.ts';
import {accessRouteAllowed} from '../src/lib/native/access.ts';
const reader=nativeGameAudioSelection.parse({version:1,userId:'A',activeCollectionId:'source',selectionVersion:0,language:'nl',game:{kind:'reading',id:'chapter'},chapterId:'chapter',bookName:'Boek',chapterNumber:1,sourceLanguage:'nl',startVerse:1,endVerse:1,focusVerse:1,verses:[{id:'verse',number:1,text:'Tekst'}]});
const scope=nativeGameAnnotationScope.parse(reader),empty=nativeGameAnnotationList.parse({...scope,annotations:[],complete:true});
const action={kind:'bookmark',target:{type:'verse',verseId:'verse'},expectedVersion:0,actionId:'00000000-0000-4000-8000-000000000001'};
const row={id:'bookmark',kind:'bookmark',targetKey:'verse:verse',target:action.target,mutationVersion:1,deleted:false,anchorStatus:'EXACT'};
const env={now:()=>1000,random:()=>0,isOnline:()=>true,isVisible:()=>true,schedule:()=>()=>{}};
const actor={id:'A',handle:'Tester',uiLanguage:'nl',onboardingRequired:false,appleLinked:false,passwordLoginEnabled:true};
function fixture(api=async()=>actor,actionOnce=async()=>({...scope,actionId:action.actionId,changed:true,annotation:row})){return new NativeDataRuntime({api,actionOnce,getSessionStamp:()=> 'synthetic'},env);}
test('vrije spelreader heeft uitsluitend dezelfde begrensde annotatie-GET/POST, geen algemene writepoort',()=>{
 const path='games/reading/chapter/annotations';
 for(const [value,method] of [[path,'GET'],[path+'/verse','GET'],[path,'POST']]){assert.ok(gameAnnotationRoute(value,method));assert.ok(accessRouteAllowed(value,method));}
 for(const [value,method] of [[path+'/verse','POST'],[path,'PUT'],[path,'DELETE'],[path+'?user=B','GET'],['games/annotations?view=reader&chapterId=chapter','GET'],['games/intro-solo/run/annotations','POST']]){assert.equal(gameAnnotationRoute(value,method),null);assert.equal(accessRouteAllowed(value,method),false);}
});
test('spelannotaties weigeren vreemde actor, bron, hoofdstuk en vers',async()=>{
 for(const response of [{...empty,userId:'B'},{...empty,selectionVersion:1},{...empty,game:{kind:'reading',id:'other'}},{...empty,annotations:[{...row,target:{type:'verse',verseId:'outside'},targetKey:'verse:outside'}]}])await assert.rejects(fixture(async()=>response).readerAnnotations(reader));
 let calls=0;await assert.rejects(fixture(async()=>{calls++;return empty;}).readerAnnotations(reader,'outside'));assert.equal(calls,0);
});
test('spelreader deelt één live-store en beschermt bevestigde tombstones tegen oudere GET en POST',async()=>{
 let release;const runtime=fixture(undefined,()=>new Promise(resolve=>{release=resolve;}));
 const key=[...runtime.sharedQueryPrefix(),...nativeAnnotationQueryKey(reader)];
 const watch=runtime.store.observe(key,{scopes:['annotations'],staleTime:Infinity,fetcher:()=>new Promise(()=>{}),initialData:empty});
 const pending=runtime.mutateReaderAnnotation(reader,action,'PUT');await new Promise(resolve=>setImmediate(resolve));
 runtime.store.setData(key,{...empty,annotations:[{...row,mutationVersion:2,deleted:true}]});
 release({...scope,actionId:action.actionId,changed:true,annotation:row});await pending;
 const current=runtime.store.getSnapshot(watch.entryKey).data.annotations[0];assert.equal(current.deleted,true);assert.equal(current.mutationVersion,2);
 watch.release();runtime.reset();
});
test('late spelannotatie-POST na accountwisseling wordt geweigerd en nooit opnieuw verstuurd',async()=>{
 let release,writes=0;const runtime=fixture(undefined,()=>{writes++;return new Promise(resolve=>{release=resolve;});});
 const pending=runtime.mutateReaderAnnotation(reader,action,'PUT');await new Promise(resolve=>setImmediate(resolve));runtime.reset();release({...scope,actionId:action.actionId,changed:true,annotation:row});await assert.rejects(pending,/session_changed/);assert.equal(writes,1);
});
