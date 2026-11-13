import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nProvider } from "../src/components/I18nProvider";
import { AppNavigationProvider,type AppLinkProps } from "../src/components/navigation/AppNavigation";
import { AchievementsView,CompetitionView } from "../src/components/profile/ProfileContentViews";
import { nativeStaticAssets } from "../scripts/native/assets";
import ProfileOverview from "../src/components/profile/ProfileOverview";
import ProfilePageView from "../src/components/profile/ProfilePageView";
import { twoFactorCommand } from "../src/lib/account/twoFactorContract";
import { NativeDataRuntime } from "../src/lib/data/native";
import type { LiveEnvironment } from "../src/lib/data/store";
import { getT,messagesFor } from "../src/lib/i18n";
import { LANGUAGES } from "../src/lib/languages";
import { accessRouteAllowed } from "../src/lib/native/access";
import { NativeClientError,NativeSessionClient } from "../src/lib/native/client";
import { nativeDeepLink,nativeRoute } from "../src/lib/native/navigation";
import { nativeProfileImageSource } from "../src/lib/native/profileAssets";
import { nativeProfileAction,nativeProfileSchema } from "../src/lib/native/profileContract";
import { PROFILE_VIEWS,profileViewHref } from "../src/lib/profileViews";
import { profileFixture } from "./fixtures/native-profile";

