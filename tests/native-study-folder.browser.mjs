import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createServer} from "node:http";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {build} from "esbuild";
import {seedNativeCourses} from "./fixtures/native-courses.ts";
import {prisma} from "../src/lib/db.ts";
import {mutateAnnotation} from "../src/lib/annotations/service.ts";
import {getT} from "../src/lib/i18n/index.ts";
import {randomUUID} from "node:crypto";
import {serveNativeProfileAsset,logoutNativeProfile} from "./fixtures/native-profile-browser-actions.mjs";
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??"http://invalid"),backend=process.env.NATIVE_TEST_BASE_URL;
if(db.hostname!=="127.0.0.1"||db.pathname!=="/versado_content_access_test"||db.href!==process.env.DATABASE_URL)throw Error("Eigen geïsoleerde database vereist");
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??"playwright"),out=process.env.NATIVE_STUDY_FOLDER_SCREENSHOTS??"/tmp/versado-native-browser/study-folder";
mkdirSync(out,{recursive:true});
const inputs=JSON.parse(readFileSync("dist/native.inputs.json","utf8"));
for(const component of ["study-folder/StudyFolderClient.tsx","reading/ScriptureReaderView.tsx","annotations/AnnotationActionsView.tsx"])assert.ok(inputs.some(path=>path.endsWith(component)));
assert.equal(inputs.some(path=>/node_modules\/(?:next|@prisma)\/|\.server\.ts$/.test(path)),false);
const bundle=await build({entryPoints:["tests/fixtures/native-foundation-client.tsx"],bundle:true,write:false,minify:true,platform:"browser",define:{"process.env.NODE_ENV":'"production"'}}),css=readFileSync("dist/native/index.css"),secrets=new Map(),calls=[],held=[];
let noCapability=false,holdQuery=false,loseWrite=false,queryFailure=false;
const front=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,"http://127.0.0.1");if(serveNativeProfileAsset(url.pathname,res))return;
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
  if(url.pathname.startsWith("/api/v1/native/")){
   const record={path:url.pathname,method:req.method};if(req.method==="POST"&&url.pathname.endsWith("study-folder/annotations"))record.actionId=JSON.parse(body).action.actionId;calls.push(record);
   if(queryFailure&&url.pathname.endsWith("study-folder/query")){res.writeHead(503,{"Content-Type":"application/json"});res.end('{"error":"native_request_failed"}');return;}
   const response=await fetch(`${backend}${req.url}`,{method:req.method,headers:{Origin:"capacitor://localhost","X-Versado-Client":"native-v1","x-real-ip":"127.0.0.88",...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers["content-type"]?{"Content-Type":req.headers["content-type"]}:{})},body:["GET","HEAD"].includes(req.method)?undefined:body});
   let data=await response.text();record.status=response.status;
   if(noCapability&&url.pathname.endsWith("/capabilities")){const value=JSON.parse(data);value.features=value.features.filter(v=>v!=="study-folder-v1");data=JSON.stringify(value);}
   if(loseWrite&&req.method==="POST"&&url.pathname.endsWith("study-folder/annotations")){loseWrite=false;assert.equal(response.status,200);data='{"';}
   const finish=()=>{if(!res.destroyed){res.writeHead(response.status,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(data);}};
   if(holdQuery&&url.pathname.endsWith("study-folder/query")){holdQuery=false;held.push(finish);}else finish();return;
  }
  if(url.pathname.startsWith("/test-keychain/")){if(req.method==="PUT")secrets.set(url.pathname,body.toString());if(req.method==="DELETE")secrets.delete(url.pathname);res.setHeader("Content-Type","application/json");res.end(JSON.stringify({value:secrets.get(url.pathname)??null}));return;}
  if(url.pathname==="/app.js"){res.setHeader("Content-Type","text/javascript");res.end(bundle.outputFiles[0].text);return;}
  if(url.pathname==="/index.css"){res.setHeader("Content-Type","text/css");res.end(css);return;}
  if(["/images/","/icons/","/mascots/","/scripture/"].some(p=>url.pathname.startsWith(p))&&!url.pathname.includes("..")){try{res.end(readFileSync(`public${url.pathname}`));}catch{res.writeHead(404);res.end();}return;}
  res.setHeader("Content-Type","text/html; charset=utf-8");res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
 }catch{res.writeHead(500);res.end("synthetic test boundary failure");}
});
await new Promise(resolve=>front.listen(0,"127.0.0.1",resolve));const origin=`http://127.0.0.1:${front.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:["--no-sandbox"]}),f=await seedNativeCourses(),en=await seedNativeCourses("en"),results=[];
const chapter=await prisma.chapter.create({data:{bookId:f.book.id,number:99,order:99,verses:{create:Array.from({length:34},(_,i)=>({number:i+1,text:`Synthetic personal study passage ${i+1}.`}))}},include:{verses:{orderBy:{number:"asc"}}}});
await prisma.book.update({where:{id:f.book.id},data:{name:"Alma — een oorspronkelijke Schriftuitgave met een lange verwijzing voor persoonlijke studie"}});
await prisma.contentSwitcherSettings.upsert({where:{id:"singleton"},create:{id:"singleton",enabled:true},update:{enabled:true}});
async function populate(user){const rows=[];for(const verse of chapter.verses)rows.push((await mutateAnnotation(user,{kind:"note",target:{type:"verse",verseId:verse.id},expectedVersion:0,actionId:randomUUID(),text:`Private study note ${verse.number}. ${verse.number===34?"LangeNotitie".repeat(150):"Persoonlijke studie"}`},false)).annotation);const v=await prisma.verse.findFirstOrThrow({where:{chapterId:en.chapters[1].id},orderBy:{number:"desc"}});const foreign=(await mutateAnnotation(user,{kind:"bookmark",target:{type:"verse",verseId:v.id},expectedVersion:0,actionId:randomUUID()},false)).annotation;const marked=(await mutateAnnotation(user,{kind:"highlight",target:{type:"verse",verseId:chapter.verses[0].id},expectedVersion:0,actionId:randomUUID(),color:"blue"},false)).annotation;return {rows,foreign,verse:v,marked};}
async function login(page,user,language){const t=getT(language);await page.getByLabel(t("nativeFoundation.email")).fill(user.email);await page.getByLabel(t("nativeFoundation.password"),{exact:true}).fill(f.password);await page.getByRole("button",{name:t("nativeFoundation.login"),exact:true}).click();}

try{
 for(const language of ["nl","en","de","fr","es"]){
  const user=await f.account(language),items=await populate(user),t=getT(language),context=await browser.newContext({viewport:{width:390,height:844},locale:language}),page=await context.newPage(),errors=[];page.on("pageerror",error=>errors.push(error.message));
  const before=await prisma.user.findUniqueOrThrow({where:{id:user.id}});
  const capabilitiesReady=page.waitForResponse(response=>response.url().endsWith("/api/v1/native/capabilities"));
  await page.goto(`${origin}/?material=ios&accountLanguage=1&device=folder-${user.id}#/content`);
  await capabilitiesReady;await page.getByText(t("nativeFoundation.loading"),{exact:true}).first().waitFor({state:"hidden"});
  await page.getByRole("link",{name:t("nativeFoundation.login"),exact:true}).click();await login(page,user,language);
  await page.locator('a[href="#/content"]:visible').first().click();
  const card=page.locator("[data-study-folder-entry]");await card.waitFor();assert.equal(await page.locator("[data-study-folder-link]").getAttribute("href"),"#/study-folder");
  assert.ok(await page.evaluate(()=>{const card=document.querySelector("[data-study-folder-entry]"),languages=document.querySelector("[data-content-language]");return Boolean(card.compareDocumentPosition(languages)&Node.DOCUMENT_POSITION_FOLLOWING);}));
  const selections=calls.filter(c=>c.path.endsWith("/content-context")&&c.method==="POST").length;
  await page.locator("[data-study-folder-link]").click();await page.locator("[data-folder-item]").first().waitFor();assert.equal(calls.filter(c=>c.path.endsWith("/content-context")&&c.method==="POST").length,selections);
  const snapshot=await prisma.user.findUniqueOrThrow({where:{id:user.id}});for(const key of ["activeContentCollectionId","contentLanguage","contentSelectionVersion","xpTotal"])assert.equal(snapshot[key],before[key]);
  for(const width of [320,375,390,430])for(const dark of [false,true])for(const scale of [100,200]){
   await page.setViewportSize({width,height:844});await page.emulateMedia({colorScheme:dark?"dark":"light",reducedMotion:"reduce"});await page.evaluate(({dark,scale})=>{document.documentElement.classList.toggle("dark",dark);document.documentElement.style.fontSize=`${scale}%`;}, {dark,scale});
   const overflow=await page.evaluate(()=>({page:document.documentElement.scrollWidth>innerWidth+1,clipped:[...document.querySelectorAll("[data-study-folder] input,[data-study-folder] select,[data-folder-item] article")].some(e=>e.getBoundingClientRect().right>innerWidth+1)}));assert.deepEqual(overflow,{page:false,clipped:false},`${language}/${width}/${dark}/${scale}`);
   results.push({language,width,dark,scale,overflow:false});
   if((language==="nl"&&(width===320||width===390)&&scale===200)||width===390&&!dark&&scale===100)await page.screenshot({animations:"disabled",path:`${out}/${language}-${width}-${dark?"dark":"light"}-${scale}.png`});
  }
  await page.evaluate(()=>{document.documentElement.style.fontSize="100%";document.documentElement.classList.remove("dark");});await page.setViewportSize({width:390,height:844});
  await page.locator('[data-folder-color="blue"]').click();await page.locator(`[data-folder-item="highlight:${items.marked.id}"]`).waitFor();assert.equal(await page.locator('[data-folder-item]').count(),1);
  await page.locator('[data-folder-type="note"]').click();
  const searchReady=page.waitForResponse(response=>response.url().endsWith("/study-folder/query")&&response.request().postDataJSON()?.q==="Private study");
  await page.getByRole("searchbox").fill("Private study");await searchReady;await page.waitForFunction(()=>document.querySelector('[data-folder-type="note"]')?.getAttribute("aria-pressed")==="true");assert.equal(new URL(page.url()).searchParams.has("q"),false);assert.equal(new URL(page.url()).hash,"#/study-folder");
  await page.locator("[data-folder-more]").click();await page.waitForFunction(()=>document.querySelectorAll("[data-folder-item]").length===34);
  const last=page.locator("[data-folder-item]").last();await last.scrollIntoViewIfNeeded();const scroll=await page.evaluate(()=>scrollY);await last.locator("[data-folder-open]").click();await page.locator("[data-native-folder-passage] .reader-text").first().waitFor();assert.equal(await page.locator("[data-shell-mode]").getAttribute("data-shell-mode"),"focus");
  await page.locator("[data-folder-return]").click();await page.waitForFunction(()=>document.querySelectorAll("[data-folder-item]").length===34);assert.equal(await page.getByRole("searchbox").inputValue(),"Private study");await page.waitForFunction(previous=>Math.abs(scrollY-previous)<100,scroll);
  const row=page.locator(`[data-folder-item="note:${items.rows[0].id}"]`);await row.locator("[data-folder-edit]").click();const dialog=page.locator("[data-annotation-dialog]");await dialog.locator("textarea").waitFor();
  if(language==="nl"){
   await page.setViewportSize({width:320,height:844});await page.evaluate(()=>{document.documentElement.style.fontSize="200%";document.documentElement.classList.add("dark");});
   await dialog.locator("textarea").focus();const bounds=await dialog.boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=321&&bounds.y+bounds.height<=845);await page.screenshot({animations:"disabled",path:`${out}/nl-editor-320-dark-200.png`});
  }
  await dialog.locator("textarea").fill(`EDITED ${language}`);
  if(language==="nl")loseWrite=true;
  const writes=calls.filter(c=>c.path.endsWith("study-folder/annotations")&&c.method==="POST").length;
  await dialog.getByRole("button",{name:t("annotations.save"),exact:true}).click();
  if(language==="nl"){
   await dialog.getByRole("button",{name:t("annotations.retry"),exact:true}).waitFor();await page.waitForTimeout(350);
   assert.equal(calls.filter(c=>c.path.endsWith("study-folder/annotations")&&c.method==="POST").length,writes+1);
   await dialog.getByRole("button",{name:t("annotations.retry"),exact:true}).click();
   const confirmed=dialog.locator('[role="status"]');await confirmed.filter({hasText:t("annotations.saved")}).waitFor();
   const attempts=calls.filter(c=>c.path.endsWith("study-folder/annotations")&&c.method==="POST");assert.equal(attempts.length,writes+2);assert.equal(attempts.at(-1).actionId,attempts.at(-2).actionId);
   assert.equal((await prisma.note.findUniqueOrThrow({where:{id:items.rows[0].id}})).mutationVersion,2);
  }
  await page.waitForFunction(()=>!document.querySelector('[data-annotation-dialog] button[disabled]'));await dialog.getByRole("button",{name:t("annotations.close"),exact:true}).click();
  await page.waitForFunction(()=>document.activeElement?.hasAttribute("data-folder-edit")||document.activeElement?.hasAttribute("data-folder-type"));
  assert.equal((await prisma.note.findUniqueOrThrow({where:{id:items.rows[0].id}})).text,`EDITED ${language}`);
  await page.evaluate(()=>{document.documentElement.style.fontSize="100%";document.documentElement.classList.remove("dark");});await page.setViewportSize({width:390,height:844});
  await page.reload();await page.locator("[data-folder-item]").first().waitFor();const edited=page.locator(`[data-folder-item="note:${items.rows[0].id}"]`);if(!await edited.count()){await page.locator("[data-folder-more]").click();await edited.waitFor();}
  await edited.locator("[data-folder-edit]").click();await dialog.locator("textarea").waitFor();await dialog.getByRole("button",{name:t("annotations.noteRemove"),exact:true}).click();const confirmation=page.locator("dialog").last();await confirmation.getByRole("button",{name:t("common.cancel"),exact:true}).click();assert.equal((await prisma.note.findUniqueOrThrow({where:{id:items.rows[0].id}})).deletedAt,null);
  await dialog.getByRole("button",{name:t("annotations.noteRemove"),exact:true}).click();await page.locator("dialog").last().getByRole("button",{name:t("common.confirm"),exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-annotation-dialog] textarea')?.value);await dialog.getByRole("button",{name:t("annotations.close"),exact:true}).click();assert.ok((await prisma.note.findUniqueOrThrow({where:{id:items.rows[0].id}})).deletedAt);
  await page.locator('[data-folder-type="bookmark"]').click();await page.locator('[data-folder-source]').selectOption(en.collection.id);const book=page.locator(`[data-folder-item="bookmark:${items.foreign.id}"]`);await book.waitFor();await book.locator("[data-folder-open]").click();await page.locator("[data-native-folder-passage] .reader-text").first().waitFor();assert.equal(await page.locator("[data-shell-mode]").getAttribute("data-shell-mode"),"focus");assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).activeContentCollectionId,f.collection.id);assert.ok(await page.locator(`#vers-${items.verse.number}`).count());
  await page.locator("[data-folder-return]").click();await book.waitFor();assert.equal(await page.locator('[data-folder-type="bookmark"]').getAttribute("aria-pressed"),"true");assert.equal(await page.locator("[data-folder-source]").inputValue(),en.collection.id);
  if(language==="nl"){
   // A delayed private GET must never repopulate the next account's cache/DOM.
   const nextUser=await f.account();await page.locator("[data-folder-source]").selectOption("");holdQuery=true;
   await page.locator('[data-folder-type="note"]').click();await page.getByRole("searchbox").fill("Private study note 2");
   for(let n=0;n<100&&!held.length;n++)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(held.length,1);
   await page.locator('[data-subpage-back-bar] button').click();await page.waitForURL('**#/content');
   await page.locator('[data-subpage-back-bar] button').click();await page.waitForURL('**#/dashboard');
   await page.locator('a[href="#/profile"]:visible').first().click();await page.locator('[data-profile-page]').waitFor();await logoutNativeProfile(page,t);await login(page,nextUser,language);
   await page.locator('a[href="#/content"]:visible').first().click();await page.locator('[data-study-folder-link]').click();await page.locator('[data-folder-empty]').waitFor();held.splice(0).forEach(finish=>finish());await page.waitForTimeout(300);assert.equal(await page.locator('[data-folder-item]').count(),0);assert.ok(!(await page.locator('body').innerText()).includes('Private study note'));
   // Old backends do not advertise an unusable entry.
   noCapability=true;await page.goto(`${origin}/?material=ios&accountLanguage=1&device=folder-${user.id}&probe=older-backend#/content`);await page.locator('[data-content-language]').waitFor();assert.equal(await page.locator('[data-study-folder-entry]').count(),0);noCapability=false;
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 writeFileSync(`${out}/layout-results.json`,JSON.stringify(results,null,2));console.log(`Native studiemap: ${results.length} mobiele taal/thema/tekst/breedtecontroles; echte native handlers, gedeelde editor, paginering, onzekere opslag, verwijderen en terugkeer gecontroleerd. Screenshots: ${out}`);
}catch(error){
 let index=0;for(const context of browser.contexts())for(const page of context.pages()){try{await page.screenshot({animations:"disabled",path:`${out}/failure-${index++}.png`});}catch{}}
 throw error;
}finally{held.splice(0).forEach(finish=>finish());await browser.close();await new Promise(resolve=>front.close(resolve));await prisma.contentCollection.updateMany({where:{id:{in:[f.collection.id,en.collection.id]}},data:{enabled:false}});await prisma.$disconnect();}
