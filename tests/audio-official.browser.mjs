// Normaal audiobeheer zonder pilotpoort; HTTP-fixtures uitsluitend voor de bedieningsvolgorde.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {prisma} from '../src/lib/db.ts';
import {createSessionToken,SESSION_COOKIE} from '../src/lib/auth.ts';
import {officialOverview} from '../src/lib/audio/officialJobs.ts';
import {getT} from '../src/lib/i18n/index.ts';
import {sampleSources} from './fixtures/audio/official-source.ts';
const db=new URL(process.env.AUDIO_TEST_DATABASE_URL??'http://invalid'),base=process.env.AUDIO_TEST_BASE_URL;
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_audio_test'||process.env.DATABASE_URL!==db.href||new URL(base).hostname!=='127.0.0.1')throw Error('Eigen audiorunner vereist');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright'),output='/tmp/versado-audio-browser';mkdirSync(output,{recursive:true});
const results=[],check=(name,value)=>{results.push({name,ok:Boolean(value)});assert.ok(value,name);console.log('OK',name);};
const admin=await prisma.user.create({data:{email:randomUUID()+'@official-browser.invalid',handle:'O'+randomUUID().slice(0,8),discriminator:'01',passwordHash:'unused',isAdmin:true}}),ordinary=await prisma.user.create({data:{email:randomUUID()+'@official-browser.invalid',handle:'O'+randomUUID().slice(0,8),discriminator:'01',passwordHash:'unused'}});
const token=await createSessionToken(admin.id),ordinaryToken=await createSessionToken(ordinary.id),cookie=`${SESSION_COOKIE}=${token}`;
const initial=await officialOverview(),taskRows=await prisma.officialAudioTask.findMany({where:{id:{in:sampleSources.map(r=>r.id)}}}),records=new Map(taskRows.map(t=>[t.id,t.recordingId]));
const officialBodies=[],errors=[];let state=structuredClone(initial),failDownload=false,failPublication=false;
for(const source of sampleSources){const group=state.groups.find(g=>g.work===source.work&&g.language===source.language);group.jobs=[group.jobs.find(r=>r.id===source.id)];assert.ok(group.jobs[0]);}
function derive(){for(const group of state.groups){const valid=group.jobs.filter(r=>!r.review&&!r.protected);group.registered=valid.filter(r=>r.recordingId).length;group.registeredTargets=new Set(valid.filter(r=>r.recordingId).map(r=>r.bookKey+':'+r.chapterNumber)).size;group.published=valid.filter(r=>r.published).length;group.unpublishedTargets=new Set(valid.filter(r=>r.recordingId&&!r.targetPublished).map(r=>r.bookKey+':'+r.chapterNumber)).size;group.pending=group.jobs.filter(r=>['QUEUED','RUNNING'].includes(r.status)).length;}state.active=state.groups.some(g=>g.pending>0);}
function staged(status){for(const source of sampleSources){const group=state.groups.find(g=>g.work===source.work&&g.language===source.language),r=group.jobs.find(r=>r.id===source.id);Object.assign(r,{status,phase:status==='REGISTERED'?'REGISTER':'DOWNLOAD',resumable:false,recovering:false,waiting:false,blockReason:null,errorCode:null,local:['VALIDATED','REGISTERED'].includes(status),cachePresent:['VALIDATED','REGISTERED'].includes(status),recordingId:status==='REGISTERED'?records.get(r.id):null,published:false,targetPublished:false,publishable:status==='REGISTERED',pointerVersion:0});group.downloadIds=status==='NOT_CHECKED'?[r.id]:[];group.registerIds=status==='VALIDATED'?[r.id]:[];group.resumeIds=[];}derive();}
staged('NOT_CHECKED');
const browser=await chromium.launch({args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH}),context=await browser.newContext({viewport:{width:320,height:900},locale:'nl-NL',timezoneId:'Europe/Amsterdam',serviceWorkers:'block'});await context.addCookies([{name:SESSION_COOKIE,value:token,url:base}]);
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/hydration|Minified React error #418/i.test(m.text()))errors.push(m.text());});
let t=getT('nl');
const group=language=>page.locator(`[data-official-group="bofm:${language}"]`),groupButton=(language,key)=>group(language).getByRole('button',{name:t(key),exact:true}).first();
async function open(){await page.goto(base+'/adminbackend/content/audio');await page.getByRole('heading',{name:t('audioLibrary.title'),exact:true}).waitFor();await page.locator('[data-official-group]').first().waitFor();}
async function confirmGroup(language,key){await groupButton(language,key).click();const dialog=page.getByRole('dialog');check('besluit noemt de geselecteerde taal '+language,(await dialog.textContent()).includes('· '+language));await dialog.getByRole('button',{name:t(key),exact:true}).click();}
async function fit(name){check(name,await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
try{
 check('officiële status vereist sessie',(await fetch(base+'/api/admin/audio/official')).status===401);
 check('gewone gebruiker krijgt geen bronstatus',(await fetch(base+'/api/admin/audio/official',{headers:{cookie:`${SESSION_COOKIE}=${ordinaryToken}`}})).status===403);
 const before=await prisma.officialAudioTask.count();
 for(const [name,origin,body,expected]of [
  ['vreemde origin','https://foreign.invalid',{action:'download',ids:sampleSources.map(r=>r.id)},403],
  ['client mag geen URL sturen',base,{action:'download',ids:sampleSources.map(r=>r.id),url:'http://127.0.0.1/'},409],
  ['onbekende bron',base,{action:'download',ids:['f'.repeat(64)]},409],
  ['te grote body',base,{action:'download',ids:[],extra:'x'.repeat(40000)},409],
 ])check(name,(await fetch(base+'/api/admin/audio/official',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(body)})).status===expected);
 const english=(await import('../src/lib/audio/officialCatalogue.ts')).officialSources.filter(s=>s.work==='bofm'&&s.language==='en').map(s=>s.id);
 const large=await fetch(base+'/api/admin/audio/official',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action:'download',ids:english})});
 check('grote directe aanvraag geeft specifieke batchgrens',large.status===413&&(await large.json()).error===t('officialAudio.batchTooLarge'));
 const failureSource=(await import('../src/lib/audio/officialCatalogue.ts')).officialSources.find(s=>s.work==='bofm'&&s.language==='en'&&!sampleSources.some(f=>f.id===s.id)&&s.quality==='VALIDATED');
 await prisma.$executeRawUnsafe(`CREATE FUNCTION official_http_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${failureSource.id}' THEN RAISE EXCEPTION 'PRIVATE_SYNTHETIC_DATABASE_DETAIL'; END IF; RETURN NEW; END $$`);
 await prisma.$executeRawUnsafe('CREATE TRIGGER official_http_fail BEFORE INSERT ON "OfficialAudioTask" FOR EACH ROW EXECUTE FUNCTION official_http_fail()');
 try {
  const response=await fetch(base+'/api/admin/audio/official',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action:'download',ids:[failureSource.id]})});
  const body=await response.json();check('onverwachte databasefout is geen ongeldige invoer en lekt geen details',response.status===500&&body.error===t('officialAudio.serviceError')&&!JSON.stringify(body).includes('PRIVATE_SYNTHETIC'));
 }finally{await prisma.$executeRawUnsafe('DROP TRIGGER official_http_fail ON "OfficialAudioTask"');await prisma.$executeRawUnsafe('DROP FUNCTION official_http_fail()');}
 check('afgewezen aanvragen maken geen taken' ,await prisma.officialAudioTask.count()===before);
 const retired=await fetch(base+'/api/admin/audio/official',{method:'POST',headers:{cookie,origin:base,'content-type':'application/json'},body:JSON.stringify({action:'approvePilot',ids:[]})});
 check('oude pilotgoedkeuring bestaat niet meer als API-actie',retired.status===409);
 const realStatus=await (await fetch(base+'/api/admin/audio/official',{headers:{cookie}})).json();check('API-overzicht bevat geen pilotpoort',!('pilot' in realStatus)&&!('pilotApproved' in realStatus));
 await page.route('**/api/admin/audio/official',async route=>{
  if(route.request().method()!=='POST'){await route.fulfill({json:state});return;}
  const body=route.request().postDataJSON();officialBodies.push(body);
  if(body.action==='publish'){
   const results=body.selections.map(selection=>{const r=state.groups.flatMap(g=>g.jobs).find(r=>r.id===selection.id);assert.ok(r&&r.recordingId===selection.recordingId&&r.publishable);if(failPublication){failPublication=false;return{id:r.id,status:'FAILED',errorCode:'DATABASE_BUSY'};}r.published=true;r.targetPublished=true;r.publishable=false;r.pointerVersion++;return{id:r.id,status:'PUBLISHED',errorCode:null};});derive();await route.fulfill({json:{results}});return;
  }
  if(body.action==='download'&&body.ids.length===20&&failDownload){failDownload=false;await route.fulfill({status:503,json:{error:t('officialAudio.databaseBusy')}});return;}
  for(const g of state.groups){g.downloadIds=g.downloadIds.filter(id=>!body.ids.includes(id));g.registerIds=g.registerIds.filter(id=>!body.ids.includes(id));g.resumeIds=g.resumeIds.filter(id=>!body.ids.includes(id));for(const r of g.jobs)if(body.ids.includes(r.id)){r.status=body.action==='resume'&&r.recordingId?'REGISTERED':'QUEUED';r.phase=body.action==='register'?'REGISTER':'DOWNLOAD';r.resumable=false;r.recovering=false;r.errorCode=null;}}
  derive();await route.fulfill({json:{accepted:body.ids.length}});
 });
 await open();check('geen Ether-pilotblok of goedkeuringsknop',await page.locator('#official-audio-pilot').count()===0&&!await page.getByRole('button',{name:/Pilot goedkeuren/}).count());await fit('normaal overzicht past op 320px');
 check('normale groepsdownload is direct beschikbaar',await groupButton('nl','officialAudio.download').isEnabled());
 await groupButton('nl','officialAudio.download').click();await page.getByRole('dialog').getByRole('button',{name:t('common.cancel'),exact:true}).click();check('annuleren download start niets',officialBodies.length===0);
 await confirmGroup('nl','officialAudio.download');check('download start geen registratie of publicatie',officialBodies.length===1&&officialBodies[0].action==='download');
 await group('nl').locator('details > summary').click();await group('nl').getByText(t('officialAudio.queued')+' · '+t('officialAudio.unpublished'),{exact:true}).waitFor();
 staged('VALIDATED');await open();check('alleen gecontroleerde hoofdstukken kunnen worden geregistreerd',await groupButton('nl','officialAudio.register').isEnabled());
 await confirmGroup('nl','officialAudio.register');check('registratie blijft een afzonderlijke actie zonder publicatie',officialBodies.length===2&&officialBodies[1].action==='register');
 staged('REGISTERED');await open();await group('nl').locator('details > summary').click();await group('nl').getByRole('checkbox').check();
 let publishOne=page.getByRole('button',{name:t('officialAudio.publishSelected')+' (1)',exact:true});await publishOne.click();let oneDialog=page.getByRole('dialog');check('publicatiebesluit benoemt hoofdstuk en taal',(await oneDialog.textContent()).includes('Ether 1 · nl'));await oneDialog.getByRole('button',{name:t('common.cancel'),exact:true}).click();check('annuleren publicatie behoudt de status',!officialBodies.some(b=>b.action==='publish'));
 await publishOne.click();await page.getByRole('dialog').getByRole('button',{name:t('audioLibrary.publish'),exact:true}).click();await page.waitForFunction(label=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent===label&&b.disabled),t('officialAudio.publishSelected')+' (0)');
 check('hoofdstuk wordt alleen na aparte bevestiging gepubliceerd',officialBodies.filter(b=>b.action==='publish').length===1);
 const nlSample=state.groups.find(g=>g.work==='bofm'&&g.language==='nl'),sampleRow=nlSample.jobs[0],pointerBefore=sampleRow.pointerVersion;
 Object.assign(sampleRow,{status:'FAILED',errorCode:'PILOT_REQUIRED',resumable:true});nlSample.resumeIds=[sampleRow.id];await open();await group('nl').locator('details > summary').click();await group('nl').getByText(t('officialAudio.oldTask'),{exact:true}).waitFor();
 await confirmGroup('nl','officialAudio.resume');check('oude Nederlandse taak kan zonder pilotpoort hervatten',officialBodies.at(-1).action==='resume'&&sampleRow.status==='REGISTERED'&&sampleRow.pointerVersion===pointerBefore);
 // Volledige Engelse selectie; een onderbroken batch laat eerdere stappen zichtbaar bestaan.
 const en=state.groups.find(g=>g.work==='bofm'&&g.language==='en');en.editionPresent=true;en.downloadIds=english;
 await open();
 const enGroup=page.locator('[data-official-group="bofm:en"]');
 await enGroup.getByRole('button',{name:t('officialAudio.download'),exact:true}).click();
 let dialog=page.getByRole('dialog');check('bulkdownload bevestigt werk en taal',(await dialog.textContent()).includes(t('officialAudio.bofm')+' · en · 478'));
 await dialog.getByRole('button',{name:t('common.cancel'),exact:true}).click();
 const begin=officialBodies.length;
 // De eerste batch slaagt; de tweede krijgt een tijdelijke fout.
 let batches=0;await page.route('**/api/admin/audio/official',async route=>{
  const body=route.request().method()==='POST'?route.request().postDataJSON():null;
  if(body?.action==='download'&&body.ids.some(id=>english.includes(id))){batches++;if(batches===2)failDownload=true;}
  await route.fallback();
 });
 await enGroup.getByRole('button',{name:t('officialAudio.download'),exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:t('officialAudio.download'),exact:true}).click();
 await page.getByText(t('officialAudio.databaseBusy'),{exact:true}).waitFor();
 check('gedeeltelijke bulkdownload bewaart eerste twintig',en.downloadIds.length===458&&officialBodies.length===begin+2);
 await enGroup.getByRole('button',{name:t('officialAudio.download'),exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:t('officialAudio.download'),exact:true}).click();
 await page.waitForFunction(label=>Array.from(document.querySelectorAll('p')).some(e=>e.textContent===label),t('officialAudio.batchProgress',{done:458,total:458}));
 const downloadRequests=officialBodies.slice(begin).filter(body=>body.action==='download');
 check('volledige Engelse collectie wordt in kleine batches hervat',en.downloadIds.length===0&&downloadRequests.every(body=>body.ids.length<=20));
 check('bulkdownload registreert of publiceert nooit vanzelf',officialBodies.filter(b=>b.action==='publish').length===1&&!officialBodies.slice(begin).some(b=>b.action==='publish'||b.action==='register'));
 // Productiewaarneming als expliciete UI-fixture: 34 registraties, 1 publicatie, geen download-/registratiewerk.
 const nl=state.groups.find(g=>g.work==='bofm'&&g.language==='nl'),template=nl.jobs.find(r=>r.language==='nl');
 nl.jobs=Array.from({length:34},(_,i)=>({...template,id:(1000+i).toString(16).padStart(64,'0'),bookKey:'bofm/ether',chapterNumber:i+2,recordingId:'bulk-fixture-'+i,status:'REGISTERED',published:i===0,publishable:i!==0,pointerVersion:i===0?1:0,blockReason:null,review:false,protected:false,resumable:false,recovering:false,waiting:false,targetPublished:i===0}));
 Object.assign(nl,{targets:239,protected:205,legacyConfigured:205,legacyLocal:205,additionalTargets:34,registeredTargets:34,unpublishedTargets:33,pending:0,checked:34,registered:34,published:1,review:1,missing:0,downloadIds:[],registerIds:[],resumeIds:[]});
 await page.setViewportSize({width:320,height:900});await open();
 const nlGroup=page.locator('[data-official-group="bofm:nl"]');await nlGroup.locator('details > summary').click();
 check('bestaande registraties zijn zichtbaar en vragen geen nieuwe import',await nlGroup.getByText(t('officialAudio.alreadyRegistered'),{exact:true}).isVisible()&&await nlGroup.getByRole('button',{name:t('officialAudio.download'),exact:true}).isDisabled());
 check('mobiele registratielijst is begrensd tot vijfentwintig rijen',await nlGroup.getByRole('checkbox').count()===25);
 check('34 aanvullende registraties worden naast 205 legacy getoond',(await nlGroup.locator('[data-audio-progress]').textContent()).includes('205')&&(await nlGroup.locator('[data-audio-progress]').textContent()).includes('34 van 34')&&(await nlGroup.locator('[data-audio-progress]').textContent()).includes('33'));
 await nlGroup.getByRole('button',{name:t('officialAudio.selectAll'),exact:true}).click();
 const publish=page.getByRole('button',{name:t('officialAudio.publishSelected')+' (33)',exact:true});
 await publish.click();dialog=page.getByRole('dialog');const labels=await dialog.textContent();
 check('publicatiebesluit benoemt alle geselecteerde hoofdstukken en taal',labels.includes(template.bookName+' 3 · nl')&&labels.includes(template.bookName+' 35 · nl')&&!labels.includes(template.bookName+' 2 · nl'));
 await dialog.getByRole('button',{name:t('common.cancel'),exact:true}).click();check('annuleren bulkpublicatie schrijft niets',officialBodies.filter(b=>b.action==='publish').length===1);
 await fit('bulkregistraties passen op 320px');await nlGroup.getByText(t('officialAudio.alreadyRegistered'),{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'official-nl-34-320.png')});
 failPublication=true;await publish.click();await page.getByRole('dialog').getByRole('button',{name:t('audioLibrary.publish'),exact:true}).click();
 await page.getByText(t('officialAudio.partialFailure'),{exact:false}).waitFor();
 check('gedeeltelijke publicatie toont een fout en bewaart geslaagde stappen',nl.jobs.filter(r=>r.published).length===33&&nl.jobs[0].pointerVersion===1);
 const retry=page.getByRole('button',{name:t('officialAudio.publishSelected')+' (1)',exact:true});await retry.click();await page.getByRole('dialog').getByRole('button',{name:t('audioLibrary.publish'),exact:true}).click();
 await page.waitForFunction(label=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent===label&&b.disabled),t('officialAudio.publishSelected')+' (0)');
 check('alle aanvullende hoofdstukken afgerond zonder opnieuw downloaden',await nlGroup.getByText(t('officialAudio.allPublished'),{exact:true}).isVisible());
 check('publicatieretry raakt alleen de overgebleven opname',nl.jobs.every(r=>r.published)&&officialBodies.filter(b=>b.action==='publish').at(-1).selections.length===1&&nl.jobs[0].pointerVersion===1);
 check('bulkpublicatie heeft maximaal twintig expliciete registraties per aanvraag',officialBodies.filter(b=>b.action==='publish').every(b=>b.selections.length<=20));
 await prisma.user.update({where:{id:admin.id},data:{uiLanguage:'de'}});t=getT('de');await page.setViewportSize({width:390,height:900});await page.evaluate(()=>localStorage.setItem('bom-theme','dark'));await open();await page.evaluate(()=>document.documentElement.style.fontSize='200%');await page.locator('[data-official-group="bofm:nl"] details > summary').click();
 await fit('Duitse bulkbediening past op 390px donker met 200% tekst');await page.locator('[data-official-group="bofm:nl"] details > summary').scrollIntoViewIfNeeded();await page.screenshot({path:join(output,'official-nl-390-de-dark200.png')});
 check('geen browser-/tijdzonehydratie-excepties',errors.length===0);
 writeFileSync(join(output,'official-results.json'),JSON.stringify({mode:'isolated browser with stateful HTTP fixtures; no production',results,errors,officialBodies},null,2));
}catch(error){writeFileSync(join(output,'official-failure.html'),await page.content());await page.screenshot({path:join(output,'official-failure.png')});throw error;}finally{await context.close();await browser.close();await prisma.$disconnect();}
