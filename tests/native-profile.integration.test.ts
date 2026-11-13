import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test,{ after } from "node:test";
import { logoutAccount } from "../src/lib/account/logout";
import { createSessionToken,hashPassword } from "../src/lib/auth";
import { prisma } from "../src/lib/db";
import { nativeProfileSchema } from "../src/lib/native/profileContract";
import { issueNativeSession,nativeSessionIdentity } from "../src/lib/native/sessions";
import { patchProfileSettings } from "../src/lib/profile/settings";
import { encryptTotpSecret,generateTotpCode,generateTotpSecret } from "../src/lib/totp";

const database=new URL(process.env.NATIVE_TEST_DATABASE_URL??"http://invalid");
if(database.hostname!=="127.0.0.1" || database.pathname!=="/versado_content_access_test" || database.href!==process.env.DATABASE_URL)throw Error("Alleen eigen geïsoleerde database");
const base=process.env.NATIVE_TEST_BASE_URL!,passwordHash=await hashPassword("Synthetic-profile-42");
async function account(extra:Record<string,unknown>={}){
 const user=await prisma.user.create({data:{email:`profile-${randomUUID()}@example.invalid`,handle:`Profiel${randomUUID().slice(0,8)}`,discriminator:"42",passwordHash,emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),avatarCharacterId:"nephi",...extra}});
 return {user,pair:await issueNativeSession(user.id,user.sessionVersion),cookie:await createSessionToken(user.id)};
}
let request=0;
async function call(path:string,token?:string,body?:unknown,extra:Record<string,string>={}){
 const response=await fetch(`${base}/api/v1/native/${path}`,{method:body===undefined?"GET":"POST",headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1","x-real-ip":`127.0.0.${40+request++%180}`,...(token?{Authorization:`Bearer ${token}`}:{}) ,...(body===undefined?{}:{"Content-Type":"application/json"}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
 return {response,data:await response.json()};
}
async function profile(token:string){const result=await call("profile",token);assert.equal(result.response.status,200,JSON.stringify(result.data));return nativeProfileSchema.parse(result.data);}
after(async()=>{await prisma.$disconnect();const shared=globalThis as typeof globalThis&{__versadoAuthBudget?:Promise<{disconnect():void}>};await shared.__versadoAuthBudget?.then(client=>client.disconnect()).catch(()=>{});});

test("native profiel is dezelfde eigenaargebonden webaggregatie, zonder secrets, cookies of Bearer-fallback",async()=>{
 const a=await account({xpTotal:123,currentStreak:3,shareAchievements:true}),b=await account({email:"private-"+randomUUID()+"@example.invalid"});
 const native=await call("profile",a.pair.accessToken);assert.equal(native.response.status,200);
 assert.equal(native.response.headers.get("cache-control"),"private, no-store");assert.equal(native.response.headers.get("set-cookie"),null);
 const state=nativeProfileSchema.parse(native.data);assert.equal(state.userId,a.user.id);assert.equal(state.profile.email,a.user.email);
 const web=await fetch(`${base}/api/profile`,{headers:{Cookie:`bvm_session=${a.cookie}`}});assert.equal(web.status,200);assert.deepEqual(state.profile,await web.json());
 const text=JSON.stringify(native.data);for(const secret of [a.user.passwordHash,a.pair.accessToken,a.pair.refreshToken,b.user.email])assert.ok(!text.includes(secret));
 for(const key of ["passwordHash","sessionVersion","totpSecretEncrypted","totpRecoveryCodes","refreshTokenHash"])assert.ok(!text.includes(key));
 assert.equal((await call("profile",undefined,undefined,{Cookie:`bvm_session=${a.cookie}`})).response.status,401);
 assert.equal((await call("profile",a.cookie)).response.status,401);
 assert.equal((await fetch(`${base}/api/profile`,{headers:{Authorization:`Bearer ${a.pair.accessToken}`}})).status,401);
 assert.equal((await call("profile",a.pair.accessToken,undefined,{Origin:"https://evil.invalid"})).response.status,403);
 assert.equal((await call("profile?userId="+b.user.id,a.pair.accessToken)).response.status,400);
});
test("profielmutaties delen webregels, behouden andermans gegevens en weigeren beveiligingsvelden",async()=>{
 const a=await account(),b=await account({handle:"Profiel gewijz"}),beforeB=await prisma.user.findUniqueOrThrow({where:{id:b.user.id}});
 const saved=await call("profile",a.pair.accessToken,{kind:"settings",patch:{handle:"Profiel gewijz",shareAchievements:true,sharePuzzleRecords:true,searchableByEmail:true,companion:"varo",uiLanguage:"en",dailyReminderTime:"21:30",shareOnlineStatus:false,shareCurrentActivity:false,incognitoHours:1}});
 assert.equal(saved.response.status,200,JSON.stringify(saved.data));
 const current=await profile(a.pair.accessToken);assert.equal(current.profile.handle,"Profiel gewijz");assert.equal(current.profile.displayName,"Profiel gewijz");assert.notEqual(current.profile.discriminator,b.user.discriminator,"De bestaande discriminatorbotsing krijgt atomair een vrije discriminator");assert.equal(current.profile.companion,"varo");assert.equal(current.profile.uiLanguage,"en");assert.equal(current.profile.incognitoActive,true);
 assert.equal(current.profile.dailyReminderTime,"21:30");assert.equal(current.profile.searchableByEmail,true);
 assert.deepEqual(await prisma.user.findUniqueOrThrow({where:{id:b.user.id}}),beforeB);
 for(const patch of [{isAdmin:true},{userId:b.user.id},{sessionVersion:0},{totpEnabled:true},{timeZone:"+01:00"},{incognitoHours:9999},{dailyReminderTime:"25:00"},{dailyTextSource:"private-source-does-not-exist"}])assert.equal((await call("profile",a.pair.accessToken,{kind:"settings",patch})).response.status,400);
 const fresh=await prisma.user.findUniqueOrThrow({where:{id:a.user.id}});assert.equal(fresh.isAdmin,false);assert.equal(fresh.sessionVersion,0);assert.equal(fresh.totpEnabled,false);
 const web=await fetch(`${base}/api/account`,{method:"PATCH",headers:{Cookie:`bvm_session=${a.cookie}`,Origin:base,"Content-Type":"application/json"},body:JSON.stringify({companion:"vera",shareAchievements:false})});assert.equal(web.status,200);
 const after=await profile(a.pair.accessToken);assert.equal(after.profile.companion,"vera");assert.equal(after.profile.shareAchievements,false);
});
test("avatarrechten en uitgelichte prestaties blijven server-authoritative",async()=>{
 const a=await account();
 const legal=await call("profile",a.pair.accessToken,{kind:"settings",patch:{avatarCharacterId:"sariah"}});assert.equal(legal.response.status,200,JSON.stringify(legal.data));
 const locked=await call("profile",a.pair.accessToken,{kind:"settings",patch:{avatarCharacterId:"aaron"}});assert.equal(locked.response.status,400);
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.user.id}})).avatarCharacterId,"sariah");
 assert.equal((await call("profile",a.pair.accessToken,{kind:"settings",patch:{avatarFrameId:"frame-does-not-exist"}})).response.status,400);
 const achievement=await prisma.achievement.upsert({where:{slug:"profile-fixture-earned"},create:{slug:"profile-fixture-earned",name:"Synthetisch",description:"Synthetisch",icon:"book"},update:{}});
 assert.equal((await call("profile",a.pair.accessToken,{kind:"featured-achievements",achievementIds:[achievement.id]})).response.status,400);
 await prisma.userAchievement.create({data:{userId:a.user.id,achievementId:achievement.id}});
 assert.equal((await call("profile",a.pair.accessToken,{kind:"featured-achievements",achievementIds:[achievement.id]})).response.status,200);
 assert.deepEqual((await profile(a.pair.accessToken)).profile.featuredAchievementIds,[achievement.id]);
 assert.equal((await call("profile",a.pair.accessToken,{kind:"featured-achievements",achievementIds:[achievement.id,achievement.id]})).response.status,400);
});
test("leesreset en podcastvoorkeuren gebruiken dezelfde serverprocedures zonder XP of beloningen terug te zetten",async()=>{
 const a=await account({xpTotal:550,currentStreak:8,freezeCount:2});
 const progress=await prisma.contentProgress.create({data:{userId:a.user.id,contentKey:"synthetic/profile/reset",readStatus:"READ",readVerse:12,readStartedAt:new Date(),readAt:new Date(),exerciseAnswered:4,rewardCorrect:4,baseXpEarned:40,rewardBonusAt:new Date()}});
 const before=await prisma.user.findUniqueOrThrow({where:{id:a.user.id}});
 const reset=await call("profile",a.pair.accessToken,{kind:"reading-reset"});assert.equal(reset.response.status,200,JSON.stringify(reset.data));
 const after=await prisma.user.findUniqueOrThrow({where:{id:a.user.id}});assert.equal(after.xpTotal,before.xpTotal);assert.equal(after.currentStreak,before.currentStreak);assert.equal(after.freezeCount,before.freezeCount);
 const cleared=await prisma.contentProgress.findUniqueOrThrow({where:{id:progress.id}});assert.equal(cleared.readStatus,null);assert.equal(cleared.readVerse,0);assert.equal(cleared.exerciseAnswered,0);assert.equal(cleared.baseXpEarned,40);assert.equal(cleared.rewardCorrect,4);assert.deepEqual(cleared.rewardBonusAt,progress.rewardBonusAt);
 const podcastId=`profile-${randomUUID()}`;await prisma.podcast.create({data:{id:podcastId,slug:podcastId,name:"Synthetische podcast"}});
 assert.equal((await call("profile",a.pair.accessToken,{kind:"podcast-notification",podcastId,enabled:true})).response.status,200);
 assert.equal((await prisma.podcastNotificationPreference.findUniqueOrThrow({where:{userId_podcastId:{userId:a.user.id,podcastId}}})).enabled,true);
 assert.equal((await call("profile",a.pair.accessToken,{kind:"podcast-notification",podcastId:"missing",enabled:true})).response.status,404);
 assert.equal((await call("profile",a.pair.accessToken,{kind:"changelog-seen"})).response.status,200);
});
test("ingetrokken sessies kunnen niet lezen/schrijven; ook intrekking tijdens lockwachten rolt de mutatie terug",async()=>{
 const a=await account(),identity=await nativeSessionIdentity(a.pair.accessToken);
 let unlock!:()=>void,locked!:()=>void;const ready=new Promise<void>(resolve=>{locked=resolve;});
 const holder=prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${a.user.id} FOR UPDATE`;
  locked();await new Promise<void>(resolve=>{unlock=resolve;});
  await tx.nativeSession.update({where:{id:identity.binding.sessionId},data:{revokedAt:new Date()}});
 });
 await ready;
 const pending=patchProfileSettings({userId:a.user.id,nativeSession:identity.binding},{handle:"Mag nooit verschijnen"});
 unlock();await holder;await assert.rejects(pending,/session_expired/);
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.user.id}})).handle,a.user.handle);
 assert.equal((await call("profile",a.pair.accessToken)).response.status,401);
 assert.equal((await call("profile",a.pair.accessToken,{kind:"settings",patch:{shareAchievements:true}})).response.status,401);
});
test("native tweestapsinstellingen delen setup, verificatie en herstelregels; admin kan 2FA niet uitschakelen",async()=>{
 const a=await account(),start=await call("profile/two-factor",a.pair.accessToken,{kind:"setup"});assert.equal(start.response.status,200,JSON.stringify(start.data));
 const secret=start.data.result.secret as string;assert.ok(start.data.result.otpauthUri.startsWith("otpauth://totp/"));
 assert.equal((await call("profile/two-factor",a.pair.accessToken,{kind:"verify",code:"wrong"})).response.status,400);
 const verified=await call("profile/two-factor",a.pair.accessToken,{kind:"verify",code:generateTotpCode(secret)});assert.equal(verified.response.status,200,JSON.stringify(verified.data));assert.equal(verified.data.result.recoveryCodes.length,8);
 assert.equal((await profile(a.pair.accessToken)).profile.totpEnabled,true);
 const recovery=verified.data.result.recoveryCodes[0];
 const reset=await call("profile/two-factor",a.pair.accessToken,{kind:"reset",code:recovery});assert.equal(reset.response.status,200,JSON.stringify(reset.data));
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.user.id}})).totpEnabled,true);
 assert.equal((await call("profile/two-factor",a.pair.accessToken,{kind:"reset",code:recovery})).response.status,400);
 const reverified=await call("profile/two-factor",a.pair.accessToken,{kind:"verify",code:generateTotpCode(reset.data.result.secret)});assert.equal(reverified.response.status,200);
 assert.equal((await call("profile/two-factor",a.pair.accessToken,{kind:"disable",code:reverified.data.result.recoveryCodes[1]})).response.status,200);
 assert.equal((await profile(a.pair.accessToken)).profile.totpEnabled,false);
 const admin=await account({isAdmin:true,totpEnabled:true,totpSecretEncrypted:encryptTotpSecret(generateTotpSecret())});
 assert.equal((await call("profile/two-factor",admin.pair.accessToken,{kind:"disable",code:"whatever"})).response.status,403);
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:admin.user.id}})).totpEnabled,true);
});

test("Overal uitloggen gebruikt voor native en web dezelfde sessieversie; andermans en nieuwere sessies blijven intact",async()=>{
 const a=await account(),b=await account(),second=await issueNativeSession(a.user.id,a.user.sessionVersion);
 assert.equal((await call("profile",a.pair.accessToken,{kind:"logout-all"})).response.status,200);
 for(const pair of [a.pair,second])assert.equal((await call("me",pair.accessToken)).response.status,401);
 assert.equal((await fetch(`${base}/api/profile`,{headers:{Cookie:`bvm_session=${a.cookie}`}})).status,401);
 assert.equal((await call("me",b.pair.accessToken)).response.status,200);
 let user=await prisma.user.findUniqueOrThrow({where:{id:a.user.id}});assert.equal(user.sessionVersion,1);
 const fresh=await issueNativeSession(a.user.id,user.sessionVersion);
 assert.equal((await call("profile",a.pair.accessToken,{kind:"logout-all"})).response.status,401);
 const webLogout=(cookie:string)=>fetch(`${base}/api/auth/logout`,{method:"POST",headers:{Cookie:`bvm_session=${cookie}`,Origin:base,"Content-Type":"application/json"},body:"{}"});
 assert.equal((await webLogout(a.cookie)).status,200);assert.equal((await call("me",fresh.accessToken)).response.status,200,"Een oude webcookie trekt de nieuwe sessie niet in");
 user=await prisma.user.findUniqueOrThrow({where:{id:a.user.id}});assert.equal(user.sessionVersion,1);
 assert.equal((await webLogout(await createSessionToken(a.user.id))).status,200);assert.equal((await call("me",fresh.accessToken)).response.status,401);
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.user.id}})).sessionVersion,2);
 assert.equal((await call("me",b.pair.accessToken)).response.status,200);assert.equal((await prisma.user.findUniqueOrThrow({where:{id:b.user.id}})).sessionVersion,0);
});
test("globaal uitloggen hercontroleert een ingetrokken native actor onder User-/sessielocks",async()=>{
 const a=await account(),b=await account(),{binding}=await nativeSessionIdentity(a.pair.accessToken);
 await assert.rejects(logoutAccount({id:b.user.id,sessionVersion:b.user.sessionVersion},binding),/session_expired/);
 let unlock!:()=>void,locked!:()=>void;const ready=new Promise<void>(resolve=>{locked=resolve;});
 const holder=prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${a.user.id} FOR UPDATE`;
  locked();await new Promise<void>(resolve=>{unlock=resolve;});
  await tx.nativeSession.update({where:{id:binding.sessionId},data:{revokedAt:new Date()}});
 });
 await ready;
 const pending=logoutAccount({id:a.user.id,sessionVersion:a.user.sessionVersion},binding);
 unlock();await holder;await assert.rejects(pending,/session_expired/);
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.user.id}})).sessionVersion,0);
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:b.user.id}})).sessionVersion,0);
 assert.equal((await call("me",b.pair.accessToken)).response.status,200);
});

