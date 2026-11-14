import test from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { nativeTodayOverviewSchema } from "../src/lib/native/todayContract";
import { nativeTodayDestination } from "../src/lib/native/todayDestinations";
import { NATIVE_TODAY_ASSETS, nativeTodayImageSource } from "../src/lib/native/todayAssets";
import { NativeDataRuntime, nativeContentQueryKey } from "../src/lib/data/native";
import type { NativeSessionClient } from "../src/lib/native/client";
import { todayFixture } from "./fixtures/native-today";
import { todayRefreshExpiry } from "../src/lib/hymns/sunday";
import { previewStreakContinuation } from "../src/lib/learning/streakReturnRules";
const env={now:()=>0,random:()=>0,isVisible:()=>true,isOnline:()=>true,schedule:()=>()=>{}};
test("versioned read-only contract strips unexpected nested private data and rejects unsafe routes",()=>{
 const fixture=todayFixture();assert.deepEqual(nativeTodayOverviewSchema.parse(fixture),fixture);
 assert.equal("passwordHash" in nativeTodayOverviewSchema.parse({...fixture,data:{...fixture.data,passwordHash:"secret"}}).data,false);
 for(const href of ["https://evil.invalid","//evil.invalid","/lesson/one\n","javascript:alert(1)"]) assert.equal(nativeTodayOverviewSchema.safeParse({...fixture,data:{...fixture.data,dailyText:{...fixture.data.dailyText,href}}}).success,false);
 assert.equal(nativeTodayOverviewSchema.safeParse({...fixture,version:2}).success,false);
});
test("existing course cursors never become the Foundation first-chapter completion route",()=>{
 for(const href of ["/reading-lesson/real-step","/lesson/alma-32?cursus=course","/courses","/study-lesson/a/b/stappen"]) assert.deepEqual(nativeTodayDestination(href),{href:null,phase:"B3"});
 for(const href of ["/profile","/content"]) assert.equal(nativeTodayDestination(href).href,href);
 for(const href of ["//evil.invalid","javascript:alert(1)","https://versado.app/lesson/a"]) assert.equal(nativeTodayDestination(href).href,null);
});
test("late overview after logout/account switch or changed collection is discarded",async()=>{
 let release!:(value:unknown)=>void;const client={api:()=>new Promise(r=>{release=r;})} as unknown as NativeSessionClient;
 const runtime=new NativeDataRuntime(client,env);const request=runtime.todayOverview("A",{activeCollectionId:"source-nl",selectionVersion:1});runtime.reset();release(todayFixture());await assert.rejects(request,/session_changed/);
 const changed = new NativeDataRuntime(client,env);
 const key=["native",0,...nativeContentQueryKey("A")];
 const observer=changed.store.observe(key,{scopes:["content"],fetcher:async()=>({picker:{activeCollectionId:"source-nl",selectionVersion:1}})});
 await new Promise(resolve=>setImmediate(resolve));
 const old=changed.todayOverview("A",{activeCollectionId:"source-nl",selectionVersion:1});
 changed.store.setData(["native",0,...nativeContentQueryKey("A")],{picker:{activeCollectionId:"source-en",selectionVersion:2}});release(todayFixture());await assert.rejects(old,/content_context_changed/);observer.release();
 const wrong=new NativeDataRuntime({api:async()=>todayFixture("B")} as unknown as NativeSessionClient,env);await assert.rejects(wrong.todayOverview("A",{activeCollectionId:"source-nl",selectionVersion:1}),/session_changed/);
 const other=new NativeDataRuntime({api:async()=>todayFixture()} as unknown as NativeSessionClient,env);await assert.rejects(other.todayOverview("A",{activeCollectionId:"source-en",selectionVersion:2}),/content_context_changed/);
});
test("daily expiry uses account timezone and next word release, not a device-clock day",()=>{
 assert.equal(todayRefreshExpiry(new Date("2026-10-31T12:00:00Z"),"Europe/Amsterdam"),"2026-10-31T23:00:00.000Z");
 assert.equal(todayRefreshExpiry(new Date("2026-10-31T12:00:00Z"),"America/Los_Angeles"),"2026-11-01T07:00:00.000Z");
 assert.equal(todayRefreshExpiry(new Date("2026-10-31T12:00:00Z"),"Europe/Amsterdam","2026-10-31T17:00:00.000Z"),"2026-10-31T17:00:00.000Z");
});
test("registered artwork is present locally and private/unregistered media is never fetched as a cookie URL",()=>{
 for(const src of NATIVE_TODAY_ASSETS){assert.ok(statSync(`public${src}`).size>0);assert.equal(nativeTodayImageSource(src),src);}
 for(const src of ["/api/study-media/private","https://evil.invalid/a.png","/images/unregistered.png"]) assert.equal(nativeTodayImageSource(src),null);

});
test("read-only missed-day projection uses the canonical streak plan without changing its input",()=>{
 const state={timeZone:"Europe/Amsterdam",lastStudyDate:"2026-10-27",lastStudyTimeZone:"Europe/Amsterdam",currentStreak:7,freezeCount:1,streakGraceDay:null,streakInterruptedDay:null,streakReturnDay:null,streakReturnTimeZone:null,streakReturnCount:0,streakReturnRequired:0};const before=structuredClone(state);
 const view=previewStreakContinuation(state,new Date("2026-10-31T10:00:00Z"));assert.deepEqual(state,before);assert.equal(view.status,"INTERRUPTED");assert.equal(view.currentStreak,7);assert.equal(view.studiedToday,false);
});
