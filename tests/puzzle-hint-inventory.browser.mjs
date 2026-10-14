// Echte productie-interface, API en geïsoleerde DB; geen gemockte hintresponses.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db.ts";
import { createSessionToken, SESSION_COOKIE } from "../src/lib/auth.ts";
import { createPuzzleGeometry } from "../src/lib/puzzle/geometry.ts";
import { boardPosition, groupFor } from "../src/lib/puzzle/engine.ts";
import { jigsawCatalog } from "../src/lib/jigsawGame.ts";
import { nl } from "../src/lib/i18n/messages/nl.ts";
import { de } from "../src/lib/i18n/messages/de.ts";

const dbUrl=new URL(process.env.LEARNING_TEST_DATABASE_URL??"http://invalid");
if(dbUrl.hostname!=="127.0.0.1"||dbUrl.pathname!=="/versado_puzzle_test"||process.env.DATABASE_URL!==process.env.LEARNING_TEST_DATABASE_URL) throw new Error("Gebruik de lokale wegwerpdatabase");
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE??"playwright");
const base=process.env.PUZZLE_TEST_BASE_URL??"http://localhost:3107";
const browser=await chromium.launch({args:["--no-sandbox"],executablePath:process.env.CHROMIUM_PATH});
const output="/tmp/versado-puzzle-browser"; mkdirSync(output,{recursive:true}); const users=[]; const results=[];
try {
  const scope=await prisma.gameContentScope.findFirstOrThrow({where:{gameKey:"jigsaw"}});
  await prisma.gameSettings.upsert({where:{id:"singleton"},create:{jigsawEnabled:true},update:{jigsawEnabled:true}});
  for(const mobile of [false,true]) {
    const user=await prisma.user.create({data:{email:`stock-${randomUUID()}@test.invalid`,passwordHash:"x",handle:`Stock${randomUUID().slice(0,6)}`,discriminator:"00",hintBalance:8,xpTotal:1000,activeContentCollectionId:scope.contentCollectionId,onboardingSeenAt:new Date(),onboardingProfilePrivacyAt:new Date()}}); users.push(user.id);
    const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900},isMobile:mobile,hasTouch:mobile,serviceWorkers:"block"});
    await context.addCookies([{name:SESSION_COOKIE,value:await createSessionToken(user.id),url:base}]);
    const page=await context.newPage(); const errors=[]; page.on("pageerror",error=>errors.push(error.message));
    let hintRequests=0; page.on("request",req=>{if(req.url().endsWith("/api/jigsaw-v2")&&req.postDataJSON()?.operation?.kind==="hint") hintRequests++;});
    const api=async(body)=>{const r=await context.request.post(`${base}/api/jigsaw-v2`,{headers:{Origin:base},data:body});assert.equal(r.status(),200,await r.text());return r.json();};
    const act=(s,operation)=>api({action:"act",sessionId:s.id,version:s.version,actionId:randomUUID(),operation});
    const resume=(s)=>api({action:"resume",sessionId:s.id});
    const canvas=page.locator("canvas");
    async function expire(s) {const snap=structuredClone(s.snapshot);for(const h of snap.hints) h.expiresAt=new Date(0).toISOString();await prisma.puzzleSession.update({where:{id:s.id},data:{snapshot:JSON.stringify(snap)}});return resume(s);}
    async function open(s) {await page.goto(`${base}/jigsaw`);await page.evaluate(id=>localStorage.setItem("versado:jigsaw-v2-session",id),s.id);await page.reload();if(s.status==="COMPLETED") await page.getByRole("button",{name:nl.jigsaw.completion.toQuestion,exact:true}).waitFor(); else await canvas.waitFor();}
    async function panel() {const refreshed=page.waitForResponse(r=>r.url().endsWith("/api/hints")&&r.request().method()==="GET");await page.getByRole("button",{name:nl.jigsaw.boardMenu,exact:true}).click();await page.getByRole("button",{name:nl.jigsaw.useHint,exact:true}).click();const p=page.getByRole("dialog",{name:nl.jigsaw.hintPanel});await p.waitFor();await refreshed;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));return p;}
    async function cta(button) {const b=await button.boundingBox();assert.ok(b);assert.ok(b.height>=48);assert.ok(b.width<=440.5);const parent=await button.evaluate(el=>el.parentElement.getBoundingClientRect().width);assert.ok(Math.abs(b.width-Math.min(parent,440))<2,JSON.stringify({b,parent}));}
    // Catalogus: lokale CTA-breedte en disabled/loading blijven correct.
    await page.goto(`${base}/jigsaw`);const start=page.getByRole("button",{name:nl.jigsaw.start,exact:true});await start.waitFor();assert.equal(await start.isDisabled(),true);await cta(start);
    await page.locator('section[aria-labelledby="jigsaw-image-choice"] button:has(img)').first().click();assert.equal(await start.isEnabled(),true);
    let releaseStart;const heldStart=new Promise(resolve=>{releaseStart=resolve;});await page.route("**/api/jigsaw-v2",async route=>{if(route.request().postDataJSON()?.action==="start")await heldStart;await route.continue();});
    const starting=page.waitForRequest(r=>r.postDataJSON()?.action==="start");await start.click();await starting;const loading=page.getByRole("button",{name:nl.common.loading,exact:true});await loading.waitFor();assert.equal(await loading.isDisabled(),true);await cta(loading);releaseStart();await canvas.waitFor();await page.unroute("**/api/jigsaw-v2");
    let state=await api({action:"start",imageId:jigsawCatalog[190].url,pieceCount:12,difficulty:"ADVENTURER"});
    const geometry=createPuzzleGeometry(12,state.seed,state.geometryVersion);
    for(let i=0;i<2;i++) state=await expire(await act(state,{kind:"hint",hint:"PREVIEW"}));
    await open(state);await canvas.press("0");await canvas.press("Enter");const p=await panel();
    assert.equal(await p.locator("[data-hint-included]").innerText(),nl.jigsaw.hintsRemaining.replace("{n}","1"));assert.equal(await p.locator("[data-hint-stock]").innerText(),nl.jigsaw.hintStock.replace("{n}","8"));
    assert.equal(await p.getByRole("button").count(),5); // sluitknop + vier uniforme hulpmiddelen
    assert.equal(await page.evaluate(()=>document.querySelector('[aria-labelledby="puzzle-hints-title"]').contains(document.activeElement)),true);
    for(let i=0;i<9;i++){await page.keyboard.press("Tab");assert.equal(await page.evaluate(()=>document.querySelector('[aria-labelledby="puzzle-hints-title"]').contains(document.activeElement)),true);}
    await page.keyboard.press("Shift+Tab");assert.equal(await page.evaluate(()=>document.querySelector('[aria-labelledby="puzzle-hints-title"]').contains(document.activeElement)),true);
    const version=state.version;await canvas.evaluate(c=>c.focus());assert.equal(await canvas.evaluate(c=>c===document.activeElement),false,"native modal maakt het bord inert");await page.keyboard.press("ArrowRight");assert.equal((await resume(state)).version,version);
    await page.keyboard.press("Escape");await p.waitFor({state:"detached"});assert.equal(await page.getByRole("button",{name:nl.jigsaw.boardMenu,exact:true}).evaluate(b=>b===document.activeElement),true);
    let pane=await panel();await page.screenshot({path:`${output}/hint-stock-${mobile?"mobile":"desktop"}.png`});
    let response=page.waitForResponse(r=>r.request().postDataJSON()?.operation?.kind==="hint");await pane.getByRole("button",{name:nl.jigsaw.hintPreview,exact:true}).click();state=await(await response).json();assert.equal(state.hintBalance,8);assert.equal(state.snapshot.hints.length,3);assert.equal(state.snapshot.hints[2].source,"INCLUDED");assert.equal(await page.locator("[data-hint-confirmation]").count(),0);
    await page.waitForFunction(()=>document.querySelector("canvas")?.dataset.activeHint==="",null,{timeout:6500});
    // Subkeuze, persoonlijke bevestiging en annuleren maken geen serveractie.
    pane=await panel();const requests=hintRequests;await pane.getByRole("button",{name:nl.jigsaw.hintFilter,exact:true}).click();assert.equal(hintRequests,requests);await pane.getByRole("button",{name:nl.jigsaw.hintCorners,exact:true}).click();await page.locator("[data-hint-confirmation]").waitFor();assert.equal(hintRequests,requests);assert.ok(await pane.getByText(nl.jigsaw.hintPersonalCost,{exact:true}).isVisible());assert.equal((await resume(state)).hintBalance,8);
    await page.screenshot({path:`${output}/hint-personal-confirm-${mobile?"mobile":"desktop"}.png`});await pane.getByRole("button",{name:nl.common.cancel,exact:true}).click();assert.equal(hintRequests,requests);
    let losePaidResponse=true;
    await page.route("**/api/jigsaw-v2",async route=>{const body=route.request().postDataJSON();if(losePaidResponse&&body?.operation?.kind==="hint"&&body.operation.confirmPersonal){losePaidResponse=false;await route.fetch();await route.abort("failed");}else await route.continue();});
    await pane.getByRole("button",{name:nl.jigsaw.hintEdges,exact:true}).click();response=page.waitForResponse(r=>r.request().postDataJSON()?.operation?.kind==="hint");await pane.getByRole("button",{name:nl.jigsaw.hintConfirmUse,exact:true}).click();state=await(await response).json();assert.equal(hintRequests,requests+2,"verloren response wordt met dezelfde actionId herhaald");assert.equal(state.hintBalance,7);assert.equal(state.snapshot.hints.length,4);assert.equal(state.snapshot.hints[3].source,"PERSONAL");assert.equal(state.snapshot.hints[3].target.filter,"EDGES");assert.equal(await prisma.puzzleAction.count({where:{sessionId:state.id,type:"hint"}}),4);await page.unroute("**/api/jigsaw-v2");
    const shop=await context.request.get(`${base}/api/shop`);assert.equal((await shop.json()).hintBalance,7);
    pane=await panel();assert.equal(await pane.locator("[data-hint-stock]").innerText(),nl.jigsaw.hintStock.replace("{n}","7"));assert.equal(await pane.getByRole("button",{name:nl.jigsaw.hintPreview,exact:true}).isDisabled(),true);const purchase=await context.request.post(`${base}/api/shop/hints`,{data:{quantity:1}});assert.equal(purchase.status(),200);assert.equal((await purchase.json()).hintBalance,8);
    await pane.locator("[data-hint-stock]").filter({hasText:nl.jigsaw.hintStock.replace("{n}","8")}).waitFor({timeout:4000});await page.keyboard.press("Escape");
    await page.waitForFunction(()=>document.querySelector("canvas")?.dataset.activeHint==="",null,{timeout:6500});
    // Camera behouden bij zichtbare locatie: vergelijken van de echte Canvas-transform.
    const to=boardPosition(geometry,groupFor(state.snapshot,0)); state=await act(state,{kind:"move",groupId:"p0",...to});await open(state);await canvas.press("0");await canvas.press("Enter");await page.evaluate(()=>{const ctx=document.querySelector("canvas").getContext("2d");const original=ctx.scale.bind(ctx);ctx.scale=(x,y)=>{const matrix=ctx.getTransform();const ratio=Math.min(devicePixelRatio,2);window.__hintCamera={x:matrix.e/ratio,y:matrix.f/ratio,scale:x};return original(x,y);};});await canvas.press("0");await canvas.hover();await page.mouse.wheel(0,-100);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const cameraBefore=await page.evaluate(()=>window.__hintCamera);
    pane=await panel();await pane.getByRole("button",{name:nl.jigsaw.hintLocation,exact:true}).click();response=page.waitForResponse(r=>r.request().postDataJSON()?.operation?.kind==="hint");await pane.getByRole("button",{name:nl.jigsaw.hintConfirmUse,exact:true}).click();state=await(await response).json();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.deepEqual(await page.evaluate(()=>window.__hintCamera),cameraBefore,"zichtbare locatiehint behoudt positie en zoom");assert.equal(state.hintBalance,7);
    state=await expire(state);await open(state);
    // Kleine telefoon/landscape, tekst 200%, safe areas, donker en lange vertaling.
    for(const size of [{width:320,height:568},{width:844,height:390}]) {
      await page.setViewportSize(size);await page.emulateMedia({colorScheme:"dark"});await page.evaluate(()=>{document.documentElement.style.fontSize="200%";for(const [side,value] of Object.entries({left:20,right:20,bottom:34}))document.documentElement.style.setProperty(`--safe-area-inset-${side}`,`${value}px`);});
      pane=await panel();const box=await pane.boundingBox();assert.ok(box.x>=19&&box.x+box.width<=size.width-19&&box.y>=0&&box.y+box.height<=size.height+1,JSON.stringify({size,box}));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await pane.getByRole("button",{name:nl.jigsaw.hintFilter,exact:true}).click();await pane.getByRole("button",{name:nl.jigsaw.hintMiddles,exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/hint-sheet-${mobile?"mobile":"desktop"}-${size.width}-200-dark.png`});await page.keyboard.press("Escape");await page.evaluate(()=>{document.documentElement.style.removeProperty("font-size");for(const side of ["left","right","bottom"])document.documentElement.style.removeProperty(`--safe-area-inset-${side}`);});
    }
    // Leegsaldo → bestaande winkel → aankoop → dezelfde opgeslagen puzzel.
    await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:900});await prisma.user.update({where:{id:user.id},data:{hintBalance:0}});pane=await panel();await pane.getByText(nl.jigsaw.hintEmpty,{exact:true}).waitFor();await page.screenshot({path:`${output}/hint-empty-${mobile?"mobile":"desktop"}.png`});const original=structuredClone(state.snapshot);
    await pane.getByRole("button",{name:nl.jigsaw.hintShop,exact:true}).click();await page.waitForURL("**/shop");const buy=page.getByRole("button",{name:nl.shop.buyFor.replace("{xp}","50"),exact:true});await buy.waitFor();response=page.waitForResponse(r=>r.url().endsWith("/api/shop/hints")&&r.request().method()==="POST");await buy.click();assert.equal((await(await response).json()).hintBalance,1);await page.goto(`${base}/jigsaw`);await canvas.waitFor();state=await resume(state);assert.equal(state.hintBalance,1);assert.deepEqual(state.snapshot,original);
    pane=await panel();await pane.locator("[data-hint-stock]").filter({hasText:nl.jigsaw.hintStock.replace("{n}","1")}).waitFor();await page.keyboard.press("Escape");
    // Primaire stappen blijven dezelfde verplicht inhoudelijke afronding.
    for(const piece of geometry.pieces){const group=groupFor(state.snapshot,piece.id);if(!group.anchored){state=await act(state,{kind:"move",groupId:group.id,...boardPosition(geometry,group)});state=await act(state,{kind:"anchor",groupId:group.id});}}
    await open(state);const further=page.getByRole("button",{name:nl.jigsaw.completion.toQuestion,exact:true});await cta(further);await further.click();const confirm=page.getByRole("button",{name:nl.jigsaw.confirmAnswer,exact:true});await cta(confirm);assert.equal(await confirm.isDisabled(),true);
    await page.getByRole("button",{name:state.question.options[0],exact:true}).click();
    let releaseAnswer;const heldAnswer=new Promise(resolve=>{releaseAnswer=resolve;});await page.route("**/api/jigsaw-v2",async route=>{if(route.request().postDataJSON()?.action==="answer")await heldAnswer;await route.continue();});const answering=page.waitForRequest(r=>r.postDataJSON()?.action==="answer");await confirm.click();await answering;const pendingAnswer=page.getByRole("button",{name:nl.jigsaw.answering,exact:true});await pendingAnswer.waitFor();assert.equal(await pendingAnswer.isDisabled(),true);await cta(pendingAnswer);releaseAnswer();const another=page.getByRole("button",{name:nl.jigsaw.another,exact:true});await another.waitFor();await page.unroute("**/api/jigsaw-v2");await cta(another);await cta(page.getByRole("button",{name:nl.jigsaw.replay,exact:true}));await page.screenshot({path:`${output}/puzzle-wide-cta-${mobile?"mobile":"desktop"}.png`});
    await page.getByRole("button",{name:nl.jigsaw.replay,exact:true}).click();await canvas.waitFor();const newId=await page.evaluate(()=>localStorage.getItem("versado:jigsaw-v2-session"));assert.notEqual(newId,state.id);const replay=await api({action:"resume",sessionId:newId});assert.equal(replay.snapshot.hints.length,0);assert.equal(replay.hintBalance,1);
    await prisma.user.update({where:{id:user.id},data:{uiLanguage:"de"}});await page.reload();await canvas.waitFor();await page.getByRole("button",{name:de.jigsaw.boardMenu,exact:true}).click();await page.getByRole("button",{name:de.jigsaw.useHint,exact:true}).click();await page.getByRole("dialog",{name:de.jigsaw.hintPanel}).waitFor();await page.screenshot({path:`${output}/hint-stock-${mobile?"mobile":"desktop"}-de.png`});
    assert.deepEqual(errors,[]);results.push({mobile,includedFirst:3,paidSource:"PERSONAL",stockAfterFourth:7,shopResume:true,modalFocus:true,wideCTAs:true});await context.close();
  }
  writeFileSync(`${output}/hint-stock-results.json`,JSON.stringify(results,null,2));console.log("Productiebrowser: hintbronnen, bevestiging/annuleren, voorraad/winkel/hervatten, modal focus/inert/Escape/scroll, safe areas/200%/dark/Duits en brede CTA's op mobiel en desktop geslaagd.");
} finally {await browser.close();await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.$disconnect();}