test("profieltalen gebruiken ook voor de contenttaal de bestaande selectie-CAS en bronrechten",async()=>{
 const work=`profile-language-${randomUUID()}`;await prisma.contentWork.create({data:{key:work,kind:"SCRIPTURE"}});
 const collections:Record<string,string>={};
 for(const language of ["nl","en"]){
  const id=`${work}-${language}`;collections[language]=id;
  await prisma.contentCollection.create({data:{id,slug:id,name:`Synthetisch ${language}`,icon:"book",work,language,editionKey:"official",enabled:true,visibleToUsers:true,publicationState:"PUBLISHED"}});
  const book=await prisma.book.create({data:{slug:id,name:`Boek ${language}`,order:1,key:`${work}/book`,contentCollectionId:id}});
  await prisma.chapter.create({data:{bookId:book.id,number:1,order:1,verses:{create:{number:1,text:"Synthetische taalproef."}}}});
 }
 const a=await account({contentLanguage:"nl",activeContentCollectionId:collections.nl});
 const before=await call("content-context",a.pair.accessToken);assert.equal(before.response.status,200);
 const input={contentLanguage:"en",expectedSelection:before.data.picker.selection,expectedSelectionVersion:before.data.picker.selectionVersion,location:"/profile"};
 const switched=await call("content-context",a.pair.accessToken,input);assert.equal(switched.response.status,200,JSON.stringify(switched.data));
 assert.equal(switched.data.state.picker.selection.contentLanguage,"en");assert.equal(switched.data.state.picker.activeCollectionId,collections.en);
 assert.equal((await profile(a.pair.accessToken)).contentLanguage,"en");
 const current=await prisma.user.findUniqueOrThrow({where:{id:a.user.id}});assert.equal(current.activeContentCollectionId,collections.en);assert.equal(current.uiLanguage,"nl");
 assert.equal((await call("content-context",a.pair.accessToken,{...input,contentLanguage:"nl"})).response.status,409,"Een oude selectie overschrijft de nieuwe taal niet");
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:a.user.id}})).activeContentCollectionId,collections.en);
});
