import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { io } from "socket.io-client";
import { prisma as db } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { quickMissionaryFixture } from "./fixtures/quick-missionary.ts";
const url = new URL(process.env.LEARNING_TEST_DATABASE_URL ?? "http://invalid");
if (url.hostname !== "127.0.0.1" || url.pathname !== "/versado_content_access_test" || !process.env.REDIS_URL?.startsWith("redis://127.0.0.1:")) throw new Error("Eigen PostgreSQL/Redis vereist");
const ports=[3145,3146], children=[], sockets=[], users=[], books=[];
let enQuestion;
async function account(source="content_bom") {
 const u=await db.user.create({data:{email:`${randomUUID()}@qm.multi.test.invalid`,handle:`QM${randomUUID().slice(0,5)}`,discriminator:"00",passwordHash:"synthetic",activeContentCollectionId:source,xpTotal:500,geneesBalance:2,hintBalance:8,onboardingSeenAt:new Date(),emailVerifiedAt:new Date()}});users.push(u.id);
 return {...u,cookie:`${SESSION_COOKIE}=${await createSessionToken(u.id)}`};
}
async function post(index,user,path,body={}) {
 const base=`http://localhost:${ports[index]}`;
 return fetch(`${base}${path}`,{method:"POST",headers:{cookie:user.cookie,Origin:base,"content-type":"application/json"},body:JSON.stringify(body)});
}
async function connect(index,user) {
 const socket=io(`http://localhost:${ports[index]}`,{transports:["websocket"],reconnection:false,forceNew:true,extraHeaders:{Cookie:user.cookie}});sockets.push(socket);
 await new Promise((resolve,reject)=>{socket.once("connect",resolve);socket.once("connect_error",reject)});return socket;
}
function event(socket,name,predicate=()=>true) {
 return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{socket.off(name,handler);reject(new Error(`Geen ${name}`))},12000);const handler=data=>{if(predicate(data)){clearTimeout(timer);socket.off(name,handler);resolve(data)}};socket.on(name,handler)});
}
async function join(socket,code) {const pending=event(socket,"qm:room",p=>p.code===code);socket.emit("qm:join",{code});return pending;}
const state=user=>db.user.findUniqueOrThrow({where:{id:user.id},select:{xpTotal:true,geneesBalance:true,hintBalance:true,currentStreak:true}});
before(async()=>{
 for(const [id,language] of [["content_bom","nl"],["content_bom_en","en"]]) {
  await quickMissionaryFixture(db,id,language);
  const b=await db.book.create({data:{slug:`qm-multi-${randomUUID()}`,contentCollectionId:id,name:`Synthetisch ${language}`,order:0}});books.push(b.id);
  const c=await db.chapter.create({data:{bookId:b.id,number:1,order:0}});
  const q=await db.quickMissionaryReviveQuestion.create({data:{contentKey:`multi-${randomUUID()}`,chapterId:c.id,prompt:`Test ${language}`,options:{create:[{label:"Het goede antwoord",isCorrect:true,order:0},{label:"Een foute keuze A",order:1},{label:"Een foute keuze B",order:2}]}}});if(language==="en")enQuestion=q.id;
 }
 for(const port of ports) children.push(spawn("node_modules/.bin/tsx",["server.ts"],{detached:true,env:{...process.env,NODE_ENV:"production",PORT:String(port),APP_URL:`http://localhost:${port}`,ALLOW_INSECURE_COOKIES:"1"},stdio:["ignore","pipe","pipe"]}));
 for(const child of children){child.stdout.resume();child.stderr.on("data",chunk=>{if(process.env.QM_MULTI_DEBUG)process.stderr.write(chunk)})}
 for(const port of ports){let healthy=false;for(let i=0;i<120;i++){try{if((await fetch(`http://localhost:${port}/api/health`)).ok){healthy=true;break}}catch{}await delay(500)}assert.ok(healthy,`Productieserver ${port}`)}
});
after(async()=>{
 for(const socket of sockets)socket.disconnect();
 await Promise.all(children.map(child=>new Promise(resolve=>{child.once("exit",resolve);try{process.kill(-child.pid,"SIGTERM")}catch{resolve()}setTimeout(resolve,5000)})));
 await db.liveGame.deleteMany({where:{hostId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.book.deleteMany({where:{id:{in:books}}});await db.$disconnect();
});

test("Twee echte productie-instances: lobbybron, uitnodiging, reconnect, dubbele start, Genees en Duo",{timeout:120000},async()=>{
 const a=await account(),b=await account("content_bom_en"); const beforeA=await state(a),beforeB=await state(b);
 await db.friendship.create({data:{senderId:a.id,receiverId:b.id,status:"ACCEPTED"}});
 const response=await post(0,a,"/api/snelle-zendeling/together",{contentCollectionId:"content_podcasts"});assert.equal(response.status,200);const {code}=await response.json();
 const game=await db.liveGame.findUniqueOrThrow({where:{code}});assert.equal((await db.liveGamePlayer.findUniqueOrThrow({where:{gameId_userId:{gameId:game.id,userId:a.id}}})).contentCollectionId,"content_bom");
 const sa=await connect(0,a),sb=await connect(1,b);await join(sa,code);
 const invite=event(sb,"game_invite",p=>p.code===code);sa.emit("qm:invite",{toUserId:b.id});await invite;await join(sb,code);
 await db.user.update({where:{id:a.id},data:{activeContentCollectionId:"content_podcasts"}});await db.user.update({where:{id:b.id},data:{activeContentCollectionId:"content_bom"}});
 sb.disconnect();const reconnect=await connect(1,b);await join(reconnect,code);
 assert.equal((await db.liveGamePlayer.findUniqueOrThrow({where:{gameId_userId:{gameId:game.id,userId:b.id}}})).contentCollectionId,"content_bom_en");
 await db.contentCollection.update({where:{id:"content_bom_en"},data:{visibleToUsers:false}});
 const denied=event(sa,"qm:error");sa.emit("qm:start");assert.equal((await denied).key,"quickMissionary.sourceUnavailable");assert.equal(await db.quickMissionaryMatch.count({where:{liveGameId:game.id}}),0);assert.equal(await db.liveGameInvite.count({where:{gameId:game.id}}),1);
 await quickMissionaryFixture(db,"content_bom_en","en");const sa2=await connect(1,a);await join(sa2,code);
 const started=event(sa,"qm:room",p=>p.phase==="running");sa.emit("qm:start");sa2.emit("qm:start");const payload=await started;await delay(250);
 assert.equal(await db.quickMissionaryMatch.count({where:{liveGameId:game.id}}),1);
 const rows=await db.quickMissionaryRun.findMany({where:{matchId:payload.match.matchId}});assert.equal(rows.length,2);
 assert.equal(rows.find(r=>r.userId===a.id).contentCollectionId,"content_bom");assert.equal(rows.find(r=>r.userId===b.id).contentCollectionId,"content_bom_en");
 await db.gameSettings.update({where:{id:"singleton"},data:{quickMissionaryEnabled:false}});await db.gameContentScope.deleteMany({where:{gameKey:"quick-missionary"}});
 const rb=rows.find(r=>r.userId===b.id),ra=rows.find(r=>r.userId===a.id);
 assert.equal((await post(1,b,`/api/snelle-zendeling/runs/${rb.id}/death`,{score:0})).status,200);
 const hints=await Promise.all([post(0,b,`/api/snelle-zendeling/runs/${rb.id}/revive`),post(1,b,`/api/snelle-zendeling/runs/${rb.id}/revive`)]);
 const views=await Promise.all(hints.map(async r=>{assert.equal(r.status,200);return r.json()}));assert.deepEqual(views[0].reviveQuestion,views[1].reviveQuestion);assert.equal(views[0].reviveQuestion.exerciseId,enQuestion);assert.equal(await db.quickMissionaryReviveSeen.count({where:{runId:rb.id}}),1);
 const wrong=await db.quickMissionaryReviveOption.findFirstOrThrow({where:{questionId:enQuestion,isCorrect:false}});
 assert.equal((await post(1,b,`/api/snelle-zendeling/runs/${rb.id}/revive/answer`,{exerciseId:enQuestion,optionId:wrong.id})).status,200);
 assert.equal((await db.quickMissionaryRun.findUniqueOrThrow({where:{id:rb.id}})).eliminatedSeq,1);assert.equal((await db.quickMissionaryRun.findUniqueOrThrow({where:{id:ra.id}})).status,"FINISHED");assert.equal(await db.quickMissionaryDuoResult.count({where:{matchId:payload.match.matchId}}),1);
 assert.deepEqual(await state(a),beforeA,"alleen starten zonder spelen geeft de winnaar geen reeksactiviteit");
 assert.deepEqual(await state(b),{...beforeB,currentStreak:beforeB.currentStreak+1},"de gespeelde run met bewezen bron telt ook na een fout Genees-antwoord");
 assert.equal(await db.streakActivity.count({where:{userId:a.id}}),0);
 assert.equal(await db.streakActivity.count({where:{userId:b.id}}),1);
 assert.equal((await post(0,b,`/api/snelle-zendeling/runs/${rb.id}/finish`,{score:0})).status,200);
 assert.deepEqual(await state(b),{...beforeB,currentStreak:beforeB.currentStreak+1});
 assert.equal(await db.streakActivity.count({where:{userId:b.id}}),1,"retry via de andere instance verdubbelt de reeksactiviteit niet");
 assert.equal(await db.xPTransaction.count({where:{userId:{in:[a.id,b.id]}}}),0);
});

test("Browser: oude run afronden en oude lobby expliciet bevestigen, mobiel en desktop",{timeout:120000},async()=>{
 const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_MODULE??"playwright");const browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:["--no-sandbox"]});
 mkdirSync("/tmp/versado-qm-source-browser",{recursive:true});
 try{
  for(const width of [320,1280]) {
   await quickMissionaryFixture(db);const a=await account();const before=await state(a);
   const ctx=await browser.newContext({viewport:{width,height:844},colorScheme:width===320?"dark":"light",reducedMotion:"reduce"});await ctx.addCookies([{name:SESSION_COOKIE,value:a.cookie.split("=")[1],domain:"localhost",path:"/"}]);const page=await ctx.newPage();
   const old=await db.quickMissionaryRun.create({data:{userId:a.id,dayKey:"2026-10-11",status:"DEAD_AWAITING_REVIVE",reviveUsed:true}});
   await page.goto(`http://localhost:${ports[0]}/snelle-zendeling/run/${old.id}`);await page.getByRole("status").filter({hasText:"oorspronkelijke uitgave"}).waitFor();
   assert.equal((await db.quickMissionaryRun.findUniqueOrThrow({where:{id:old.id}})).status,"FINISHED");
   assert.deepEqual(await state(a),before,"een bronloze run of lobbybevestiging geeft geen reeksbeloning");
   assert.equal(await db.streakActivity.count({where:{userId:a.id}}),0,"automatisch afsluiten telt niet als inhoudelijke activiteit");
   await page.screenshot({path:`/tmp/versado-qm-source-browser/legacy-run-${width}.png`});
   const flying=await db.quickMissionaryRun.create({data:{userId:a.id,dayKey:"2026-10-11",status:"IN_PROGRESS",score:7,startedAt:new Date(Date.now()-120000)}});
   await page.goto(`http://localhost:${ports[0]}/snelle-zendeling/run/${flying.id}`);
   await page.waitForFunction(()=>document.querySelector('[data-quick-missionary-run]')?.textContent?.includes('7'));
   await page.getByRole("button",{name:"Tik om te vliegen"}).click();
   try { await page.getByRole("status").filter({hasText:"oorspronkelijke uitgave"}).waitFor(); }
   catch(error) { await page.screenshot({path:`/tmp/versado-qm-source-browser/legacy-flight-failure-${width}.png`}); console.log({legacyFlight:await db.quickMissionaryRun.findUnique({where:{id:flying.id},select:{status:true,score:true,contentCollectionId:true}}),renderedStage:await page.locator('[data-quick-missionary-stage]').innerText()}); throw error; }
   assert.equal((await db.quickMissionaryRun.findUniqueOrThrow({where:{id:flying.id}})).score,7);
   const lobbyResponse=await post(0,a,"/api/snelle-zendeling/together");assert.equal(lobbyResponse.status,200);const {code}=await lobbyResponse.json();const g=await db.liveGame.findUniqueOrThrow({where:{code}});
   await db.liveGamePlayer.updateMany({where:{gameId:g.id},data:{contentCollectionId:null}});
   await page.goto(`http://localhost:${ports[0]}/snelle-zendeling/samen/${code}`);const confirm=page.getByRole("button",{name:"Gebruik mijn huidige uitgave"});await confirm.waitFor();
   if(width===320) await page.evaluate(()=>{document.documentElement.style.fontSize="200%"});
   await page.screenshot({path:`/tmp/versado-qm-source-browser/legacy-lobby-${width}.png`});if(width===1280){await confirm.focus();await page.keyboard.press("Enter")}else await confirm.click();await confirm.waitFor({state:"hidden"});
   assert.equal((await db.liveGamePlayer.findUniqueOrThrow({where:{gameId_userId:{gameId:g.id,userId:a.id}}})).contentCollectionId,"content_bom");assert.deepEqual(await state(a),before,"een bronloze run of lobbybevestiging geeft geen reeksbeloning");
   assert.equal(await db.streakActivity.count({where:{userId:a.id}}),0,"beide bronloze runs en de lobbybevestiging blijven zonder reeksactiviteit");
   assert.equal(await db.xPTransaction.count({where:{userId:a.id}}),0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await ctx.close();
  }
 }finally{await browser.close()}
});
