// Eigen DB en gecontroleerde HTTP-bedieningsfixtures; geen productiehandelingen.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {prisma} from '../src/lib/db.ts';
import {createSessionToken,SESSION_COOKIE} from '../src/lib/auth.ts';
import {getT} from '../src/lib/i18n/index.ts';
import {LEGACY_PILOT_IDS,prepareLegacyConversion} from '../src/lib/audio/legacyConversion.ts';
const url=new URL(process.env.AUDIO_TEST_DATABASE_URL??'http://invalid'),base=process.env.AUDIO_TEST_BASE_URL;
if(url.hostname!=='127.0.0.1'||url.pathname!=='/versado_audio_test'||process.env.DATABASE_URL!==url.href||new URL(base).hostname!=='127.0.0.1')throw Error('Eigen audiorunner vereist');
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE??'playwright'),output='/tmp/versado-audio-browser';mkdirSync(output,{recursive:true});
const results=[],check=(name,value)=>{results.push({name,ok:!!value});assert.ok(value,name);console.log('OK',name);};
const actor=await prisma.user.create({data:{email:randomUUID()+'@legacy-browser.invalid',handle:'L'+randomUUID().slice(0,8),discriminator:'01',passwordHash:'unused',isAdmin:true}}),ordinary=await prisma.user.create({data:{email:randomUUID()+'@legacy-browser.invalid',handle:'L'+randomUUID().slice(0,8),discriminator:'01',passwordHash:'unused'}});
const token=await createSessionToken(actor.id),ordinaryToken=await createSessionToken(ordinary.id),cookie=`${SESSION_COOKIE}=${token}`,t=getT('nl');
const request=(body,headers={})=>fetch(base+'/api/admin/audio/legacy',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json',...headers},body:JSON.stringify(body)});
const browser=await chromium.launch({args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH}),ctx=await browser.newContext({viewport:{width:320,height:900}});
await ctx.addCookies([{name:SESSION_COOKIE,value:token,url:base}]);const page=await ctx.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 check('legacy-inventaris vereist login',(await fetch(base+'/api/admin/audio/legacy')).status===401);
 check('gewone gebruiker kan inventaris niet bekijken',(await fetch(base+'/api/admin/audio/legacy',{headers:{cookie:`${SESSION_COOKIE}=${ordinaryToken}`}})).status===403);
 const before=await prisma.officialAudioTask.count(),real=await (await fetch(base+'/api/admin/audio/legacy',{headers:{cookie}})).json();
 check('echte GET geeft alle 205 zonder taakmutatie',real.rows.length===205&&await prisma.officialAudioTask.count()===before);
 check('vreemde origin geweigerd',(await request({action:'prepare',ids:[LEGACY_PILOT_IDS[0]]},{origin:'https://foreign.invalid'})).status===403);
 check('geen opdracht zonder expliciete bevestiging',(await request({action:'download',ids:[LEGACY_PILOT_IDS[0]],planHash:'a'.repeat(64)})).status===409);
 check('geen clientbron-URL',(await request({action:'prepare',ids:[LEGACY_PILOT_IDS[0]],url:'https://evil.invalid/audio.mp3'})).status===409);
 check('maximaal drie per beheeractie',(await request({action:'prepare',ids:[...LEGACY_PILOT_IDS,real.rows.find(r=>!r.pilot&&!r.review).id]})).status===409);
 check('reviewgeval blijft beschermd',(await request({action:'prepare',ids:[real.rows.find(r=>r.review).id]})).status===409);
 check('verouderd plan geweigerd',(await request({action:'download',ids:[LEGACY_PILOT_IDS[0]],planHash:'0'.repeat(64),confirmed:true})).status===409);
 const prepared=await request({action:'prepare',ids:[...LEGACY_PILOT_IDS]});check('voorbereiden is alleen lezen',prepared.status===200&&await prisma.officialAudioTask.count()===before);
 // Alleen de browserbediening gebruikt vervangbare HTTP-status; echte domein-/multi-procesproeven staan apart.
 const state=structuredClone(real);state.pilotApproved=false;
 for(const row of state.rows)Object.assign(row,{status:'NOT_CHECKED',recordingId:null,published:false,occupied:false,errorCode:null});
 const bodies=[];await page.route('**/api/admin/audio/legacy',async route=>{
  const body=route.request().method()==='POST'?route.request().postDataJSON():null;
  if(!body)return route.fulfill({json:state});bodies.push(body);
  if(body.action==='prepare')return route.fulfill({json:await prepareLegacyConversion(body.ids)});
  if(body.action==='approve')state.pilotApproved=true;
  for(const row of state.rows.filter(r=>body.ids?.includes(r.id)||body.selections?.some(s=>s.id===r.id))){
   if(body.action==='download')row.status='VALIDATED';
   if(body.action==='register'){row.status='REGISTERED';row.recordingId='synthetic-'+row.id;}
   if(body.action==='publish'){row.published=true;row.occupied=true;}
  }
  return route.fulfill({json:body.action==='publish'?{results:body.selections.map(s=>({id:s.id,status:'PUBLISHED',errorCode:null}))}:{accepted:body.ids?.length??0}});
 });
 await page.goto(base+'/adminbackend/content/audio');const card=page.locator('#legacy-audio-conversion');await card.locator(':scope > summary').click();
 check('inventaris wordt niet automatisch opgehaald',bodies.length===0);await card.getByRole('button',{name:t('legacyAudio.inventory'),exact:true}).click();await card.getByText(t('legacyAudio.pilot'),{exact:true}).waitFor();
 check('overige legacy-hoofdstukken blijven vergrendeld',await card.getByRole('checkbox').count()>0&&(await card.getByRole('checkbox').all()).length===25&&!await card.getByRole('button',{name:t('legacyAudio.selectNext')}).count());
 await card.getByRole('button',{name:t('legacyAudio.selectPilot')}).click();
 await card.getByRole('button',{name:t('officialAudio.download')+' (3/3)',exact:true}).click();let dialog=page.getByRole('dialog');
 check('downloadbevestiging noemt exact drie hoofdstukken',(await dialog.textContent()).includes('nl')&&bodies.at(-1).action==='prepare'&&!bodies.some(b=>b.action==='download'));
 await dialog.getByRole('button',{name:t('common.cancel'),exact:true}).click();check('annuleren maakt geen download',!bodies.some(b=>b.action==='download'));
 async function confirmAction(label){await card.getByRole('button',{name:label,exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:label.startsWith(t('officialAudio.download'))?t('officialAudio.download'):label,exact:true}).click();}
 await confirmAction(t('officialAudio.download')+' (3/3)');await page.waitForFunction(label=>Array.from(document.querySelectorAll('#legacy-audio-conversion button')).some(b=>b.textContent===label&&!b.disabled),t('officialAudio.register'));
 check('download maakt geen registratie of publicatie',bodies.filter(b=>b.action==='download').length===1&&!bodies.some(b=>['register','publish'].includes(b.action)));
 await confirmAction(t('officialAudio.register'));await page.waitForFunction(label=>Array.from(document.querySelectorAll('#legacy-audio-conversion button')).some(b=>b.textContent===label&&!b.disabled),t('officialAudio.publishSelected'));
 check('registratie publiceert niet',bodies.filter(b=>b.action==='register').length===1&&!bodies.some(b=>b.action==='publish'));
 await confirmAction(t('officialAudio.publishSelected'));await page.waitForFunction(label=>Array.from(document.querySelectorAll('#legacy-audio-conversion button')).some(b=>b.textContent===label&&!b.disabled),t('legacyAudio.accept'));
 check('publicatie is apart bevestigd',bodies.filter(b=>b.action==='publish').length===1&&bodies.find(b=>b.action==='publish').confirmed===true);
 await card.screenshot({path:join(output,'legacy-conversion-320-nl.png')});check('mobiele kaart past op 320px',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await confirmAction(t('legacyAudio.accept'));await card.getByText(t('legacyAudio.unlocked'),{exact:true}).waitFor();check('pas afzonderlijke proefgoedkeuring ontsluit volgende batch',await card.getByRole('button',{name:t('legacyAudio.selectNext')}).count()===1);
 // Echte speler met een gesimuleerde afspeelfout; de server levert de terugval en de oude versgrenzen.
 const chapter=await prisma.chapter.findFirstOrThrow({where:{number:22,book:{key:'bofm/2-ne',contentCollectionId:'content_bom'}},include:{verses:{orderBy:{number:'asc'}}}});
 const pointer=await prisma.audioPublication.findUniqueOrThrow({where:{targetKey:`chapter:${chapter.id}`}});
 await ctx.addInitScript(()=>{
  window.__audio=[];window.__media=[];const proto=HTMLMediaElement.prototype,times=new WeakMap();
  Object.defineProperty(proto,'currentTime',{configurable:true,get(){return times.get(this)??0;},set(v){times.set(this,v);}});
  proto.load=function(){setTimeout(()=>this.onloadedmetadata?.(),0);};proto.pause=function(){};proto.play=function(){window.__audio.push({src:this.src,at:this.currentTime});if(!window.__media.includes(this))window.__media.push(this);return Promise.resolve();};
  Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{getVoices:()=>[],cancel(){},pause(){},resume(){},speak(){}}});
 });
 await page.goto(base+'/lesson/'+chapter.id);await page.getByRole('button',{name:t('player.readAloud'),exact:false}).click();await page.waitForFunction(()=>window.__audio.length>0);
 check('V2-speler start de nieuwe conversieopname',await page.evaluate(id=>window.__audio.at(-1).src.endsWith('/api/audio/recordings/'+id),pointer.recordingId));
 await page.getByRole('button',{name:t('player.nextVerse'),exact:true}).click();
 await page.evaluate(()=>window.__media.at(-1).onerror());await page.waitForFunction(()=>window.__audio.at(-1).src.includes('/api/audio/')&&!window.__audio.at(-1).src.includes('/recordings/'));
 check('afspeelfout gebruikt oude audio met oude tijdcode van vers twee',await page.evaluate(at=>Math.abs(window.__audio.at(-1).at-at)<0.01,chapter.verses[1].audioStart));
 check('minispeler blijft beschikbaar na terugval',await page.getByRole('button',{name:t('player.stopAria'),exact:true}).count()===1);
 check('geen browserexceptions',errors.length===0);
 writeFileSync(join(output,'legacy-results.json'),JSON.stringify({results,errors},null,2));
}catch(error){await page.screenshot({path:join(output,'legacy-failure.png'),fullPage:true});writeFileSync(join(output,'legacy-failure.html'),await page.content());throw error;}
finally{await browser.close();await prisma.$disconnect();}
