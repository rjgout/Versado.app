// Browserbediening met toestandvolle HTTP-fixtures; de echte domeinketen is apart tegen dezelfde wegwerp-DB getest.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {prisma} from '../src/lib/db.ts';
import {createSessionToken,SESSION_COOKIE} from '../src/lib/auth.ts';
import {officialOverview} from '../src/lib/audio/officialJobs.ts';
import {getT} from '../src/lib/i18n/index.ts';
const db=new URL(process.env.AUDIO_TEST_DATABASE_URL??'http://invalid'),base=process.env.AUDIO_TEST_BASE_URL;
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_audio_test'||process.env.DATABASE_URL!==db.href||new URL(base).hostname!=='127.0.0.1')throw Error('Eigen audiorunner vereist');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright'),output='/tmp/versado-audio-browser';mkdirSync(output,{recursive:true});
const results=[],check=(name,value)=>{results.push({name,ok:Boolean(value)});assert.ok(value,name);console.log('OK',name);};
const admin=await prisma.user.create({data:{email:randomUUID()+'@official-browser.invalid',handle:'O'+randomUUID().slice(0,8),discriminator:'01',passwordHash:'unused',isAdmin:true}}),ordinary=await prisma.user.create({data:{email:randomUUID()+'@official-browser.invalid',handle:'O'+randomUUID().slice(0,8),discriminator:'01',passwordHash:'unused'}});
const token=await createSessionToken(admin.id),ordinaryToken=await createSessionToken(ordinary.id),cookie=`${SESSION_COOKIE}=${token}`;
const initial=await officialOverview(),taskRows=await prisma.officialAudioTask.findMany({where:{id:{in:initial.pilot.map(r=>r.id)}}}),records=new Map(taskRows.map(t=>[t.id,t.recordingId]));
const audioBodies=[],officialBodies=[],errors=[];
let state=structuredClone(initial);state.pilotApproved=false;
function staged(status){for(const r of state.pilot){Object.assign(r,{status,phase:status==='REGISTERED'?'REGISTER':'DOWNLOAD',waiting:false,blockReason:null,errorCode:null,local:status==='VALIDATED'||status==='REGISTERED',cachePresent:status==='VALIDATED'||status==='REGISTERED',recordingId:status==='REGISTERED'?records.get(r.id):null,published:false,pointerVersion:0,checkedAt:status==='NOT_CHECKED'?null:'2026-10-25T14:46:00.000Z'});}}
staged('NOT_CHECKED');
const browser=await chromium.launch({args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH});
const context=await browser.newContext({viewport:{width:320,height:900},locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});await context.addCookies([{name:SESSION_COOKIE,value:token,url:base}]);
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/hydration|Minified React error #418/i.test(m.text()))errors.push(m.text());});
let t=getT('nl');
const button=key=>page.getByRole('button',{name:t(key),exact:true});
async function open(){await page.goto(base+'/adminbackend/content/audio');await page.getByRole('heading',{name:t('audioLibrary.title'),exact:true}).waitFor();await page.locator('[data-official-language]').first().waitFor();}
async function cancelAction(key){await button(key).click();await page.getByRole('dialog').getByRole('button',{name:t('common.cancel'),exact:true}).click();}
async function confirmAction(key,confirmKey=key){await button(key).click();const dialog=page.getByRole('dialog');const text=await dialog.textContent();for(const language of ['nl','en','de','fr','es'])check('besluit benoemt '+language,text.includes('· '+language));await dialog.getByRole('button',{name:t(confirmKey),exact:true}).click();}
async function fit(name){check(name,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
try{
 check('officiële status vereist sessie',(await fetch(base+'/api/admin/audio/official')).status===401);
 check('gewone gebruiker krijgt geen bronstatus',(await fetch(base+'/api/admin/audio/official',{headers:{cookie:`${SESSION_COOKIE}=${ordinaryToken}`}})).status===403);
 const before=await prisma.officialAudioTask.count();
 for(const [name,origin,body,expected]of [
  ['vreemde origin','https://foreign.invalid',{action:'download',ids:state.pilot.map(r=>r.id)},403],
  ['client mag geen URL sturen',base,{action:'download',ids:state.pilot.map(r=>r.id),url:'http://127.0.0.1/'},409],
  ['onbekende bron',base,{action:'download',ids:['f'.repeat(64)]},409],
  ['te grote body',base,{action:'download',ids:[],extra:'x'.repeat(40000)},409],
 ])check(name,(await fetch(base+'/api/admin/audio/official',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)})).status===expected);
 check('afgewezen aanvragen maken geen taken',await prisma.officialAudioTask.count()===before);
 await page.route('**/api/admin/audio/official',async route=>{
  if(route.request().method()==='POST'){
   const body=route.request().postDataJSON();officialBodies.push(body);
   if(body.action==='download'){for(const r of state.pilot)if(body.ids.includes(r.id)){r.status='QUEUED';r.phase='DOWNLOAD';}}
   if(body.action==='register'){for(const r of state.pilot)if(body.ids.includes(r.id)){r.status='QUEUED';r.phase='REGISTER';}}
   if(body.action==='approvePilot')state.pilotApproved=true;
   await route.fulfill({json:{accepted:body.ids.length}});
  }else await route.fulfill({json:state});
 });
 await page.route(/\/api\/admin\/audio$/,async route=>{
  if(route.request().method()!=='POST')return route.fallback();
  const body=route.request().postDataJSON(),row=state.pilot.find(r=>r.recordingId===body.recordingId);assert.ok(row);assert.equal(body.expectedVersion,row.pointerVersion);audioBodies.push(body);row.published=true;row.pointerVersion++;
  await route.fulfill({json:{targetKey:'fixture:'+row.id,recordingId:row.recordingId,version:row.pointerVersion}});
 });
 await open();await button('officialAudio.downloadPilot').waitFor({state:'visible'});await fit('pilot past op 320px');
 check('registratie/publicatie zijn vóór download geblokkeerd',await button('officialAudio.registerPilot').isDisabled()&&await button('officialAudio.publishPilot').isDisabled());
 await cancelAction('officialAudio.downloadPilot');check('annuleren download maakt geen aanvraag',officialBodies.length===0);
 await confirmAction('officialAudio.downloadPilot','officialAudio.download');
 await page.getByText(t('officialAudio.queued'),{exact:true}).first().waitFor();
 check('download vraagt precies vijf bronidentiteiten',officialBodies[0].action==='download'&&officialBodies[0].ids.length===5&&audioBodies.length===0);
 state.pilot[0].status='RUNNING';state.pilot[0].bytesDownloaded=Math.round(state.pilot[0].bytes/2);await open();await page.getByRole('progressbar').waitFor();
 check('herladen toont lopende persistente taak',await page.getByRole('progressbar').count()===1);await fit('voortgang past op 320px');
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(output,'official-pilot-320-nl.png')});
 staged('VALIDATED');await open();await button('officialAudio.registerPilot').waitFor();await page.waitForFunction(label=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent===label)?.disabled,t('officialAudio.registerPilot'));
 check('controle publiceert niet',audioBodies.length===0&&await button('officialAudio.publishPilot').isDisabled());
 await cancelAction('officialAudio.registerPilot');check('annuleren registratie schrijft geen aanvraag',officialBodies.length===1);
 await confirmAction('officialAudio.registerPilot','officialAudio.register');
 await page.getByText(t('officialAudio.queued'),{exact:true}).first().waitFor();
 check('registratie is apart van downloaden en publiceren',officialBodies[1].action==='register'&&audioBodies.length===0);
 staged('REGISTERED');await open();await page.waitForFunction(label=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent===label)?.disabled,t('officialAudio.publishPilot'));
 await prisma.user.update({where:{id:admin.id},data:{uiLanguage:'de'}});t=getT('de');state.pilot[0].status='FAILED';state.pilot[0].errorCode='FORBIDDEN';state.pilot[0].phase='DOWNLOAD';
 await page.setViewportSize({width:390,height:900});await page.evaluate(()=>localStorage.setItem('bom-theme','dark'));await open();await page.evaluate(()=>document.documentElement.style.fontSize='200%');
 await page.getByText(t('officialAudio.forbidden'),{exact:true}).waitFor();await fit('Duitse fout/herstel past op 390px met 200% tekst');check('donker thema actief',await page.evaluate(()=>document.documentElement.classList.contains('dark')));
 await page.locator('#official-audio-catalogue > summary').click();await fit('Duitse broncatalogus past op 390px met 200% tekst');await page.getByText(t('officialAudio.forbidden'),{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'official-pilot-390-de-dark200.png')});
 await prisma.user.update({where:{id:admin.id},data:{uiLanguage:'nl'}});t=getT('nl');staged('REGISTERED');await page.setViewportSize({width:1280,height:960});await page.evaluate(()=>localStorage.setItem('bom-theme','light'));await open();
 await page.waitForFunction(label=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent===label)?.disabled,t('officialAudio.publishPilot'));
 await cancelAction('officialAudio.publishPilot');check('annuleren publicatie wijzigt geen pointer',audioBodies.length===0);
 await confirmAction('officialAudio.publishPilot','audioLibrary.publish');
 await page.waitForFunction(label=>{const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===label);return button&&!button.disabled;},t('officialAudio.approvePilot'));
 check('één bevestiging publiceert alleen de vijf benoemde kandidaten',audioBodies.length===5&&new Set(audioBodies.map(b=>b.recordingId)).size===5&&state.pilot.every(r=>r.published));
 check('publiceren keurt de pilot niet automatisch goed',!state.pilotApproved&&officialBodies.length===2);
 await cancelAction('officialAudio.approvePilot');check('pilot blijft gesloten na annuleren',!state.pilotApproved);
 await confirmAction('officialAudio.approvePilot');
 await page.getByText(t('officialAudio.bulkLocked'),{exact:true}).waitFor({state:'hidden'});
 check('pilotgoedkeuring is apart en start geen bulkwerk',state.pilotApproved&&officialBodies.length===3&&officialBodies[2].action==='approvePilot'&&audioBodies.length===5);
 await fit('desktop past op 1280px');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(output,'official-pilot-1280-nl.png')});
 check('geen browser-/tijdzonehydratie-excepties',errors.length===0);
 writeFileSync(join(output,'official-results.json'),JSON.stringify({mode:'isolated browser with stateful HTTP fixtures; no production',results,errors,officialBodies,audioBodies},null,2));
}finally{await context.close();await browser.close();await prisma.$disconnect();}
