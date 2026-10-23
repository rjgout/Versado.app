// Productiebuild, eigen wegwerp-DB. Afspeelkeuze instrumenteren; routes streamen echte fixturebytes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../src/lib/db.ts';
import { createSessionToken, SESSION_COOKIE } from '../src/lib/auth.ts';
import { getT } from '../src/lib/i18n/index.ts';
const db=new URL(process.env.AUDIO_TEST_DATABASE_URL??'http://invalid'),base=process.env.AUDIO_TEST_BASE_URL;
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_audio_test'||process.env.DATABASE_URL!==db.href||new URL(base).hostname!=='127.0.0.1')throw new Error('Eigen audiorunner vereist');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright'),output='/tmp/versado-audio-browser';mkdirSync(output,{recursive:true});
const t=getT('nl'),results=[];
const check=(name,value)=>{results.push({name,ok:Boolean(value)});console.log(value?'OK':'FAIL',name);assert.ok(value,name);};
const browser=await chromium.launch({args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH});
async function account(isAdmin){const user=await prisma.user.create({data:{email:`${randomUUID()}@audio-browser.invalid`,handle:'A'+randomUUID().slice(0,8),discriminator:'00',passwordHash:'unused',isAdmin}});return {user,token:await createSessionToken(user.id)};}
const ordinary=await account(false),admin=await account(true),chapter=await prisma.chapter.findFirstOrThrow({where:{book:{contentCollectionId:'audio-test-nl'},number:1}}),pointer=await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:'chapter:'+chapter.id}});
copyFileSync(join(process.env.AUDIO_TEST_ROOT,'fixture.mp3'),join(process.env.AUDIO_TEST_ROOT,'legacy.mp3'));
const book=await prisma.book.findUniqueOrThrow({where:{id:chapter.bookId}});
await prisma.contentCollection.create({data:{id:'audio-test-en',slug:'audio-test-en',name:'English test',icon:'book',work:'bofm',language:'en',editionKey:'default',enabled:true,visibleToUsers:true,publicationState:'PUBLISHED'}});
await prisma.book.create({data:{slug:'audio-browser-en',key:book.key,name:'English test',order:999,contentCollectionId:'audio-test-en',chapters:{create:{number:1,order:0,audioUrl:'https://assets.churchofjesuschrist.org/legacy.mp3',verses:{create:[{number:1,text:'Synthetic English first text',audioStart:0.2},{number:2,text:'Synthetic English second text',audioStart:1.2}]}}}}});
const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});await ctx.addCookies([{name:SESSION_COOKIE,value:ordinary.token,url:base}]);
const cookie=`${SESSION_COOKIE}=${ordinary.token}`,adminCookie=`${SESSION_COOKIE}=${admin.token}`;
const req=(path,headers={})=>fetch(base+path,{headers:{cookie,...headers}});
try{
 check('onbevoegd audiostreamen geeft 401',(await fetch(base+'/api/audio/recordings/'+pointer.recordingId)).status===401);
 check('gewone gebruiker krijgt geen beheeroverzicht',(await req('/api/admin/audio')).status===403);
 check('beheer-API weert vreemde origin',(await fetch(base+'/api/admin/audio',{method:'POST',headers:{cookie:adminCookie,origin:'https://foreign.invalid','content-type':'application/json'},body:JSON.stringify({recordingId:pointer.recordingId,expectedVersion:2})})).status===403);
 const range=await req('/api/audio/recordings/'+pointer.recordingId,{range:'bytes=0-15'});check('geauthenticeerd Range-verzoek streamt echte bytes',range.status===206&&(await range.arrayBuffer()).byteLength===16&&range.headers.get('cache-control')==='private, no-store');
 const head=await fetch(base+'/api/audio/recordings/'+pointer.recordingId,{method:'HEAD',headers:{cookie}});check('HEAD behoudt formaat en leeg responsebody',head.status===200&&Number(head.headers.get('content-length'))>0&&(await head.text())==='');
 check('legacyroute bewaakt bestaande contentrechten',(await req('/api/audio/legacy.mp3')).status===200);
 const inactive=await prisma.audioRecording.findUniqueOrThrow({where:{packageId:'first'}});check('vervangen opname niet via oud ID beschikbaar',(await req('/api/audio/recordings/'+inactive.id)).status===404);
 const ed=await (await req(`/api/chapters/${chapter.id}/audio-languages`)).json();check('taaloverzicht gebruikt actieve nieuwe opname en Engelse terugval',ed.editions.find(e=>e.language==='nl')?.url===`/api/audio/recordings/${pointer.recordingId}`&&ed.editions.find(e=>e.language==='en')?.url==='/api/audio/legacy.mp3');
 await ctx.addInitScript(()=>{
  window.__audio=[];window.__spoken=[];
  const proto=HTMLMediaElement.prototype,times=new WeakMap();
  Object.defineProperty(proto,'currentTime',{configurable:true,get(){return times.get(this)??0;},set(v){times.set(this,v);}});
  proto.load=function(){setTimeout(()=>this.onloadedmetadata?.(),0);};proto.pause=function(){};proto.play=function(){window.__audio.push({src:this.src,at:this.currentTime});return Promise.resolve();};
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],cancel(){},pause(){},resume(){},speak(u){window.__spoken.push({text:u.text,lang:u.lang});}}});window.SpeechSynthesisUtterance=function(text){this.text=text;};
 });
 let page=await ctx.newPage();await page.goto(`${base}/lesson/${chapter.id}`);await page.getByRole('button',{name:t('player.readAloud'),exact:false}).waitFor();
 await page.getByRole('button',{name:t('player.readAloud'),exact:false}).click();await page.waitForFunction(()=>window.__audio.length>0);
 check('standaardtaal start nieuwe opname via bestaande speler',await page.evaluate(id=>window.__audio.at(-1).src.endsWith('/api/audio/recordings/'+id),pointer.recordingId));
 check('bestaande minispeler is actief',await page.getByRole('button',{name:t('player.stopAria'),exact:true}).count()===1);
 await page.getByRole('button',{name:t('player.stopAria'),exact:true}).click();
 await page.evaluate(()=>localStorage.setItem('jehovaapp-read-aloud-language','en'));await page.reload();await page.getByRole('button',{name:t('player.readAloud'),exact:false}).click();await page.waitForFunction(()=>window.__audio.length>0);
 check('bewaarde taalkeuze behoudt Engelse audio',await page.evaluate(()=>window.__audio.at(-1).src.endsWith('/api/audio/legacy.mp3')));
 await page.getByRole('button',{name:t('player.stopAria'),exact:true}).click();
 const tts=await prisma.chapter.create({data:{bookId:book.id,number:3,order:3,verses:{create:{number:1,text:'Synthetische TTS-terugval'}}}});
 await page.evaluate(()=>localStorage.removeItem('jehovaapp-read-aloud-language'));await page.goto(`${base}/lesson/${tts.id}`);await page.getByRole('button',{name:t('player.readAloud'),exact:false}).click();await page.waitForFunction(()=>window.__spoken.length>0);
 check('ontbrekende opname gebruikt apparaat-TTS',await page.evaluate(()=>window.__spoken[0].text==='Synthetische TTS-terugval'));
 await page.close();
 const adminContext=await browser.newContext({viewport:{width:320,height:900},serviceWorkers:'block'});await adminContext.addCookies([{name:SESSION_COOKIE,value:admin.token,url:base}]);page=await adminContext.newPage();
 check('Schriftbeheer blijft achter webauthenticatie',(await fetch(base+'/api/admin/scripture-update')).status===401&&(await req('/api/admin/scripture-update')).status===403);
 check('audiocontrole blijft achter beheerrechten',(await req('/api/admin/audio-checks')).status===403);
 check('Schriftpublicatie weert vreemde origin',(await fetch(base+'/api/admin/scripture-update',{method:'POST',headers:{cookie:adminCookie,origin:'https://foreign.invalid','content-type':'application/json'},body:JSON.stringify({action:'publish',planHash:'a'.repeat(64)})})).status===403);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Alleen de UI-transportlaag simuleren: echte publicatie/planvalidatie wordt afzonderlijk in content-update.integration getest.
 const posts=[],planHash='a'.repeat(64);
 let job={status:'done',action:'prepare',results:[],upToDate:false,logs:[],error:null};
 await page.route('**/api/admin/scripture-update',async route=>{
  if(route.request().method()==='POST') {posts.push(route.request().postDataJSON());job={...job,status:'running',action:'publish'};await route.fulfill({json:{started:true,job}});}
  else await route.fulfill({json:{job,needsReview:0,runs:[{id:'browser-plan',kind:'SCRIPTURE_PREPARE',status:'OK',startedAt:'2026-01-01T00:00:00Z',durationMs:1,planHash}]}});
 });
 const openScripture=async()=>{await page.goto(base+'/adminbackend/systeem');const button=page.getByRole('button',{name:t('adminContentUpdate.publish'),exact:true,includeHidden:true});await button.waitFor({state:'attached'});await page.locator('details').filter({has:button}).locator('summary').first().click();return button;};
 for(const width of [320,390,768]) {
  job={...job,status:'done',action:'prepare'};await page.setViewportSize({width,height:900});const publish=await openScripture();
  await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  check(`Schriftbeheer past op ${width}px met 200% tekst`,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await publish.click();await page.getByRole('dialog').getByRole('button',{name:t('common.cancel'),exact:true}).click();
  check(`annuleren publiceert niets op ${width}px`,posts.length===0);
 }
 await page.getByRole('button',{name:t('adminContentUpdate.publish'),exact:true}).click();
 const sent=page.waitForResponse(r=>r.url().endsWith('/api/admin/scripture-update')&&r.request().method()==='POST');
 await page.getByRole('dialog').getByRole('button',{name:t('adminContentUpdate.publish'),exact:true}).click();await sent;
 check('Schriftpublicatie stuurt uitsluitend het voorbereide plan',posts.length===1&&posts[0].action==='publish'&&posts[0].planHash===planHash);
 await page.getByRole('button',{name:t('adminContentUpdate.check'),exact:true}).waitFor();
 await page.waitForFunction(label=>[...document.querySelectorAll('button')].find(b=>b.textContent===label)?.disabled,t('adminContentUpdate.check'));
 check('lopende Schriftpublicatie blokkeert dubbele acties',await page.getByRole('button',{name:t('adminContentUpdate.prepare'),exact:true}).isDisabled());
 const running=await openScripture();check('herladen behoudt de lopende taak',await running.isDisabled());
 await page.setViewportSize({width:320,height:900});
 await page.goto(base+'/adminbackend/content/audio');await page.getByRole('heading',{name:t('audioLibrary.title'),exact:true}).waitFor();
 check('beheeroverzicht rendert',await page.getByText(t('audioLibrary.legacy'),{exact:true}).count()===1);
 await page.locator('summary').filter({hasText:'Audio test · nl'}).first().click();await page.locator('details[open] summary').filter({hasText:t('audioLibrary.view')}).first().click();
 check('beheer toont opnamen en kwaliteitsstatus',await page.locator('details[open] > div > details[open]').getByText(/Kwaliteit: VALIDATED/).first().isVisible());
 const candidateRow=page.locator('li').filter({has:page.locator(`a[href="/api/audio/recordings/${inactive.id}?preview=1"]`)});
 await candidateRow.getByRole('button',{name:t('audioLibrary.publish'),exact:true}).click();
 const posted=page.waitForResponse(r=>r.url().endsWith('/api/admin/audio')&&r.request().method()==='POST');
 await page.getByRole('dialog').getByRole('button',{name:t('audioLibrary.publish'),exact:true}).click();
 check('beheerbevestiging publiceert via bestaande interface',(await posted).status()===200);
 const updated=await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:'chapter:'+chapter.id}});
 check('publicatie vervangt alleen de pointer',updated.recordingId===inactive.id&&updated.version===3);
 pointer.recordingId=updated.recordingId;
 await page.screenshot({path:join(output,'admin-320.png'),fullPage:true});
 check('geen horizontale overflow op 320px',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.evaluate(()=>document.documentElement.style.fontSize='200%');check('tekstschaling behoudt leesbare breedte',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(output,'admin-320-text200.png'),fullPage:true});
 await prisma.user.update({where:{id:admin.user.id},data:{uiLanguage:'de'}});
 await page.reload();await page.getByRole('heading',{name:getT('de')('audioLibrary.title'),exact:true}).waitFor();
 await page.evaluate(()=>document.documentElement.style.fontSize='200%');
 check('lange Duitse vertaling behoudt breedte op 320px en 200%',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:join(output,'admin-320-de-text200.png'),fullPage:true});
 check('geen browserexceptions',errors.length===0);
 await adminContext.close();
 await prisma.contentCollection.update({where:{id:'audio-test-nl'},data:{visibleToUsers:false}});check('verbergen sluit bestaande audio-URL af',(await req('/api/audio/recordings/'+pointer.recordingId)).status===404);await prisma.contentCollection.update({where:{id:'audio-test-nl'},data:{visibleToUsers:true}});
 await prisma.user.update({where:{id:ordinary.user.id},data:{sessionVersion:{increment:1}}});check('sessie-intrekking sluit audiostream af',(await req('/api/audio/recordings/'+pointer.recordingId)).status===401);
}finally{writeFileSync(join(output,'results.json'),JSON.stringify(results,null,2));await ctx.close();await browser.close();await prisma.$disconnect();}
