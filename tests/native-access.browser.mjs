import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {setTimeout as delay} from 'node:timers/promises';
import {prisma} from '../src/lib/db.ts';
import {hashPassword} from '../src/lib/auth.ts';
import {getT} from '../src/lib/i18n/index.ts';
import {contentKeyOf} from '../src/lib/learning/contentProgress.ts';
import {nativeAccessGateway} from './fixtures/native-access-gateway.ts';

const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL)throw Error('Alleen eigen geïsoleerde database');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-browser/access';mkdirSync(out,{recursive:true});
const gate=await nativeAccessGateway(process.env.NATIVE_TEST_BASE_URL),sessions=new Map();
let holdNextChapterRead=false;const heldReads=[];
const mock=`const invoke=async(method,options)=>{const response=await fetch('/native-bridge/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({options})});const result=await response.json();if(result.error)throw Error(result.error);return result;};export const nativeBridge={accessStatus:()=>invoke('accessStatus'),enrollAccess:options=>invoke('enrollAccess',options),clearAccess:()=>invoke('clearAccess'),accessRequest:options=>invoke('accessRequest',options)};`;
const bundle=await build({entryPoints:['tests/fixtures/native-access-client.tsx'],bundle:true,write:false,platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-only-native-bridge',setup(api){api.onLoad({filter:/src\/lib\/native\/bridge\.ts$/},()=>({contents:mock,loader:'ts'}));api.onLoad({filter:/src\/lib\/platform\.ts$/},()=>{
 const source=readFileSync('src/lib/platform.ts','utf8').replace('return Capacitor.isNativePlatform();','return true;');
 const start=source.indexOf('export async function startNativeFoundationRuntime(');
 assert.ok(start>0);
 return {contents:source.slice(0,start)+`export async function startNativeFoundationRuntime(options){const resume=()=>options.onResume(),open=event=>options.onUrl(event.detail,'open');window.addEventListener('wp6:test-resume',resume);window.addEventListener('wp6:test-open',open);return()=>{window.removeEventListener('wp6:test-resume',resume);window.removeEventListener('wp6:test-open',open);};}`,loader:'ts'};
});}}]});
const stylesheet=readFileSync('dist/native/index.css');
const front=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/native-bridge/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const {options}=JSON.parse(Buffer.concat(chunks).toString());
   let value;try{
    switch(url.pathname.slice('/native-bridge/'.length)){
     case 'accessStatus':value=await gate.bridge.accessStatus();break;
     case 'enrollAccess':value=await gate.bridge.enrollAccess(options);break;
     case 'clearAccess':value=await gate.bridge.clearAccess();break;
     case 'accessRequest':
      value=await gate.bridge.accessRequest(options);
      // Compatibiliteit met de oudere Access-backend; de nieuwe Vandaag-proef gebruikt echte capabilities.
      if(options.path==='capabilities'&&value.status===200){const body=JSON.parse(value.body);body.features=body.features.filter(f=>f!=='today-overview-v1');value={...value,body:JSON.stringify(body)};}
      if(holdNextChapterRead&&options.method==='GET'&&/^courses\/[^/]+\/read\/chapters\/[^/]+(?:\/resume)?$/.test(options.path)){
       holdNextChapterRead=false;
       // Canary uitsluitend in de vertraagde fixture-response: een verkeerde accountbinding moet zichtbaar falen.
       const canary=JSON.parse(value.body),reader=canary.reader??canary;value={...value,body:JSON.stringify(canary.reader?{...canary,reader:{...reader,bookName:'ALLEEN VERTRAAGDE ACCOUNT A'}}:{...reader,bookName:'ALLEEN VERTRAAGDE ACCOUNT A'})};
       heldReads.push({path:options.path,authorization:options.authorization,finish(){if(!res.destroyed){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}}});return;
      }
      break;
     default:throw Error('access_request_invalid');
    }
   }catch(error){value={error:/^access_[a-z_]+$/.test(error.message)?error.message:'access_unavailable'};}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return;
  }
  if(url.pathname==='/safe-session'){
   const key=url.searchParams.get('device');
   if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);sessions.set(key,Buffer.concat(chunks).toString());}
   if(req.method==='DELETE')sessions.delete(key);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:sessions.get(key)??null}));return;
  }
  if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(url.pathname==='/index.css'){res.setHeader('Content-Type','text/css');res.end(stylesheet);return;}
  if(url.pathname.startsWith('/icons/')||url.pathname.startsWith('/mascots/')||url.pathname.startsWith('/scripture/')){if(url.pathname.includes('..')){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',url.pathname.endsWith('.png')?'image/png':'image/webp');res.end(readFileSync('public'+url.pathname));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="nl"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
 }catch{res.writeHead(500);res.end();}
});
await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+front.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const results=[];
try{
 await prisma.contentWork.upsert({where:{key:'bofm'},create:{key:'bofm',kind:'SCRIPTURE'},update:{}});
 const collection=await prisma.contentCollection.create({data:{id:`access-data-${randomUUID()}`,slug:`access-data-${randomUUID()}`,name:'Synthetische WP6-proef',icon:'book',work:'bofm',language:'nl',editionKey:'access-wp6',enabled:true,visibleToUsers:true,publicationState:'LEGACY'}});
 const book=await prisma.book.create({data:{slug:`access-data-${randomUUID()}`,name:'WP6-testboek',order:1,key:'bofm/1-ne',contentCollectionId:collection.id}});
 const chapters=await Promise.all([1,2].map(number=>prisma.chapter.create({data:{bookId:book.id,number,order:number,verses:{create:[{number:1,text:`Synthetische WP6-passage ${number}.`},{number:2,text:`Tweede synthetische passage ${number}.`}]}}})));
 const course=await prisma.course.create({data:{slug:`access-reader-${randomUUID()}`,name:'Vrije keuze',type:'FREE_CHOICE',contentCollectionId:collection.id,chapters:{create:chapters.map((chapter,order)=>({chapterId:chapter.id,order}))}}});
 const readerPath=chapter=>`courses/${course.id}/read/chapters/${chapter.id}`;
 const password='Synthetic-Access-browser-42',passwordHash=await hashPassword(password);
 const makeUser=handle=>prisma.user.create({data:{email:`access-browser-${randomUUID()}@example.invalid`,handle,discriminator:'01',passwordHash,emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:collection.id,activeCourseId:course.id}});
 const user=await makeUser('Accessbrowser'),other=await makeUser('Accesswissel');
 for(const account of [user,other])await prisma.userCourseProgress.create({data:{userId:account.id,courseId:course.id,subscribed:true}});
 await prisma.contentProgress.create({data:{userId:user.id,contentKey:contentKeyOf({id:chapters[0].id,number:1,book:{key:book.key}}),lastChapterId:chapters[0].id,readStatus:'READING',readVerse:1}});
 for(const [language,width,scale,scheme] of [['nl',320,2,'light'],['de',320,2,'light'],['en',390,1,'dark'],['fr',390,1,'dark'],['es',390,1,'dark']]){
  await gate.bridge.clearAccess();gate.rotate();const t=getT(language),device=randomUUID();
  const context=await browser.newContext({viewport:{width,height:844},locale:language,colorScheme:scheme,isMobile:true,hasTouch:true});
  await context.addInitScript(({scale})=>{const apply=()=>{document.documentElement.style.fontSize=100*scale+'%';for(const edge of ['top','left','right','bottom'])document.documentElement.style.setProperty('--safe-area-inset-'+edge,'12px');};if(document.documentElement)apply();else document.addEventListener('DOMContentLoaded',apply,{once:true});},{scale});
  const page=await context.newPage(),errors=[],requests=[],consoleMessages=[];let sockets=0;
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push({headers:request.headers(),body:request.postData()??''}));page.on('console',message=>consoleMessages.push(message.text()));page.on('websocket',()=>sockets++);
  try{
   await page.goto(origin+'/?device='+device);await page.getByRole('alert').filter({hasText:t('nativeAccess.missing')}).waitFor();await page.getByRole('link',{name:t('nativeDiagnostics.open'),exact:true}).click();await page.getByRole('region',{name:t('nativeAccess.title')}).waitFor();
   await page.getByRole('status').filter({hasText:t('nativeAccess.missing')}).waitFor();
   assert.equal(await page.getByPlaceholder('Client Secret',{exact:true}).count(),0,'Servicecredentialvelden bestaan niet in JavaScript/HTML');
   await page.getByRole('button',{name:t('nativeAccess.enroll'),exact:true}).click();await page.getByText(t('nativeAccess.configured'),{exact:true}).waitFor();await page.locator('[data-subpage-back-bar] button').click();
   assert.ok(JSON.parse((await gate.bridge.accessRequest({path:'capabilities',method:'GET'})).body).features.includes('realtime-ticket-v1'),'Backend biedt realtime aan: client moet de Access-uitsluiting werkelijk afdwingen');
   if(language==='nl'){
    await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.getByRole('heading',{name:t('nativeFoundation.today')+', '+user.handle,exact:true}).waitFor();
    const openChapter=chapter=>page.evaluate(path=>window.dispatchEvent(new CustomEvent('wp6:test-open',{detail:'https://dev.versado.app/'+path})),readerPath(chapter));
    const openProfile=()=>page.evaluate(()=>window.dispatchEvent(new CustomEvent('wp6:test-open',{detail:'https://dev.versado.app/profile'})));
    const completions=()=>gate.calls.filter(call=>call.method==='POST'&&(/^chapters\/[^/]+\/complete$/.test(call.path)||/\/learning\/(?:start|read|submit|check)$/.test(call.path))).length;
    await openChapter(chapters[0]);await page.getByText('Synthetische WP6-passage 1.',{exact:false}).waitFor();
    await page.evaluate(()=>window.dispatchEvent(new Event('wp6:test-resume')));await page.locator('[data-native-reader]').waitFor();
    await page.reload();await page.getByText('Synthetische WP6-passage 1.',{exact:false}).waitFor();
    assert.equal(await page.locator('[data-native-learning-actions]').count(),1,'De nieuwe capability biedt uitsluitend expliciete lees-/oefenacties');
    assert.equal(completions(),0,'Openen en hervatten versturen geen legacy- of learning-POST');
    const completedBefore=completions();
    holdNextChapterRead=true;await page.evaluate(()=>window.dispatchEvent(new Event('wp6:test-resume')));
    for(let attempt=0;heldReads.length===0&&attempt<100;attempt++)await delay(10);
    assert.equal(heldReads.length,1,'Een bestaand leesantwoord van A wordt daadwerkelijk vertraagd');
    await openProfile();await page.getByRole('button',{name:t('nativeFoundation.logout'),exact:true}).click();await page.getByRole('heading',{name:t('nativeFoundation.welcome'),exact:true}).waitFor();
    await page.getByLabel(t('nativeFoundation.email')).fill(other.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.getByRole('heading',{name:t('nativeFoundation.today')+', '+other.handle,exact:true}).waitFor();
    assert.equal(await page.getByText('Synthetische WP6-passage 1.',{exact:false}).count(),0,'Account B toont geen hoofdstukcache van A');
    await openChapter(chapters[0]);await page.getByText('Synthetische WP6-passage 1.',{exact:false}).waitFor();
    await page.waitForFunction(()=>document.querySelector('#vers-1')?.classList.contains('ring-2'));
    const pending=heldReads[0];
    const lateResponse=page.waitForResponse(response=>{
     if(new URL(response.url()).pathname!=='/native-bridge/accessRequest')return false;
     try{const options=JSON.parse(response.request().postData()).options;return options.path===pending.path&&options.authorization===pending.authorization;}catch{return false;}
    });
    pending.finish();heldReads.shift();const delivered=await lateResponse;
    const lateRead=await delivered.json();assert.equal(lateRead.status,200);const deliveredReader=JSON.parse(lateRead.body).reader??JSON.parse(lateRead.body);assert.equal(deliveredReader.userId,user.id);assert.equal(deliveredReader.focusVerse,2);await delivered.finished();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.getByRole('heading',{name:/ALLEEN VERTRAAGDE ACCOUNT A/}).count(),0,'Een late A-response mag de B-reader niet overnemen');
    assert.equal(await page.locator('[data-scripture-reader] h1').innerText(),'WP6-testboek 1','De huidige B-presentatie blijft na echte A-delivery behouden');
    assert.equal(await prisma.contentProgress.count({where:{userId:other.id}}),0,'Lezen creëert ook voor een nieuwe gebruiker geen voortgang');
    assert.equal(completions(),completedBefore,'Hervatten, accountwisseling en late leesantwoorden veroorzaken geen afrondings-POST');
    await openChapter(chapters[1]);await page.getByText('Synthetische WP6-passage 2.',{exact:false}).waitFor();
    assert.equal(await page.getByText('Synthetische WP6-passage 1.',{exact:false}).count(),0,'Andere concrete hoofdstukidentiteit toont nooit vorige tekst');
    await openProfile();await page.getByRole('button',{name:t('nativeFoundation.logout'),exact:true}).click();await page.getByRole('heading',{name:t('nativeFoundation.welcome'),exact:true}).waitFor();
    await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.getByRole('heading',{name:t('nativeFoundation.today')+', '+user.handle,exact:true}).waitFor();
    gate.revoke();await page.reload();await page.getByRole('alert').filter({hasText:t('nativeAccess.denied')}).waitFor();
    assert.ok(sessions.get(device),'Access-intrekking wist de Versado-refreshstaat niet');
    gate.rotate();await page.getByRole('link',{name:t('nativeDiagnostics.open'),exact:true}).click();await page.getByRole('button',{name:t('nativeAccess.enroll'),exact:true}).click();await page.getByText(t('nativeAccess.configured'),{exact:true}).waitFor();await page.locator('[data-subpage-back-bar] button').click();
    await page.getByRole('heading',{name:t('nativeFoundation.welcome'),exact:true}).waitFor();
    await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.getByRole('heading',{name:t('nativeFoundation.today')+', '+user.handle,exact:true}).waitFor();
    await page.locator('a[data-kompas-target="profile"]').click();await page.getByRole('link',{name:t('nativeDiagnostics.open'),exact:true}).click();await page.getByRole('button',{name:t('nativeAccess.clear'),exact:true}).click();await page.getByRole('alert').filter({hasText:t('nativeAccess.missing')}).waitFor();
    assert.equal(await prisma.nativeSession.count({where:{userId:user.id,revokedAt:null}}),0,'Online wissen trekt eerst de bestaande Versado-sessie in');
    await page.getByRole('button',{name:t('nativeAccess.enroll'),exact:true}).click();await page.getByText(t('nativeAccess.configured'),{exact:true}).waitFor();await page.locator('[data-subpage-back-bar] button').click();
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Geen horizontale overflow');
   assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0,'Geen secrets in webopslag');
   assert.equal(sockets,0,'Access-build opent geen onbeveiligde WebSocket');
   const html=await page.content();for(const value of gate.privateValues()){
    assert.ok(!html.includes(value));assert.ok(!bundle.outputFiles[0].text.includes(value));assert.ok(!JSON.stringify(requests).includes(value));assert.ok(!consoleMessages.join('\n').includes(value));
   }
   assert.ok(requests.every(request=>Object.keys(request.headers).every(key=>!key.toLowerCase().startsWith('cf-access-'))));assert.deepEqual(errors,[]);
   await page.evaluate(()=>scrollTo(0,0));if(['nl','de'].includes(language))await page.screenshot({path:`${out}/panel-${language}-${width}-${scale}.png`,fullPage:true});
   results.push({language,width,scale,scheme,enrollment:'simulated-native',lateReaderAccountIsolation:language==='nl',secretsInJavaScript:false,realtime:'blocked',overflow:false});
  }finally{await context.close();}
 }
 console.log('Native Access-browserbewijs:',JSON.stringify(results));
}finally{for(const pending of heldReads.splice(0))pending.finish();await browser.close();await new Promise(resolve=>front.close(resolve));await gate.close();await prisma.$disconnect();}
