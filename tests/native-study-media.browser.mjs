// Echte Next-SSR naast dezelfde lokaal gebundelde Vandaag-view; uitsluitend eigen testdatabase.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {prisma} from '../src/lib/db.ts';
import {hashPassword,createSessionToken,SESSION_COOKIE} from '../src/lib/auth.ts';
import {seedNativeStudyMedia} from './fixtures/native-study-media.ts';
import {getT} from '../src/lib/i18n/index.ts';
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL)throw Error('Alleen eigen geïsoleerde database');
const backend=process.env.NATIVE_TEST_BASE_URL,require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-browser/study-media';mkdirSync(out,{recursive:true});
const inputs=JSON.parse(readFileSync('dist/native.inputs.json','utf8'));
for(const component of ['TodayView','Greeting','TodaySection','ContinueSection','OpenActions','SocialPreview','SocialView','DiscoverySection','TodayProgramView','StreakContinuationCardView'])assert.ok(inputs.some(f=>f.endsWith(`today/${component}.tsx`)),`${component} ontbreekt in de echte lokale bundel`);
assert.equal(inputs.some(f=>/node_modules\/(?:next|@prisma)\/|src\/lib\/socketClient\.ts|\.server\.ts$/.test(f)),false,'Geen web-cookie/socket/serverruntime');
copyFileSync('dist/native.inputs.json',`${out}/native.inputs.json`);
const osBoundary={name:'native-today-os-events-only',setup(api){api.onLoad({filter:/src\/lib\/platform\.ts$/},args=>{const source=readFileSync(args.path,'utf8'),start=source.indexOf('export async function startNativeFoundationRuntime(');assert.ok(start>0);return{loader:'ts',contents:source.slice(0,start)+`export async function startNativeFoundationRuntime(options){const back=()=>options.onBack(),resume=()=>options.onResume();window.addEventListener('today:test-back',back);window.addEventListener('today:test-resume',resume);return()=>{window.removeEventListener('today:test-back',back);window.removeEventListener('today:test-resume',resume);};}`};});}};
const bundle=await build({plugins:[osBoundary],entryPoints:['tests/fixtures/native-foundation-client.tsx'],bundle:true,write:false,minify:true,platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
const css=readFileSync('dist/native/index.css'),secrets=new Map(),calls=[],errors=[];
let failMedia=false,holdNext=false,held=[];
const front=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/v1/native/')){
  const record={method:req.method,path:url.pathname};calls.push(record);
  if(failMedia&&url.pathname.includes('/study-media/')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'native_request_failed'}));return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await fetch(`${backend}${req.url}`,{method:req.method,headers:{Origin:'capacitor://localhost','X-Versado-Client':'native-v1','x-real-ip':'127.0.0.61',...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  const body=await response.text();if(url.pathname.endsWith('/today-overview')||url.pathname.endsWith('/me')){const value=JSON.parse(body);record.response={status:response.status,language:value.language??value.uiLanguage,error:value.error};}const finish=()=>{if(!res.destroyed){res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);}};
  if(holdNext&&url.pathname.includes('/study-media/')){holdNext=false;held.push(finish);}else finish();return;
 }
 if(url.pathname.startsWith('/test-keychain/')){if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);secrets.set(url.pathname,Buffer.concat(chunks).toString());}if(req.method==='DELETE')secrets.delete(url.pathname);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:secrets.get(url.pathname)??null}));return;}
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(url.pathname==='/index.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
 if(['/native-artwork/','/images/','/icons/','/mascots/','/scripture/'].some(prefix=>url.pathname.startsWith(prefix))&&!url.pathname.includes('..')){res.setHeader('Content-Type',url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.svg')?'image/svg+xml':'image/webp');res.end(readFileSync(url.pathname.startsWith('/native-artwork/')?`dist/native${url.pathname}`:`public${url.pathname}`));return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
}catch(error){console.error('Today testproxy:',error.message);res.writeHead(500);res.end();}});
await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${front.address().port}`,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const password='Synthetic-Media-B2-42';let fixture;
async function account(language='nl'){return prisma.user.create({data:{email:`media-${randomUUID()}@example.invalid`,handle:`Media${randomUUID().slice(0,6)}`,discriminator:'01',passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),avatarCharacterId:'aaron',uiLanguage:language,timeZone:'UTC',companion:'VERA',shareOnlineStatus:false}});}
async function login(page,user){const t=getT(user.uiLanguage);await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.locator('[data-today-overview]').waitFor();}
const image=p=>p.locator('[data-cfm-today] img[src^="data:image/webp;base64,"]');
const mediaCalls=()=>calls.filter(c=>c.path.includes('/api/v1/native/study-media/')).length;
try{
 fixture=await seedNativeStudyMedia();const user=await account();const source=await fixture.attach(user.id);
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL'}),web=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL'});
 const page=await context.newPage();let sockets=0;const rawPrivate=[];page.on('pageerror',error=>errors.push(error.message));page.on('websocket',()=>sockets++);page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/study-media/'))rawPrivate.push(r.url());});
 await page.goto(`${origin}/?device=study-media&language=nl&accountLanguage=1`);await login(page,user);await image(page).waitFor();await image(page).evaluate(img=>img.decode());
 assert.equal(mediaCalls(),1,'One actual native media request; no duplicate loader');assert.equal(await image(page).evaluate(img=>img.naturalWidth),Math.min(640,source.media.width));
 await web.addCookies([{name:SESSION_COOKIE,value:await createSessionToken(user.id),url:backend}]);const webPage=await web.newPage();await webPage.goto(`${backend}/dashboard`);await webPage.locator('[data-cfm-today] img').evaluate(img=>img.decode());
 assert.equal(await page.locator('[data-cfm-today]').textContent(),await webPage.locator('[data-cfm-today]').textContent(),'Same real programme/card on web and native');
 for(const language of ['nl','en','de','fr','es']){
  if(language!=='nl'){await prisma.user.update({where:{id:user.id},data:{uiLanguage:language}});await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));await page.waitForFunction(language=>document.documentElement.lang===language,language);await image(page).waitFor();await webPage.reload();}
  for(const [width,scale,scheme] of [[320,1,'light'],[320,2,'dark'],[1024,1,'light']]){
   for(const [kind,p] of [['native',page],['web',webPage]]){await p.setViewportSize({width,height:844});await p.emulateMedia({colorScheme:scheme});await p.evaluate(scale=>{document.documentElement.style.fontSize=`${100*scale}%`;window.dispatchEvent(new Event('resize'));},scale);await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await p.screenshot({path:`${out}/${kind}-${language}-${width}-${scale}-${scheme}.png`,fullPage:true});}
  }
 }
 await prisma.user.update({where:{id:user.id},data:{uiLanguage:'nl'}});await page.evaluate(()=>{document.documentElement.style.fontSize='100%';window.dispatchEvent(new Event('today:test-resume'));});await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.documentElement.lang==='nl');await image(page).waitFor();
 // Real protected cache is discarded before a failed recheck; public local assets remain local.
 failMedia=true;await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));await image(page).waitFor({state:'detached'});await page.locator('[data-native-study-placeholder]').waitFor();
 await page.screenshot({path:`${out}/native-media-unavailable.png`,fullPage:true});failMedia=false;await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));await image(page).waitFor();
 await context.setOffline(true);await image(page).waitFor({state:'detached'});const offlineCalls=mediaCalls();await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));await page.waitForTimeout(100);assert.equal(mediaCalls(),offlineCalls);await context.setOffline(false);await image(page).waitFor();
 // A real source change purges the released protected entry as well as the UI.
 await prisma.user.update({where:{id:user.id},data:{activeContentCollectionId:null}});await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));await page.locator('[data-cfm-today]').waitFor({state:'detached'});assert.equal(await image(page).count(),0);
 await fixture.attach(user.id);await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));await image(page).waitFor();
 // Hold already authorized image bytes, then switch accounts before the bridge reply.
 holdNext=true;await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));for(let i=0;held.length===0&&i<100;i++)await page.waitForTimeout(20);assert.equal(held.length,1);await image(page).waitFor({state:'detached'});
 await page.locator('a[data-kompas-target="profile"]').click();await page.getByRole('button',{name:getT('nl')('nativeFoundation.logout'),exact:true}).click();await page.locator('form').waitFor();const other=await account();await login(page,other);for(const finish of held.splice(0))finish();await page.waitForTimeout(100);assert.equal(await page.locator('[data-cfm-today]').count(),0);assert.equal(await image(page).count(),0);assert.ok((await page.locator('[data-today-overview]').textContent()).includes(other.handle));
 // Re-enter A and withdraw publication/access before resume: no cached image remains.
 await page.locator('a[data-kompas-target="profile"]').click();await page.getByRole('button',{name:getT('nl')('nativeFoundation.logout'),exact:true}).click();await page.locator('form').waitFor();await login(page,user);await image(page).waitFor();
 await prisma.contentCollection.update({where:{id:fixture.key},data:{visibleToUsers:false}});await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));await page.locator('[data-cfm-today]').waitFor({state:'detached'});assert.equal(await image(page).count(),0);
 assert.equal(sockets,0);assert.deepEqual(rawPrivate,[],'No cookie image URL ever reaches native img/fetch');assert.deepEqual(errors,[]);assert.equal(calls.some(c=>!['GET','POST'].includes(c.method)),false);assert.deepEqual(calls.filter(c=>c.method==='POST'&&!['login','logout','refresh'].some(p=>c.path.endsWith('/'+p))),[],'No progress, import or reward writes');
 await context.close();await web.close();console.log('Protected study media: real published Today programme, 30 web/native comparison screenshots (5 languages,320px/200%,tablet), bounded image decode, single-store dedupe, failure/placeholder, offline purge, source switch, late A bytes/B login, access withdrawal; no raw private URL or socket. No physical acceptance.');
}finally{for(const finish of held.splice(0))finish();await browser.close();await new Promise(resolve=>front.close(resolve));if(fixture)await prisma.contentCollection.update({where:{id:fixture.key},data:{enabled:false}});await prisma.$disconnect();}
