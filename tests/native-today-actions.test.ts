import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NativeSessionClient, NativeClientError } from "../src/lib/native/client";
import { NativeDataRuntime, nativeTodayQueryKey } from "../src/lib/data/native";
import { serializeKey, type LiveEnvironment } from "../src/lib/data/store";
import { nativeTodayHideSchema, nativeFriendResponseSchema } from "../src/lib/native/todayActionsContract";
import { accessRouteAllowed } from "../src/lib/native/access";
import { todayFixture } from "./fixtures/native-today";
const flush = () => new Promise<void>(r => setImmediate(r));
const itemKey = "course-test:2026-10-31T10:00:00.000Z";
function fixture(actionOnce: (path: string, input: unknown) => Promise<unknown>) {
  let online = true;
  const env: LiveEnvironment = { now: () => 100, random: () => 0, isOnline: () => online, isVisible: () => true, schedule: () => () => {} };
  const runtime = new NativeDataRuntime({ actionOnce } as NativeSessionClient, env), state = todayFixture();
  state.data.continueItems[0].visibilityKey = itemKey;
  return { runtime, state, offline: () => { online = false; }, online: () => { online = true; } };
}
test("B2b contracts allow only their exact POST ports in TS/Swift/Java, no actor or general route", () => {
  for (const path of ["today-actions/hide", "today-actions/friend-response"]) {
    assert.equal(accessRouteAllowed(path,"POST"),true);
    for (const method of ["GET","PUT","DELETE","PATCH","HEAD"]) assert.equal(accessRouteAllowed(path,method),false);
    for (const bad of [path+"/",path+"?id=x",path+"/preview","../"+path,path.replace("/","%2f")]) assert.equal(accessRouteAllowed(bad,"POST"),false);
  }
  for (const path of ["ios/App/App/NativeAccessTransport.swift","android/app/src/main/java/app/versado/app/NativeAccessTransport.java"]) {
    const source=readFileSync(path,"utf8");assert.match(source,/"POST"[^\n]*today-actions\/\(hide\|friend-response\)/);assert.doesNotMatch(source,/path\.startsWith\("today-actions/);
  }
  assert.equal(accessRouteAllowed("today-actions/anything","POST"),false);
  assert.equal(nativeTodayHideSchema.safeParse({itemKey}).success,true);
  for (const input of [{itemKey,userId:"B"},{itemKey:"../../../private"},{itemKey:"x".repeat(101)}]) assert.equal(nativeTodayHideSchema.safeParse(input).success,false);
  for (const input of [{friendshipId:"valid",action:"delete"},{friendshipId:"../other",action:"accept"},{friendshipId:"valid",action:"accept",receiverId:"B"}]) assert.equal(nativeFriendResponseSchema.safeParse(input).success,false);
});
test("actionOnce never refreshes/replays a rejected write; normal read recovery remains unchanged",async()=>{
 let stored:string|null=null;const calls:string[]=[];
 const client=new NativeSessionClient("https://versado.app",{read:async()=>stored,write:async v=>{stored=v;},clear:async()=>{stored=null;}},async url=>{
  const path=String(url).split('/api/v1/native/')[1];calls.push(path);
  return new Response(JSON.stringify(path==='login'?{accessToken:'synthetic',refreshToken:'synthetic-refresh',expiresIn:300}:{error:'session_expired'}),{status:path==='login'?200:401});
 });
 await client.login('synthetic@example.invalid','synthetic');await assert.rejects(client.actionOnce('today-actions/hide',{itemKey}),/session_expired/);
 assert.deepEqual(calls,['login','today-actions/hide']);assert.ok(stored);
});
test("confirmed hide survives an older GET and a failed follow-up read in the sole LiveDataStore",async()=>{
 const f=fixture(async()=>({version:1,userId:'A',outcome:{kind:'hidden',itemKey}}));
 const queryKey=nativeTodayQueryKey(f.state); f.state.language="de"; // Overzichtstaal kan me vóór zijn.
 const key=['native',0,...queryKey];let release!:(v:unknown)=>void,reads=0;
 const observer=f.runtime.store.observe(key,{scopes:['today'],initialData:f.state,fetcher:()=>{reads++;return reads===1?new Promise(r=>{release=r;}):Promise.reject(Error('synthetic GET failure'));}});
 const old=f.runtime.store.refetch(serializeKey(key));await flush();
 await f.runtime.todayActions(f.state,queryKey).hideContinue({visibilityKey:itemKey});
 assert.equal(f.runtime.store.getSnapshot<typeof f.state>(serializeKey(key)).data!.data.continueItems.length,0);
 release(f.state);await old;await flush();assert.equal(reads,2);
 const snapshot=f.runtime.store.getSnapshot<typeof f.state>(serializeKey(key));assert.equal(snapshot.data!.data.continueItems.length,0);assert.ok(snapshot.error);observer.release();f.runtime.reset();
});
test("offline actions are not queued; failed writes preserve data and require explicit retry",async()=>{
 let calls=0,fail=true;const f=fixture(async()=>{calls++;if(fail)throw new NativeClientError('network_unavailable');return {version:1,userId:'A',outcome:{kind:'hidden',itemKey}};});
 const port=f.runtime.todayActions(f.state);f.offline();await assert.rejects(port.hideContinue({visibilityKey:itemKey}),/network_unavailable/);f.online();f.runtime.resume();await flush();assert.equal(calls,0);
 await assert.rejects(port.hideContinue({visibilityKey:itemKey}));f.runtime.resume();await flush();assert.equal(calls,1);fail=false;await port.hideContinue({visibilityKey:itemKey});assert.equal(calls,2);
});
test("duplicate/opposite actions are excluded while pending; late result or old port cannot affect B",async()=>{
 let finish!:(v:unknown)=>void,calls=0;const f=fixture(async()=>{calls++;return new Promise(r=>{finish=r;});});const port=f.runtime.todayActions(f.state);
 const pending=port.respondFriend('friendship','accept');await assert.rejects(port.respondFriend('friendship','decline'),/action_in_progress/);assert.equal(calls,1);
 f.runtime.reset();finish({version:1,userId:'A',outcome:{kind:'friend-response',friendshipId:'friendship',status:'accepted',changed:true}});await assert.rejects(pending,/session_changed/);await assert.rejects(port.hideContinue({visibilityKey:itemKey}),/session_changed/);assert.equal(calls,1);
});
test("a confirmed friend response removes only that pending action; foreign outcomes cannot poison cache",async()=>{
 const f=fixture(async()=>({version:1,userId:'A',outcome:{kind:'friend-response',friendshipId:'incoming',status:'accepted',changed:true}}));
 f.state.data.actions=[{key:'friend-incoming',tab:'required',kind:'friend-request',at:'2026-10-31T10:00:00.000Z',person:{id:'S',handle:'Sender'},subject:'',href:'/friends',actionId:'incoming'}];f.state.data.actionTotal=1;
 const key=['native',0,...nativeTodayQueryKey(f.state)],observer=f.runtime.store.observe(key,{scopes:['today'],initialData:f.state,fetcher:async()=>{throw Error('offline follow-up');}});
 await f.runtime.todayActions(f.state).respondFriend('incoming','accept');await flush();const s=f.runtime.store.getSnapshot<typeof f.state>(serializeKey(key)).data!;assert.equal(s.data.actions.length,0);assert.equal(s.data.actionTotal,0);assert.equal(s.data.continueItems.length,1);assert.ok(f.runtime.store.getSnapshot(serializeKey(key)).error);
 const foreign=fixture(async()=>({version:1,userId:'B',outcome:{kind:'hidden',itemKey}}));await assert.rejects(foreign.runtime.todayActions(foreign.state).hideContinue({visibilityKey:itemKey}),/session_changed/);
 observer.release();f.runtime.reset();
});