const env:LiveEnvironment={now:()=>1000,random:()=>0,isVisible:()=>true,isOnline:()=>true,schedule:()=>()=>{}};
const noop=()=>{}, done=async()=>{};
function fixture(reply:()=>Promise<unknown>){
 let calls=0,stamp="session-a";
 const runtime=new NativeDataRuntime({getSessionStamp:()=>stamp,api:async()=>{calls++;return reply();},actionOnce:async()=>{calls++;return reply();}} as unknown as NativeSessionClient,env);
 return {runtime,calls:()=>calls,switch:(next="session-b")=>{stamp=next;runtime.reset();}};
}
test("profielcontract blijft eigenaargebonden en weigert vreemde of beveiligingsvelden",()=>{
 const value=profileFixture();assert.deepEqual(nativeProfileSchema.parse(value),value);
 assert.throws(()=>nativeProfileSchema.parse({...value,userId:"ander"}));
 assert.throws(()=>nativeProfileSchema.parse({...value,profile:{...value.profile,passwordHash:"forbidden"}}));
 for(const key of ["userId","isAdmin","passwordHash","sessionVersion","totpEnabled","totpSecretEncrypted","nativeSession"]){
  assert.throws(()=>nativeProfileAction.parse({kind:"settings",patch:{[key]:true}}),key);
 }
 for(const patch of [{},{incognitoHours:1000},{timeZone:"+01:00"},{uiLanguage:"unknown"},{handle:"a"}])assert.throws(()=>nativeProfileAction.parse({kind:"settings",patch}));
 assert.throws(()=>nativeProfileAction.parse({kind:"featured-achievements",achievementIds:["same","same"]}));
 assert.throws(()=>twoFactorCommand.parse({kind:"disable",code:"code",userId:"ander"}));
 assert.throws(()=>twoFactorCommand.parse({kind:"verify",code:""}));
});
test("alleen echte profielroutes en één bekende view-query zijn navigeerbaar",()=>{
 for(const view of Object.keys(PROFILE_VIEWS) as (keyof typeof PROFILE_VIEWS)[])assert.equal(nativeRoute(profileViewHref(view)),profileViewHref(view));
 assert.equal(nativeRoute("/profile/avatar"),"/profile/avatar");
 for(const raw of ["/profile?view=privacy&token=secret","/profile?view=privacy&view=presence","/profile?view=%70rivacy","/profile?view=unknown","/profile/avatar?owner=ander","/profile?next=/adminbackend","/profile?token=secret"]){assert.equal(nativeRoute(raw),null,raw);}
 assert.equal(nativeDeepLink("https://api-test.versado.app/profile?view=privacy","https://api-test.versado.app"),"/profile?view=privacy");
 assert.equal(nativeDeepLink("https://versado.app/profile?view=privacy","https://api-test.versado.app"),null);
});
test("de exacte profielpoorten laten geen admin-, web-, query- of extra subroutes door",()=>{
 assert.equal(accessRouteAllowed("profile","GET"),true);assert.equal(accessRouteAllowed("profile","POST"),true);
 assert.equal(accessRouteAllowed("profile/two-factor","POST"),true);
 for(const path of ["profile/two-factor/disable","profile?userId=ander","profile/","account/totp/disable","../profile","profile%2ftwo-factor"]){for(const method of ["GET","POST"])assert.equal(accessRouteAllowed(path,method),false,method+path);}
 for(const method of ["PUT","PATCH","DELETE","HEAD"])assert.equal(accessRouteAllowed("profile",method),false);
 assert.equal(accessRouteAllowed("profile/two-factor","GET"),false);
 for(const file of ["ios/App/App/NativeAccessTransport.swift","android/app/src/main/java/app/versado/app/NativeAccessTransport.java"]){const source=readFileSync(file,"utf8");assert.ok(source.includes("profile(?:/two-factor)?"),file);}
});
test("een late actie van A, ook na A-B-A, wordt vóór de netwerkgrens geweigerd",async()=>{
 const f=fixture(async()=>({version:1,userId:profileFixture().userId,ok:true}));
 const port=f.runtime.profileActions(profileFixture().userId);
 for(const next of ["session-b","session-a"]){
  f.switch(next);
  for(const execute of [()=>port.read(),()=>port.mutate({kind:"reading-reset"}),()=>port.twoFactor({kind:"setup"}),()=>port.logoutAll()])await assert.rejects(execute(),/session_changed/);
 }
 assert.equal(f.calls(),0);
});
test("late antwoorden na logout vullen de profielcache niet en vreemde eigenaars worden geweigerd",async()=>{
 let resolve!:(value:unknown)=>void;const f=fixture(()=>new Promise(r=>{resolve=r;}));
 const read=f.runtime.profileActions(profileFixture().userId).read();f.switch();resolve(profileFixture());await assert.rejects(read,/session_changed/);
 const foreign=fixture(async()=>profileFixture({id:"ander"}));await assert.rejects(foreign.runtime.profileActions(profileFixture().userId).read(),/session_changed/);
});
test("mislukte profielmutaties worden één keer verstuurd en nooit als succes gesignaleerd",async()=>{
 const f=fixture(async()=>{throw new NativeClientError("network_unavailable");});
 await assert.rejects(f.runtime.profileActions(profileFixture().userId).mutate({kind:"settings",patch:{shareOnlineStatus:false}}),/network_unavailable/);
 assert.equal(f.calls(),1);
});
test("bevestigde privacy-/aanwezigheidswijzigingen signaleren alleen de bestaande verbonden socket",async()=>{
 const userId=profileFixture().userId,f=fixture(async()=>({version:1,userId,ok:true})),events:string[]=[];
 const socket={connected:true,on:()=>socket,off:()=>socket,emit:(event:string)=>{events.push(event);return socket;}};
 const detach=f.runtime.attachSocket(socket as never),port=f.runtime.profileActions(userId);
 await port.mutate({kind:"settings",patch:{shareAchievements:true}});await port.mutate({kind:"settings",patch:{shareOnlineStatus:false}});
 assert.deepEqual(events,["friend_profile_changed","presence_settings_changed"]);
 socket.connected=false;await port.mutate({kind:"settings",patch:{shareAchievements:false}});assert.equal(events.length,2);
 f.switch();await assert.rejects(port.mutate({kind:"settings",patch:{shareAchievements:true}}),/session_changed/);assert.equal(events.length,2);detach();
});
test("dezelfde profielrenderer toont gegevens en alle instellingen in vijf talen zonder dode native links",()=>{
 const navigation={pathname:"/profile",push:noop,replace:noop,back:noop,refresh:noop,canGoBack:()=>true,Link:({href,children,...props}:AppLinkProps)=>createElement("a",{...props,href},children)};
 for(const language of LANGUAGES){
  const value=profileFixture({uiLanguage:language.code});
  const html=renderToStaticMarkup(<I18nProvider language={language.code} messages={messagesFor(language.code)}><AppNavigationProvider adapter={{...navigation,imageSource:src=>nativeProfileImageSource(src)??src}}><ProfileOverview data={value.profile} editingHandle={false} handleInput="" savingHandle={false} handleError={null} startEditingHandle={noop} setHandleInput={noop} setEditingHandle={noop} saveHandle={done} openView={noop} savingNotifications={false} toggleCategory={done} logout={done} deleteAccount={noop} timeZone={language.code} canNavigate={href=>nativeRoute(href)!==null}/></AppNavigationProvider></I18nProvider>);
  assert.ok(html.includes("Profielwerker"));assert.ok(html.includes("12345"));assert.ok(html.includes("/native-profile/"));
  assert.ok(html.includes(getT(language.code)("profile.privacy")));assert.ok(html.includes(getT(language.code)("languageSettings.title")));
  assert.ok(!html.includes('href="/adminbackend"'));assert.ok(!html.includes('href="/shop"'));
  for(const match of html.matchAll(/<a[^>]+href="([^"]+)"/g))assert.ok(nativeRoute(match[1]),match[1]);
 }
});
test("gedeelde profielshell toont juridische footer uitsluitend op het overzicht",()=>{
 const navigation={pathname:"/profile",push:noop,replace:noop,back:noop,refresh:noop,canGoBack:()=>true,Link:({href,children}:AppLinkProps)=>createElement("a",{href},children)};
 for(const overview of [true,false]){
  const html=renderToStaticMarkup(<I18nProvider language="nl" messages={messagesFor("nl")}><AppNavigationProvider adapter={navigation}><ProfilePageView overview={overview}>Profiel</ProfilePageView></AppNavigationProvider></I18nProvider>);
  assert.equal(html.includes("<footer"),overview);assert.equal(html.includes('href="/privacy"'),overview);
 }
});

