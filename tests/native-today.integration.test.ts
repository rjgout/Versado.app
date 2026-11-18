import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { prisma } from "../src/lib/db";
import { issueNativeSession, nativeSessionIdentity } from "../src/lib/native/sessions";
import { nativeTodayOverviewSchema } from "../src/lib/native/todayContract";
import { contentKeyOf } from "../src/lib/learning/contentProgress";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth";
import { getTodayData } from "../src/lib/today";
import { getStreakContinuation } from "../src/lib/streakContinuation";
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??"http://invalid");
if(db.hostname!=="127.0.0.1"||db.pathname!=="/versado_content_access_test"||db.href!==process.env.DATABASE_URL)throw Error("Alleen eigen geïsoleerde database");
const base=process.env.NATIVE_TEST_BASE_URL!,prefix=`today-${randomUUID()}`;
let collectionId:string,otherCollectionId:string,courseId:string,lessonId:string,priorChapterId:string;
before(async()=>{
 await prisma.contentWork.upsert({where:{key:"bofm"},create:{key:"bofm",kind:"SCRIPTURE"},update:{}});
 const collection=await prisma.contentCollection.create({data:{id:prefix,icon:"book",slug:prefix,name:"Vandaagbron",work:"bofm",language:"nl",editionKey:prefix,visibleToUsers:true,enabled:true,publicationState:"PUBLISHED"}});collectionId=collection.id;
 otherCollectionId=`${prefix}-en`;await prisma.contentCollection.create({data:{id:otherCollectionId,icon:"book",slug:otherCollectionId,name:"Vandaagbron en",work:"bofm",language:"en",editionKey:prefix,visibleToUsers:true,enabled:true,publicationState:"PUBLISHED"}});
 const book=await prisma.book.create({data:{slug:prefix,key:"bofm/alma",name:"Alma",order:1,contentCollectionId:collectionId}});
 for(const number of [1,32])await prisma.chapter.create({data:{bookId:book.id,number,order:number,verses:{create:[1,2,3].map(number=>({number,text:"Een volledig synthetisch vers voor Vandaag."}))}}});
 const chapter=await prisma.chapter.findFirstOrThrow({where:{bookId:book.id,number:32}});
 const prior=await prisma.chapter.findFirstOrThrow({where:{bookId:book.id,number:1}});priorChapterId=prior.id;
 const course=await prisma.course.create({data:{slug:prefix,name:"Stap voor stap",type:"READING_LESSONS",contentCollectionId:collectionId,lessons:{create:[{chapterId:priorChapterId,order:1,startVerse:1,endVerse:3},{chapterId:chapter.id,order:2,startVerse:1,endVerse:2}]}},include:{lessons:{orderBy:{order:"asc"}}}});courseId=course.id;lessonId=course.lessons[1].id;
});
after(async()=>{await prisma.contentCollection.deleteMany({where:{id:{in:[collectionId,otherCollectionId]}}});await prisma.$disconnect();});
async function account(){const user=await prisma.user.create({data:{email:`${randomUUID()}@example.invalid`,handle:`Today${randomUUID().slice(0,6)}`,discriminator:"01",passwordHash:"synthetic",emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),avatarCharacterId:"aaron",activeContentCollectionId:collectionId,uiLanguage:"nl",timeZone:"Europe/Amsterdam",shareOnlineStatus:false,currentStreak:7,freezeCount:1,lastStudyDate:"2026-10-20",lastStudyTimeZone:"Europe/Amsterdam"}});await prisma.userCourseProgress.create({data:{userId:user.id,courseId,subscribed:true,currentLessonId:lessonId,lastActivityAt:new Date()}});await prisma.contentProgress.create({data:{userId:user.id,contentKey:contentKeyOf({id:priorChapterId,number:1,book:{key:"bofm/alma"}}),lastChapterId:priorChapterId,readStatus:"READ",readVerse:3,readAt:new Date()}});return{user,pair:await issueNativeSession(user.id,user.sessionVersion)};}
async function call(token?:string,method="GET",cookie?:string){return fetch(`${base}/api/v1/native/today-overview`,{method,headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1",...(token?{Authorization:`Bearer ${token}`} :{}),...(cookie?{Cookie:cookie}:{}),...(method==="POST"?{"Content-Type":"application/json"}:{})},body:method==="POST"?"{}":undefined});}
async function snapshot(userId:string){return{user:await prisma.user.findUniqueOrThrow({where:{id:userId}}),course:await prisma.userCourseProgress.findMany({where:{userId}}),read:await prisma.contentProgress.findMany({where:{userId}}),freezes:await prisma.freezeTransaction.findMany({where:{userId}}),days:await prisma.streakDay.findMany({where:{userId}})};}
test("native overview equals canonical Today data and the real verse-step cursor, without GET writes",async()=>{
 const {user,pair}=await account(),before=await snapshot(user.id);const response=await call(pair.accessToken);assert.equal(response.status,200,await response.clone().text());const state=nativeTodayOverviewSchema.parse(await response.json());
 assert.equal(response.headers.get("cache-control"),"private, no-store");assert.equal(state.userId,user.id);assert.equal(state.activeCollectionId,collectionId);assert.deepEqual(state.data,await getTodayData(user,{readOnly:true,now:new Date(state.serverNow)}));
 assert.equal(state.data.continueItems[0].href,`/reading-lesson/${lessonId}`);assert.match(state.data.continueItems[0].position!,/Alma 32/);assert.equal(state.data.continueItems.some(item=>item.href.includes("/lesson/")),false);
 assert.deepEqual(await snapshot(user.id),before);assert.equal(state.continuation.status,"INTERRUPTED");assert.deepEqual(state.data.social.online,{});assert.equal(JSON.stringify(state).includes(user.email),false);assert.equal(JSON.stringify(state).includes("passwordHash"),false);
 // The read-only projection is exactly the existing domain result, including a missed-day freeze.
 assert.deepEqual(await getStreakContinuation(user.id,new Date(state.serverNow)),state.continuation);
});
test("actor authentication, exact read-only method and revoked sessions remain enforced",async()=>{
 const {user,pair}=await account();assert.equal((await call()).status,401);assert.equal((await call(undefined,"GET",`${SESSION_COOKIE}=${await createSessionToken(user.id)}`)).status,401);assert.equal((await call(pair.accessToken,"POST")).status,404);
 const {binding}=await nativeSessionIdentity(pair.accessToken);await prisma.nativeSession.update({where:{id:binding.sessionId},data:{revokedAt:new Date()}});assert.equal((await call(pair.accessToken)).status,401);assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).xpTotal,0);
});
async function blockedRead(change:(userId:string,sessionId:string)=>Promise<unknown>){
 const {user,pair}=await account(),identity=await nativeSessionIdentity(pair.accessToken);const lock=new pg.Client({connectionString:db.href});await lock.connect();await lock.query('BEGIN');await lock.query('LOCK TABLE "Course" IN ACCESS EXCLUSIVE MODE');
 let pending:Promise<Response>|undefined;
 try{pending=call(pair.accessToken);let waiting=false;for(let i=0;i<100;i++){const result=await lock.query("SELECT 1 FROM pg_locks WHERE NOT granted AND relation='\"Course\"'::regclass AND pid<>pg_backend_pid() LIMIT 1");if(result.rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}assert.equal(waiting,true,"Echte query moet aantoonbaar geblokkeerd zijn");await change(user.id,identity.binding.sessionId);await lock.query('COMMIT');return await pending;}finally{await lock.query('ROLLBACK');await lock.end();if(pending)await pending.catch(()=>{});}
}
test("logout during a delayed aggregation rejects all private overview data",async()=>{const response=await blockedRead(async(_id,sessionId)=>prisma.nativeSession.update({where:{id:sessionId},data:{revokedAt:new Date()}}));assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:"session_expired"});});
test("selection changes during a delayed aggregation reject the old source/version",async()=>{const response=await blockedRead(async userId=>prisma.user.update({where:{id:userId},data:{activeContentCollectionId:otherCollectionId,contentLanguage:"en"}}));assert.equal(response.status,409);assert.deepEqual(await response.json(),{error:"content_context_changed"});});
test("same service follows account language/timezone and does not invent a first-chapter course position",async()=>{
 const {user,pair}=await account();await prisma.user.update({where:{id:user.id},data:{uiLanguage:"de",timeZone:"America/Los_Angeles"}});const response=await call(pair.accessToken),state=nativeTodayOverviewSchema.parse(await response.json());assert.equal(state.language,"de");assert.equal(state.data.timeZone,"America/Los_Angeles");assert.equal(state.data.continueItems[0].href,`/reading-lesson/${lessonId}`);
 await prisma.userCourseProgress.update({where:{userId_courseId:{userId:user.id,courseId}},data:{subscribed:false}});const next=nativeTodayOverviewSchema.parse(await(await call(pair.accessToken)).json());assert.equal(next.data.continueItems.length,0);
});

