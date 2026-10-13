// Echte productie-interface, uitsluitend de eigen content-architecture database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/db.ts';
import { SESSION_COOKIE } from '../src/lib/auth.ts';
import { mysteryFixture, mysteryAccount } from './fixtures/mystery.ts';
import { MYSTERY_GAME } from '../src/lib/mysteries/game.ts';
const url=new URL(process.env.CONTENT_ACCESS_TEST_DATABASE_URL??'http://invalid');
const base=process.env.CONTENT_ACCESS_TEST_BASE_URL;
if(url.hostname!=='127.0.0.1'||url.pathname!=='/versado_content_access_test'||new URL(base).hostname!=='127.0.0.1')throw new Error('Eigen runner vereist');
const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const output='/tmp/versado-mystery-browser';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH});const results=[];const errors=[];
const d=MYSTERY_GAME.puzzles[0];
async function contextFor(u,width,scheme='light'){
 const context=await browser.newContext({viewport:{width,height:width<500?844:900},colorScheme:scheme,hasTouch:width<500,isMobile:width<500,serviceWorkers:'block'});
 await context.addCookies([{name:SESSION_COOKIE,value:u.token,url:base}]);return context;
}
async function ready(page){await page.goto(`${base}/mysteries/001a/play`);await page.locator('[data-mystery-save-status="saved"]').waitFor();await page.getByRole('gridcell').first().waitFor();}
async function placed(page,name,cell,touch=false){
 const character=page.getByRole('button',{name:new RegExp(`^${name}, Sleep`)});
 if(touch)await character.tap();else{await character.focus();await page.keyboard.press('Enter');}
 const target=page.locator(`[role="gridcell"][aria-rowindex="${cell.row}"][aria-colindex="${cell.column}"]`);
 if(touch)await target.tap();else{await target.focus();await page.keyboard.press('Enter');}
 await page.waitForFunction(([row,column,name])=>document.querySelector(`[role="gridcell"][aria-rowindex="${row}"][aria-colindex="${column}"]`)?.getAttribute('aria-label')?.includes(name),[cell.row,cell.column,name]);
 await page.locator('[data-mystery-save-status="saved"]').waitFor();
}
async function snapshot(userId){return prisma.mysteryAttempt.findFirstOrThrow({where:{userId,active:true}});}
try{
 await mysteryFixture();
 for(const width of [320,390,1280])for(const scheme of ['light','dark']){
  const u=await mysteryAccount();await prisma.mysteryProgress.create({data:{userId:u.id,mysteryId:d.mysteryId,difficulty:'DISCOVERER',tutorialSeenAt:new Date()}});
  const context=await contextFor(u,width,scheme);let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());await ready(page);
  for(const character of d.characters.slice(0,3))await placed(page,character.name,d.solution[character.id],width<500);
  await page.getByRole('button',{name:'Nog niet verwerkt',exact:true}).first().click();await page.locator('[data-mystery-save-status="saved"]').waitFor();
  const saved=await snapshot(u.id);assert.equal(Object.values(saved.placements).filter(Boolean).length,3);assert.equal(Object.values(saved.clueNotes).filter(Boolean).length,1);
  await page.reload();await page.locator('[data-mystery-save-status="saved"]').waitFor();assert.deepEqual((await snapshot(u.id)).placements,saved.placements);assert.equal(await page.getByRole('button',{name:'Volgens mij verwerkt',exact:true}).count(),1);
  const bounds=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,top:document.querySelector('.mystery-game-layout').getBoundingClientRect().top,header:document.querySelector('[data-sticky-header]').getBoundingClientRect().bottom}));assert.equal(bounds.overflow,false);// Na refresh mag de browser de eerdere desktopscroll bewaren. Meet de
  // shellgeometrie daarom bij expliciet bovenaan bekijken, niet halverwege.
  // Een echte gebruikersactie beëindigt de centrale restore-loop. Een losse
  // scrollTo direct na refresh kan op het volgende frame teruggedraaid worden.
  await page.keyboard.press('Control+Home');
  await page.waitForFunction(()=>window.scrollY<=1);
  const top=await page.evaluate(()=>({content:document.querySelector('.mystery-game-layout').getBoundingClientRect().top,header:document.querySelector('[data-sticky-header]').getBoundingClientRect().bottom}));
  assert.ok(top.content>=top.header-1,JSON.stringify({width,scheme,top}));
  await page.screenshot({path:`${output}/${width}-${scheme}-resume.png`,fullPage:true});
  await context.close();
  await prisma.user.update({where:{id:u.id},data:{activeContentCollectionId:'content_podcasts',contentLanguage:'en'}});
  const device=await contextFor(u,width,scheme);page=await device.newPage();await ready(page);assert.deepEqual((await snapshot(u.id)).placements,saved.placements);assert.equal((await snapshot(u.id)).contentCollectionId,'content_bom');
  assert.equal(await page.locator('.mystery-character-pane button[aria-pressed="true"]').count(),1);
  await device.close();results.push({width,scheme,touch:width<500,keyboard:width===1280,refreshAndNewDevice:true,sourceSwitch:true,scrollRestoredBounds:bounds,topBounds:top});
 }
 // Twee echte browsers: oude save botst, expliciet laden vervangt pas na bevestiging.
 const u=await mysteryAccount();await prisma.mysteryProgress.create({data:{userId:u.id,mysteryId:d.mysteryId,difficulty:'DISCOVERER',tutorialSeenAt:new Date()}});
 const a=await contextFor(u,390),b=await contextFor(u,1280);const p=await a.newPage(),q=await b.newPage();q.on('dialog',d=>d.accept());await ready(p);await ready(q);
 await placed(p,'Lehi',d.solution.lehi,true);
 await q.getByRole('button',{name:'Nog niet verwerkt',exact:true}).first().click();await q.locator('[data-mystery-save-status="conflict"]').waitFor();assert.equal((await snapshot(u.id)).placements.lehi.row,d.solution.lehi.row);
 await q.getByRole('button',{name:'Nieuwere spelstand ophalen',exact:true}).click();await q.getByRole('dialog').getByRole('button',{name:'Nieuwere spelstand ophalen',exact:true}).click();await q.locator('[data-mystery-save-status="saved"]').waitFor();
 assert.equal(await q.getByRole('button',{name:new RegExp('^Lehi,.*Lehi')}).count(),1);
 // Netwerkfout toont onopgeslagen; retry + snelle navigatie bewaren de wijziging.
 await q.route('**/api/mysteries/attempts',route=>route.request().method()==='POST'?route.abort():route.continue());
 await q.getByRole('button',{name:'Nog niet verwerkt',exact:true}).first().click();await q.locator('[data-mystery-save-status="unsaved"]').waitFor();
 await q.screenshot({path:`${output}/desktop-unsaved.png`,fullPage:true});await q.unroute('**/api/mysteries/attempts');await q.getByRole('button',{name:'Opnieuw proberen',exact:true}).click();await q.locator('[data-mystery-save-status="saved"]').waitFor();
 const updated=await snapshot(u.id);assert.equal(Object.values(updated.clueNotes).filter(Boolean).length,1);
 // Een verloren hintresponse mag bij opnieuw tikken maar eenmaal betalen.
 let lose=true;await q.route('**/api/mysteries/attempts',async route=>{
  const data=route.request().postDataJSON();if(data?.action==='hint'&&lose){lose=false;await route.fetch();await route.abort();}else await route.continue();
 });
 const hintButton=q.getByRole('button',{name:'Hint gebruiken',exact:true});await hintButton.click();await q.getByRole('dialog').getByRole('button',{name:'Hint gebruiken',exact:true}).click();
 await q.waitForFunction(()=>document.querySelector('.mystery-action-bar button[title="Hint gebruiken"]')?.disabled===false);await q.unroute('**/api/mysteries/attempts');
 assert.equal((await prisma.user.findUniqueOrThrow({where:{id:u.id}})).hintBalance,7);
 await hintButton.click();await q.getByRole('dialog').getByRole('button',{name:'Hint gebruiken',exact:true}).click();await q.getByRole('dialog').waitFor();assert.equal((await snapshot(u.id)).hintUses.length,1);assert.equal((await prisma.user.findUniqueOrThrow({where:{id:u.id}})).hintBalance,7);
 await q.screenshot({path:`${output}/desktop-hint-retry.png`,fullPage:true});await q.getByRole('dialog').getByRole('button',{name:'Sluiten',exact:true}).click();
 // Lokaal noodjournal: verloren save-response + afsluiten/heropenen herhaalt dezelfde actie.
 await q.route('**/api/mysteries/attempts',async route=>{if(route.request().postDataJSON()?.action==='save'){await route.fetch();await route.abort();}else await route.continue();});
 await q.getByRole('button',{name:'Nog niet verwerkt',exact:true}).first().click();await q.locator('[data-mystery-save-status="unsaved"]').waitFor();await q.unroute('**/api/mysteries/attempts');await q.reload();await q.locator('[data-mystery-save-status="saved"]').waitFor();
 assert.equal(Object.values((await snapshot(u.id)).clueNotes).filter(Boolean).length,2);
 // Voltooien, refresh en bewust herspelen behouden historisch resultaat en betaalde hints.
 for(const character of d.characters.slice(1))await placed(q,character.name,d.solution[character.id]);
 await q.getByRole('button',{name:'Controleer oplossing',exact:true}).click();await q.getByRole('heading',{name:'Mysterie opgelost!',exact:true}).waitFor();
 const history=await prisma.mysteryProgress.findFirstOrThrow({where:{userId:u.id,mysteryId:d.mysteryId,difficulty:'DISCOVERER'}});assert.equal(history.hintCount,1);
 await q.screenshot({path:`${output}/desktop-completed.png`,fullPage:true});
 await q.goto(`${base}/mysteries/001a/play?resume=completed`);await q.getByRole('heading',{name:'Mysterie opgelost!',exact:true}).waitFor();
 await q.getByRole('button',{name:'Opnieuw spelen',exact:true}).click();await q.locator('[data-mystery-save-status="saved"]').waitFor();
 const replay=await snapshot(u.id);assert.equal(Object.values(replay.placements).some(Boolean),false);assert.equal(replay.hintUses.length,0);assert.equal((await prisma.user.findUniqueOrThrow({where:{id:u.id}})).hintBalance,7);
 assert.deepEqual(await prisma.mysteryProgress.findUniqueOrThrow({where:{id:history.id}}),history);
 await a.close();await b.close();results.push({twoDevices:true,revisionConflict:true,failedSaveRetry:true,lostHintResponseExactlyOnce:true,localJournalRetry:true});
 // Licht/donker 320px, tekstvergroting 200%: opslagbediening blijft binnen viewport.
 for(const scheme of ['light','dark']){
  const context=await contextFor(u,320,scheme);const page=await context.newPage();await ready(page);await page.evaluate(()=>document.documentElement.style.fontSize='32px');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:`${output}/320-${scheme}-200-text.png`,fullPage:true});await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify({mysteryBrowserFlows:results.length,physicalIosAndroid:false,screenshots:output,errors}));
}catch(error){
 let index=0;for(const context of browser.contexts())for(const page of context.pages()){if(!page.isClosed()){await page.screenshot({path:`${output}/failure-${index++}.png`,fullPage:true}).catch(()=>{});}}
 throw error;
}finally{await browser.close();await prisma.$disconnect();}
