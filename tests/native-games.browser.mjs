import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {existsSync,readFileSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {prisma} from '../src/lib/db.ts';
import {hashPassword} from '../src/lib/auth.ts';
import {getT} from '../src/lib/i18n/index.ts';
import {getTopic,topicTitle} from '../src/lib/kompas/registry.ts';
import {GAME_CATALOG} from '../src/lib/gameCatalog.ts';
import {nativeGamesContent} from './fixtures/native-games-content.mjs';
const backend=process.env.NATIVE_TEST_BASE_URL;
if(!backend||new URL(backend).hostname!=='127.0.0.1')throw Error('Alleen eigen lokale speltestserver');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-browser/spelen';mkdirSync(out,{recursive:true});
for(const file of ['resultaten.json','foutcategorieen.json','mislukte-proef.png'])if(existsSync(out+'/'+file))unlinkSync(out+'/'+file);
const compilation=await build({entryPoints:['tests/fixtures/native-games-client.tsx'],bundle:true,write:false,platform:'browser',define:{'process.env.NODE_ENV':'"production"',TEST_GAME_BACKEND:JSON.stringify(backend)},minify:true});
const fixture=await nativeGamesContent(prisma),password='Synthetic-game-browser-42',calls=[],errors=[],missing=[];let saved=null;
const user=await prisma.user.create({data:{email:`native-games-${randomUUID()}@example.invalid`,passwordHash:await hashPassword(password),handle:'Spelentest',discriminator:'42',emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:'content_bom',xpTotal:1000,hintBalance:20}});
const peer=await prisma.user.create({data:{email:`native-game-peer-${randomUUID()}@example.invalid`,passwordHash:'synthetic-only',handle:'Spelvriend',discriminator:'42',emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:'content_bom'}});
await prisma.friendship.create({data:{senderId:user.id,receiverId:peer.id,status:'ACCEPTED'}});
const challenge=await prisma.challenge.create({data:{chapterId:fixture.chapters[0].id,senderId:user.id,receiverId:peer.id,status:'ACCEPTED'}});
const front=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/v1/native/')){
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await fetch(backend+req.url,{method:req.method,headers:{Origin:'capacitor://localhost','X-Versado-Client':'native-v1','x-real-ip':'127.0.0.44',...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  calls.push({path:url.pathname,method:req.method,status:response.status});res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(await response.text());return;
 }
 if(url.pathname==='/test-keychain/device'){if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);saved=Buffer.concat(chunks).toString();}if(req.method==='DELETE')saved=null;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:saved}));return;}
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(compilation.outputFiles[0].text);return;}
 if(url.pathname==='/index.css'){res.setHeader('Content-Type','text/css');res.end(readFileSync('dist/native/index.css'));return;}
 if(/\.(?:png|svg|webp|jpg|jpeg|json)$/.test(url.pathname)){
  const file=resolve('dist/native','.'+url.pathname);assert.ok(file.startsWith(resolve('dist/native')+'/'));
  if(!existsSync(file)){missing.push(url.pathname);res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',url.pathname.endsWith('.json')?'application/json':url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.jpg')||url.pathname.endsWith('.jpeg')?'image/jpeg':'image/webp');res.end(readFileSync(file));return;
 }
 if(url.pathname.startsWith('/api/')){calls.push({path:url.pathname,status:404});res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><script>window.CapacitorCustomPlatform={name:"ios"};</script><div id="root"></div><script src="/app.js"></script></body></html>');
}catch(error){errors.push(error.message);res.writeHead(500);res.end();}});
await new Promise(done=>front.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${front.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const report={screens:[],languages:[],routes:[],flows:[],calls:[]};let activePage;
try{
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL',deviceScaleFactor:1,hasTouch:true,isMobile:true});
 const page=await context.newPage();activePage=page;page.on('pageerror',e=>errors.push(e.message));
 const t=getT('nl');await page.goto(origin+'/?material=ios#/live');
 await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.locator('a[data-kompas-target="profile"]').waitFor();
 async function hub(refresh=false){if(new URL(page.url()).hash!=="#/live")await page.goBack();if(refresh)await page.reload();await page.locator('[data-kompas-target="play-games"]').waitFor();for(const game of GAME_CATALOG)assert.ok(await page.locator(`a[href="#${game.href}"]`).count(),game.id);}
 await hub();await page.screenshot({path:out+'/spelen-overzicht-licht.png',fullPage:true});report.screens.push('spelen-overzicht-licht.png');
 await page.screenshot({path:out+'/spelen-overzicht-viewport.png'});report.screens.push('spelen-overzicht-viewport.png');
 for(const game of GAME_CATALOG){
  await hub();await page.locator(`[data-kompas-target="play-games"] a[href="#${game.href}"]`).first().click();
  await page.waitForFunction(()=>!document.querySelector('main')?.textContent?.includes('Bezig met laden'));
  await page.locator('main h1,main h2').first().waitFor();
  assert.ok(!await page.getByRole('alert').count(),game.id+': '+await page.getByRole('alert').allTextContents());
  await page.screenshot({path:out+'/'+game.id+'.png',fullPage:true});report.routes.push(game.id);
 }
 // Dezelfde echte bediening van starten tot resultaat, niet alleen de catalogus.
 await hub();await page.locator('[data-kompas-target="play-games"] a.card-title-link[href="#/word-search"]').click();
 await page.getByRole('button',{name:t('wordSearch.start'),exact:true}).click();await page.getByRole('grid').waitFor();
 const gameId=new URL(page.url()).hash.split('/').at(-1),game=await prisma.wordSearchGame.findUnique({where:{id:gameId,userId:user.id}});assert.ok(game);
 const words=JSON.parse(game.words);
 for(let i=0;i<words.length;i++){
  const word=words[i],grid=page.getByRole('grid');await grid.scrollIntoViewIfNeeded();
  const first=await page.locator(`[data-cell][data-row="${word.start.row}"][data-col="${word.start.col}"]`).boundingBox(),last=await page.locator(`[data-cell][data-row="${word.end.row}"][data-col="${word.end.col}"]`).boundingBox();assert.ok(first&&last);
  await page.mouse.move(first.x+first.width/2,first.y+first.height/2);await page.mouse.down();await page.mouse.move(last.x+last.width/2,last.y+last.height/2,{steps:8});await page.mouse.up();
  await page.getByText(t('wordSearch.found',{found:i+1,total:words.length}),{exact:true}).waitFor();
 }
 await page.getByRole('heading',{name:t('wordSearch.completed'),exact:true}).waitFor();await page.screenshot({path:out+'/word-search-resultaat.png',fullPage:true});report.screens.push('word-search-resultaat.png');report.flows.push('word-search-start-select-complete-xp');
 await page.getByRole('link',{name:t('wordSearch.backToGames'),exact:true}).click();await page.locator('[data-kompas-target="play-games"]').waitFor();
 // De echte Uitdagingen-route opent de volledige gedeelde les, audio en annotatie-editor.
 await page.locator('[data-kompas-target="play-games"] a.card-title-link[href="#/challenges"]').click();
 await page.getByRole('button',{name:t('challenges.playTurn'),exact:true}).click();
 await page.waitForURL(url=>url.hash===`#/lesson/${fixture.chapters[0].id}?challengeId=${challenge.id}`);
 await page.locator('[data-native-read-aloud] button.w-full:not(:disabled)').waitFor();
 await page.locator('[data-native-read-aloud] button.w-full').click();
 await page.waitForFunction(()=>window.gameAudioEvidence?.starts>0);
 await page.getByRole('button',{name:t('annotations.verseActions',{number:1}),exact:true}).click();
 await page.getByRole('button',{name:t('annotations.bookmarkAdd'),exact:true}).click();
 await page.getByRole('button',{name:t('annotations.bookmarkRemove'),exact:true}).waitFor();
 await page.getByRole('button',{name:t('annotations.close'),exact:true}).click();
 await page.screenshot({path:out+'/uitdaging-lezen-annotatie-audio.png',fullPage:true});report.screens.push('uitdaging-lezen-annotatie-audio.png');report.flows.push('challenge-full-reader-native-audio-private-bookmark');
 assert.equal((await prisma.bookmark.findMany({where:{userId:user.id,deletedAt:null}})).length,1);
 await page.getByRole('button',{name:t('progress.practice',{n:3}),exact:true}).click();
 for(let index=0;index<3;index++){
  const truth=page.getByRole('button',{name:'✅ '+t('lesson.true'),exact:true});
  if(await truth.count())await truth.click();else await page.getByRole('button',{name:'synthetische',exact:true}).click();
  await page.getByRole('button',{name:t('lesson.check'),exact:true}).click();
  await page.getByText(t('lesson.correctTitle'),{exact:true}).waitFor();
  await page.getByRole('button',{name:t('lesson.continue'),exact:true}).click();
 }
 await page.getByRole('heading',{name:t('lesson.score',{correct:3,total:3,pct:100}),exact:true}).waitFor();
 const completedChallenge=await prisma.challenge.findUnique({where:{id:challenge.id}});assert.equal(completedChallenge.senderScore,100);assert.ok(completedChallenge.senderCompletedAt);
 await page.screenshot({path:out+'/uitdaging-vragen-resultaat.png',fullPage:true});report.screens.push('uitdaging-vragen-resultaat.png');report.flows.push('challenge-three-real-exercises-and-server-result');

 await page.goBack();await page.goBack();await page.locator('[data-kompas-target="play-games"]').waitFor();
 // De hintvoorraad wordt via dezelfde echte winkel gekocht en server-side afgeschreven.
 const stockBefore=await prisma.user.findUniqueOrThrow({where:{id:user.id}});
 await page.goto(origin+'/?material=ios&cold=shop#/shop');
 await page.getByRole('button',{name:t('shop.buyFor',{xp:50}),exact:true}).click();
 await page.getByText(t('shop.hintBought',{n:1}),{exact:true}).waitFor();
 const stockAfter=await prisma.user.findUniqueOrThrow({where:{id:user.id}});assert.equal(stockAfter.hintBalance,stockBefore.hintBalance+1);assert.equal(stockAfter.xpTotal,stockBefore.xpTotal-50);
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:out+'/spelhints-winkel.png',fullPage:true});report.screens.push('spelhints-winkel.png');report.flows.push('game-shop-hints-real-xp-and-inventory');
 // Koude start op een toegestane lokale uitlegroute, met dezelfde duurzame login.
 await page.goto(origin+'/?material=ios&cold=guide#/kompas/play');await page.getByRole('heading',{name:topicTitle(getTopic('play'),t,'novi'),exact:true}).waitFor();
 await page.getByRole('button',{name:t('kompas.topic.tourStart'),exact:true}).click();
 await page.waitForURL(url=>url.hash==='#/live');await page.locator('[data-kompas-target="play-games"]').waitFor();
 await page.locator('[data-kompas-tour] [role="dialog"]').waitFor();await page.getByRole('button',{name:t('kompas.tour.close'),exact:true}).click();
 report.flows.push('play-guide-and-native-tour-navigation');
 for(const language of ['nl','en','de','fr','es']){
  await prisma.user.update({where:{id:user.id},data:{uiLanguage:language}});await hub(true);await page.waitForFunction(expected=>document.documentElement.lang===expected,language);
  assert.equal(await page.locator('html').getAttribute('lang'),language);report.languages.push(language);
 }
 await prisma.user.update({where:{id:user.id},data:{uiLanguage:'nl'}});await hub(true);
 await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});await page.screenshot({path:out+'/spelen-overzicht-donker.png',fullPage:true});report.screens.push('spelen-overzicht-donker.png');
 await page.setViewportSize({width:320,height:640});await page.addStyleTag({content:'html{font-size:200%}'});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'320px/200%: geen horizontale overflow');
 assert.deepEqual(missing,[],'alle spelbeelden komen uit de verpakte bundel');assert.deepEqual(errors,[],'geen browserfouten');
 assert.ok(calls.every(call=>call.path.startsWith('/api/v1/native/')),'geen cookie-/web-API-fallback');
 report.calls=calls;writeFileSync(out+'/resultaten.json',JSON.stringify(report,null,2));console.log('Native Spelen-browserbewijs:',JSON.stringify({games:report.routes,languages:report.languages,missingAssets:missing.length,browserErrors:errors.length,screenshots:out}));
}catch(error){writeFileSync(out+"/foutcategorieen.json",JSON.stringify({errors,calls,missing,url:activePage?.url()},null,2));if(activePage){await activePage.screenshot({path:out+"/mislukte-proef.png",fullPage:true}).catch(()=>{});console.error("Spelen-proef:",JSON.stringify({errors,calls,missing,visibleText:(await activePage.locator("body").innerText().catch(()=>" ")).slice(0,2000)}));}throw error;}finally{await browser.close();await new Promise(done=>front.close(done));await prisma.user.delete({where:{id:user.id}});await prisma.user.delete({where:{id:peer.id}});await fixture.cleanup();await prisma.$disconnect();}