test("friends privacy and incognito are enforced by the same server service without leaking other profiles",async()=>{
 const {user,pair}=await account(),{user:friend}=await account(),{user:stranger}=await account();
 await prisma.friendship.create({data:{senderId:user.id,receiverId:friend.id,status:"ACCEPTED"}});
 await prisma.user.update({where:{id:user.id},data:{shareOnlineStatus:true}});
 await prisma.user.update({where:{id:friend.id},data:{shareOnlineStatus:false,onlineSocketCount:2}});
 let state=nativeTodayOverviewSchema.parse(await(await call(pair.accessToken)).json());assert.deepEqual(state.data.social.online,{});assert.deepEqual(state.data.social.friends.map(p=>p.id),[friend.id]);assert.equal(JSON.stringify(state).includes(friend.email),false);assert.equal(JSON.stringify(state).includes(stranger.handle),false);
 await prisma.user.update({where:{id:friend.id},data:{shareOnlineStatus:true,invisibleUntil:new Date(Date.now()+3600000)}});
 state=nativeTodayOverviewSchema.parse(await(await call(pair.accessToken)).json());assert.deepEqual(state.data.social.online,{});
 await prisma.user.update({where:{id:user.id},data:{shareOnlineStatus:false}});
 state=nativeTodayOverviewSchema.parse(await(await call(pair.accessToken)).json());assert.equal(state.data.social.viewerSharesOnline,false);assert.deepEqual(state.data.social.online,{});
});