test("alle beelden uit de echte prestatie-/competitierenderers worden lokaal verpakt",()=>{
 const navigation={pathname:"/profile",push:noop,replace:noop,back:noop,refresh:noop,canGoBack:()=>true,Link:({href,children}:AppLinkProps)=>createElement("a",{href},children)};
 const profile=profileFixture().profile;
 profile.achievements=["first-chapter","perfect-chapter","first-friend","first-duel-won"].map(slug=>({id:slug,slug,name:slug,description:"Synthetisch",icon:"",earnedAt:null}));
 const html=renderToStaticMarkup(<I18nProvider language="nl" messages={messagesFor("nl")}><AppNavigationProvider adapter={navigation}><CompetitionView data={profile}/><AchievementsView data={profile} onSaveFeatured={done}/></AppNavigationProvider></I18nProvider>);
 const images=[...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(match=>match[1]);assert.ok(images.length>=7);
 const packaged=new Set(nativeStaticAssets());for(const src of images)assert.ok(packaged.has(src),`Ontbrekend verpakt profielbeeld: ${src}`);
});

test("globale logout weigert late antwoorden na RAM-reset of A-B-A en herhaalt geen onbekende uitkomst",async()=>{
 const userId=profileFixture().userId;
 let resolve!:(value:unknown)=>void;const f=fixture(()=>new Promise(r=>{resolve=r;}));
 const terminal=f.runtime.profileActions(userId).logoutAll();f.runtime.reset();resolve({version:1,userId,ok:true});await assert.rejects(terminal,/session_changed/);assert.equal(f.calls(),1);
 const g=fixture(()=>new Promise(r=>{resolve=r;}));const old=g.runtime.profileActions(userId).logoutAll();g.switch();g.switch("session-a");resolve({version:1,userId,ok:true});await assert.rejects(old,/session_changed/);assert.equal(g.calls(),1);
 const offline=fixture(async()=>{throw new NativeClientError("network_unavailable");});await assert.rejects(offline.runtime.profileActions(userId).logoutAll(),/network_unavailable/);assert.equal(offline.calls(),1);
 assert.throws(()=>nativeProfileAction.parse({kind:"logout-all",userId:"ander"}));
});
