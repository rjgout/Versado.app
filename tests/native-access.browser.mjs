import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {prisma} from '../src/lib/db.ts';
import {hashPassword} from '../src/lib/auth.ts';
import {getT} from '../src/lib/i18n/index.ts';
import {nativeAccessGateway} from './fixtures/native-access-gateway.ts';

const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL)throw Error('Alleen eigen geïsoleerde database');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-browser/access';mkdirSync(out,{recursive:true});
const gate=await nativeAccessGateway(process.env.NATIVE_TEST_BASE_URL),sessions=new Map();
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
     case 'accessRequest':value=await gate.bridge.accessRequest(options);break;
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
  if(url.pathname.startsWith('/icons/')||url.pathname.startsWith('/mascots/')){if(url.pathname.includes('..')){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',url.pathname.endsWith('.png')?'image/png':'image/webp');res.end(readFileSync('public'+url.pathname));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="nl"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
 }catch{res.writeHead(500);res.end();}
});
await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+front.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const results=[];
try{
 await prisma.contentWork.upsert({where:{key:'bofm'},create:{key:'bofm',kind:'SCRIPTURE'},update:{}});
 const collection=await prisma.contentCollection.create({data:{id:`access-data-${randomUUID()}`,slug:`access-data-${randomUUID()}`,name:'Synthetische WP6-proef',icon:'book',work:'bofm',language:'nl',editionKey:'access-wp6',enabled:true,visibleToUsers:true,publicationState:'LEGACY'}});
 const book=await prisma.book.create({data:{slug:`access-data-${randomUUID()}`,name:'WP6-testboek',order:1,key:'bofm/1-ne',contentCollectionId:collection.id}});
 const chapters=await Promise.all([1,2].map(number=>prisma.chapter.create({data:{bookId:book.id,number,order:number,verses:{create:[{number:1,text:`Synthetische WP6-passage ${number}.`}]}}})));
 const password='Synthetic-Access-browser-42',passwordHash=await hashPassword(password);
 const makeUser=handle=>prisma.user.create({data:{email:`access-browser-${randomUUID()}@example.invalid`,handle,discriminator:'01',passwordHash,emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:collection.id}});
 const user=await makeUser('Accessbrowser'),other=await makeUser('Accesswissel');
 for(const [language,width,scale,scheme] of [['nl',320,2,'light'],['de',320,2,'light'],['en',390,1,'dark'],['fr',390,1,'dark'],['es',390,1,'dark']]){
  await gate.bridge.clearAccess();gate.rotate();const t=getT(language),device=randomUUID();
  const context=await browser.newContext({viewport:{width,height:844},locale:language,colorScheme:scheme,isMobile:true,hasTouch:true});
  await context.addInitScript(({scale})=>{const apply=()=>{document.documentElement.style.fontSize=100*scale+'%';for(const edge of ['top','left','right','bottom'])document.documentElement.style.setProperty('--safe-area-inset-'+edge,'12px');};if(document.documentElement)apply();else document.addEventListener('DOMContentLoaded',apply,{once:true});},{scale});
  const page=await context.newPage(),errors=[],requests=[],consoleMessages=[];let sockets=0;
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push({headers:request.headers(),body:request.postData()??''}));page.on('console',message=>consoleMessages.push(message.text()));page.on('websocket',()=>sockets++);
  try{
   await page.goto(origin+'/?device='+device);await page.getByRole('region',{name:t('nativeAccess.title')}).waitFor();
   await page.getByRole('alert').filter({hasText:t('nativeAccess.missing')}).waitFor();
   assert.equal(await page.getByPlaceholder('Client Secret',{exact:true}).count(),0,'Servicecredentialvelden bestaan niet in JavaScript/HTML');
   await page.getByRole('button',{name:t('nativeAccess.enroll'),exact:true}).click();await page.getByText(t('nativeAccess.configured'),{exact:true}).waitFor();
   assert.ok(JSON.parse((await gate.bridge.accessRequest({path:'capabilities',method:'GET'})).body).features.includes('realtime-ticket-v1'),'Backend biedt realtime aan: client moet de Access-uitsluiting werkelijk afdwingen');
   if(language==='nl'){
    await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.getByRole('heading',{name:t('nativeFoundation.today')+', '+user.handle,exact:true}).waitFor();
    await page.getByRole('button',{name:/WP6-testboek 1/}).click();await page.getByText('Synthetische WP6-passage 1.',{exact:false}).waitFor();
    await page.evaluate(()=>window.dispatchEvent(new Event('wp6:test-resume')));await page.getByRole('button',{name:t('nativeFoundation.retry'),exact:true}).click({trial:true});
    await page.reload();await page.getByText('Synthetische WP6-passage 1.',{exact:false}).waitFor();
    await page.getByRole('button',{name:t('nativeFoundation.back'),exact:true}).click();
    await page.getByRole('button',{name:t('nativeFoundation.logout'),exact:true}).click();await page.getByRole('heading',{name:t('nativeFoundation.welcome'),exact:true}).waitFor();
    await page.getByLabel(t('nativeFoundation.email')).fill(other.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.getByRole('heading',{name:t('nativeFoundation.today')+', '+other.handle,exact:true}).waitFor();
    assert.equal(await page.getByText('Synthetische WP6-passage 1.',{exact:false}).count(),0,'Account B toont geen hoofdstukcache van A');
    await page.evaluate(id=>window.dispatchEvent(new CustomEvent('wp6:test-open',{detail:'https://dev.versado.app/lesson/'+id})),chapters[1].id);await page.getByText('Synthetische WP6-passage 2.',{exact:false}).waitFor();
    assert.equal(await page.getByText('Synthetische WP6-passage 1.',{exact:false}).count(),0,'Andere concrete hoofdstukidentiteit toont nooit vorige tekst');
    await page.getByRole('button',{name:t('nativeFoundation.back'),exact:true}).click();
    await page.getByRole('button',{name:t('nativeFoundation.logout'),exact:true}).click();await page.getByRole('heading',{name:t('nativeFoundation.welcome'),exact:true}).waitFor();
    await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.getByRole('heading',{name:t('nativeFoundation.today')+', '+user.handle,exact:true}).waitFor();
    gate.revoke();await page.reload();await page.getByRole('alert').filter({hasText:t('nativeAccess.denied')}).waitFor();
    assert.ok(sessions.get(device),'Access-intrekking wist de Versado-refreshstaat niet');
    gate.rotate();await page.getByRole('button',{name:t('nativeAccess.enroll'),exact:true}).click();await page.getByText(t('nativeAccess.configured'),{exact:true}).waitFor();
    await page.getByRole('heading',{name:t('nativeFoundation.welcome'),exact:true}).waitFor();
    await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.getByRole('heading',{name:t('nativeFoundation.today')+', '+user.handle,exact:true}).waitFor();
    await page.getByRole('button',{name:t('nativeAccess.clear'),exact:true}).click();await page.getByRole('alert').filter({hasText:t('nativeAccess.missing')}).waitFor();
    assert.equal(await prisma.nativeSession.count({where:{userId:user.id,revokedAt:null}}),0,'Online wissen trekt eerst de bestaande Versado-sessie in');
    await page.getByRole('button',{name:t('nativeAccess.enroll'),exact:true}).click();await page.getByText(t('nativeAccess.configured'),{exact:true}).waitFor();
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Geen horizontale overflow');
   assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0,'Geen secrets in webopslag');
   assert.equal(sockets,0,'Access-build opent geen onbeveiligde WebSocket');
   const html=await page.content();for(const value of gate.privateValues()){
    assert.ok(!html.includes(value));assert.ok(!bundle.outputFiles[0].text.includes(value));assert.ok(!JSON.stringify(requests).includes(value));assert.ok(!consoleMessages.join('\n').includes(value));
   }
   assert.ok(requests.every(request=>Object.keys(request.headers).every(key=>!key.toLowerCase().startsWith('cf-access-'))));assert.deepEqual(errors,[]);
   await page.evaluate(()=>scrollTo(0,0));if(['nl','de'].includes(language))await page.screenshot({path:`${out}/panel-${language}-${width}-${scale}.png`,fullPage:true});
   results.push({language,width,scale,scheme,enrollment:'simulated-native',secretsInJavaScript:false,realtime:'blocked',overflow:false});
  }finally{await context.close();}
 }
 console.log('Native Access-browserbewijs:',JSON.stringify(results));
}finally{await browser.close();await new Promise(resolve=>front.close(resolve));await gate.close();await prisma.$disconnect();}