test("hidden, disabled and draft sources cannot leak course positions through the Today fallback",async()=>{
 const {pair}=await account();
 for(const patch of [{visibleToUsers:false},{visibleToUsers:true,enabled:false},{enabled:true,publicationState:"DRAFT" as const}]){
  await prisma.contentCollection.update({where:{id:collectionId},data:patch});
  const response=await call(pair.accessToken);assert.equal(response.status,200);const state=nativeTodayOverviewSchema.parse(await response.json());assert.equal(state.data.continueItems.some(item=>item.href===`/reading-lesson/${lessonId}`),false);
 }
 await prisma.contentCollection.update({where:{id:collectionId},data:{visibleToUsers:true,enabled:true,publicationState:"PUBLISHED"}});
});

test("an empty authorized catalogue must never expose a hidden legacy default collection",async()=>{
 const {pair}=await account();const {BOM_COLLECTION_ID}=await import("../src/lib/contentCollections");
 await prisma.contentCollection.upsert({where:{id:BOM_COLLECTION_ID},create:{id:BOM_COLLECTION_ID,slug:"boek-van-mormon",name:"Boek van Mormon",icon:"book",work:"bofm",enabled:true,visibleToUsers:true},update:{}});
 const collections=await prisma.contentCollection.findMany({select:{id:true,visibleToUsers:true}});
 const lesson=await prisma.courseLesson.findUniqueOrThrow({where:{id:lessonId},include:{chapter:true}}),bookId=lesson.chapter.bookId;
 try{
  await prisma.book.update({where:{id:bookId},data:{contentCollectionId:BOM_COLLECTION_ID}});await prisma.course.update({where:{id:courseId},data:{contentCollectionId:BOM_COLLECTION_ID}});
  await prisma.contentCollection.updateMany({data:{visibleToUsers:false}});
  const response=await call(pair.accessToken);assert.equal(response.status,200);const state=nativeTodayOverviewSchema.parse(await response.json());assert.equal(state.activeCollectionId,null);assert.deepEqual(state.data.continueItems,[]);assert.equal(state.data.discover.some(item=>item.kind==="course"),false);assert.equal(state.data.dailyText,null);
 }finally{
  await prisma.book.update({where:{id:bookId},data:{contentCollectionId:collectionId}});await prisma.course.update({where:{id:courseId},data:{contentCollectionId:collectionId}});
  for(const row of collections)await prisma.contentCollection.update({where:{id:row.id},data:{visibleToUsers:row.visibleToUsers}});
 }
});
