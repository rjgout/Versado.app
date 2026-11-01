// Echte Next-SSR naast dezelfde lokaal gebundelde CFM-view; uitsluitend eigen testdatabase.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {build} from 'esbuild';
import {seedNativeCfm} from './fixtures/native-cfm.ts';
import {prisma} from '../src/lib/db.ts';
import {createSessionToken,SESSION_COOKIE} from '../src/lib/auth.ts';
import {getT} from '../src/lib/i18n/index.ts';
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL)throw Error('Alleen eigen geïsoleerde database');
const backend=process.env.NATIVE_TEST_BASE_URL,require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-browser/study-courses';mkdirSync(out,{recursive:true});
const inputs=JSON.parse(readFileSync('dist/native.inputs.json','utf8'));
for(const file of ['study/CfmCourseView.tsx','study/CfmWeekPath.tsx','study/CfmArchiveView.tsx','study/CfmWeekStepsView.tsx'])assert.ok(inputs.some(f=>f.endsWith(file)),`${file} ontbreekt in echte lokale bundel`);
assert.equal(inputs.some(f=>/node_modules\/(?:next|@prisma)\/|src\/lib\/socketClient\.ts|\.server\.ts$/.test(f)),false,'Geen web-cookie/socket/serverruntime');
copyFileSync('dist/native.inputs.json',`${out}/native.inputs.json`);
const osBoundary={name:'native-today-os-events-only',setup(api){api.onLoad({filter:/src\/lib\/platform\.ts$/},args=>{const source=readFileSync(args.path,'utf8'),start=source.indexOf('export async function startNativeFoundationRuntime(');assert.ok(start>0);return{loader:'ts',contents:source.slice(0,start)+`export async function startNativeFoundationRuntime(options){const back=()=>options.onBack(),resume=()=>options.onResume();window.addEventListener('today:test-back',back);window.addEventListener('today:test-resume',resume);return()=>{window.removeEventListener('today:test-back',back);window.removeEventListener('today:test-resume',resume);};}`};});}};
const bundle=await build({plugins:[osBoundary],entryPoints:['tests/fixtures/native-foundation-client.tsx'],bundle:true,write:false,minify:true,platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
const css=readFileSync('dist/native/index.css'),secrets=new Map(),calls=[],errors=[];
let failOverview=false,holdNext=false,held=[];let oldBackend=false;let courseFailure=0,catalogFailure=0;
const front=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/v1/native/')){
  const record={method:req.method,path:url.pathname};calls.push(record);
  if(catalogFailure && url.pathname==='/api/v1/native/courses'){res.writeHead(catalogFailure,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'native_request_failed'}));return;}
  if(courseFailure && /^\/api\/v1\/native\/courses\/[^/]+\/weeks$/.test(url.pathname)){res.writeHead(courseFailure,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'native_request_failed'}));return;}
  if(failOverview&&url.pathname.endsWith('/today-overview')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'native_request_failed'}));return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await fetch(`${backend}${req.url}`,{method:req.method,headers:{Origin:'capacitor://localhost','X-Versado-Client':'native-v1','x-real-ip':'127.0.0.61',...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  let body=await response.text();if(oldBackend&&url.pathname.endsWith("/capabilities")){const data=JSON.parse(body);data.features=data.features.filter(f=>f!=="study-course-overview-v1");body=JSON.stringify(data);}if(url.pathname.endsWith('/today-overview')||url.pathname.endsWith('/me')){const value=JSON.parse(body);record.response={status:response.status,language:value.language??value.uiLanguage,error:value.error};}if(holdNext&&/^\/api\/v1\/native\/courses\/[^/]+\/weeks$/.test(url.pathname)&&response.ok){const value=JSON.parse(body);value.weeks=value.weeks.map(w=>({...w,title:'LATE ACCOUNT A'}));body=JSON.stringify(value);}const finish=()=>{if(!res.destroyed){res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);}};
  if(holdNext&&/^\/api\/v1\/native\/courses\/[^/]+\/weeks$/.test(url.pathname)){holdNext=false;held.push(finish);}else finish();return;
 }
 if(url.pathname.startsWith('/test-keychain/')){if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);secrets.set(url.pathname,Buffer.concat(chunks).toString());}if(req.method==='DELETE')secrets.delete(url.pathname);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:secrets.get(url.pathname)??null}));return;}
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(url.pathname==='/index.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
 if(['/native-artwork/','/images/','/icons/','/mascots/','/scripture/'].some(prefix=>url.pathname.startsWith(prefix))&&!url.pathname.includes('..')){res.setHeader('Content-Type',url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.svg')?'image/svg+xml':'image/webp');res.end(readFileSync(url.pathname.startsWith('/native-artwork/')?`dist/native${url.pathname}`:`public${url.pathname}`));return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
}catch(error){console.error('Today testproxy:',error.message);res.writeHead(500);res.end();}});
await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${front.address().port}`,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});

const fx=await seedNativeCfm(),artifacts=[];
try {
 await prisma.contentSwitcherSettings.upsert({where:{id:"singleton"},create:{id:"singleton",enabled:true},update:{enabled:true}});
 for(const language of ['nl','en','de','fr','es']) {
  const user=await fx.account(language),t=getT(language),context=await browser.newContext({viewport:{width:320,height:844},locale:language,colorScheme:language==='en'?'dark':'light'}),page=await context.newPage(),web=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await context.addCookies([{name:SESSION_COOKIE,value:await createSessionToken(user.id),url:backend}]);
  await page.goto(`${origin}/?accountLanguage=1&device=${user.id}#/login`);
  await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(fx.password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.locator('[data-today-overview]').waitFor();
  await page.locator('[data-main-nav]').getByRole('link',{name:t('nav.learn'),exact:true}).click();await page.locator(`.card-title-link[href="#/courses/${fx.steps.id}"]`).click();
  await page.locator('[data-cfm-week-path]').waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-week-step]').length===6);
  await web.goto(`${backend}/courses/${fx.steps.id}/pad`);await web.waitForFunction(()=>document.querySelectorAll('[data-week-step]').length===6);
  await page.locator('[data-path-current] [data-image-overlay] img').waitFor();await web.locator('[data-path-current] [data-image-overlay] img').waitFor();
  assert.deepEqual(await page.locator('[data-week]').first().getAttribute('data-week'),await web.locator('[data-week]').first().getAttribute('data-week'));
  assert.deepEqual(await page.locator('[data-week-step]').allTextContents(),await web.locator('[data-week-step]').allTextContents());
  for(const scale of [1,2])for(const [name,p]of [['native',page],['web',web]]) {
   await p.evaluate(scale=>{document.documentElement.style.fontSize=`${scale*100}%`;window.dispatchEvent(new Event('resize'));},scale);
   const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   if(overflow){await p.screenshot({path:`${out}/overflow-${language}-${scale}-${name}.png`,fullPage:true});console.log('CFM overflow',name,language,scale,await p.evaluate(()=>[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,12).map(e=>({tag:e.tagName,cls:e.className,width:e.getBoundingClientRect().width,text:e.textContent.slice(0,80)}))));}
   assert.equal(overflow,false,`${name}/${language}/${scale}`);
   await p.locator('[data-image-overlay] img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())));
   const file=`${out}/${language}-weeks-${scale}-${name}.png`;await p.screenshot({path:file,fullPage:true});artifacts.push(file);
  }
  for(const p of [page,web])await p.evaluate(()=>{document.documentElement.style.fontSize='100%';});
  if(language==='nl') {
   for(const size of [{width:768,height:1024},{width:1024,height:768}])for(const [name,p]of [['native',page],['web',web]]){await p.setViewportSize(size);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const file=`${out}/nl-tablet-${size.width}-${name}.png`;await p.screenshot({path:file,fullPage:true});artifacts.push(file);}
   for(const p of [page,web])await p.setViewportSize({width:320,height:844});
  }
  const folded=page.locator('[data-week]:not([data-path-current])').first(),toggle=folded.locator('button[aria-expanded]');await toggle.click();await folded.locator('[data-week-step]').first().waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'true');
  await folded.locator('[data-week-step]').first().click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:t('common.close'),exact:true}).click();
  if(language==='nl') {
   await toggle.focus();await toggle.evaluate(el=>{window.__cfmButton=el;});courseFailure=503;
   const failed=page.waitForResponse(r=>r.url().endsWith(`/courses/${fx.steps.id}/weeks`)&&r.status()===503);await page.evaluate(()=>window.dispatchEvent(new Event('versado:app-resumed')));await failed;await page.waitForLoadState('networkidle');
   assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.ok(await toggle.evaluate(el=>el===window.__cfmButton&&el===document.activeElement));courseFailure=0;
   await page.locator('section[role="status"] button').click();await page.waitForLoadState('networkidle');assert.equal(await toggle.getAttribute('aria-expanded'),'true');
   catalogFailure=503;await page.reload();await page.getByText(t('nativeFoundation.error'),{exact:true}).waitFor();catalogFailure=0;await page.getByRole('button',{name:t('nativeFoundation.retry'),exact:true}).first().click();await page.locator('[data-cfm-week-path]').waitFor();
  }
  await page.locator('[data-cfm-archive-link]').click();await page.locator('[data-cfm-archive]').waitFor();await web.goto(`${backend}/courses/${fx.steps.id}/archief`);await web.locator('[data-cfm-archive]').waitFor();
  assert.deepEqual(await page.locator('[data-archive-week]').allTextContents(),await web.locator('[data-archive-week]').allTextContents());
  for(const [name,p]of [['native',page],['web',web]]){const file=`${out}/${language}-archive-${name}.png`;await p.screenshot({path:file,fullPage:true});artifacts.push(file);}
  await page.locator('[data-subpage-back-bar] button').click();await page.locator('[data-cfm-week-path]').waitFor();
  await page.goto(`${origin}/?accountLanguage=1&device=${user.id}&cold=1#/courses/${fx.free.id}/pad`);await page.locator('[data-cfm-week-path][data-path-mode="FREE"]').waitFor().catch(async error=>{await page.screenshot({path:`${out}/free-failure.png`,fullPage:true});console.log('Vrije studie diagnose',await page.locator('body').innerText(),calls.slice(-12),errors);throw error;});assert.equal(await page.locator('[data-week-step]').count(),0);
  await web.goto(`${backend}/courses/${fx.free.id}/pad`);await web.locator('[data-cfm-week-path]').waitFor();
  for(const [name,p]of [['native',page],['web',web]]){const file=`${out}/${language}-free-${name}.png`;await p.screenshot({path:file,fullPage:true});artifacts.push(file);}
  const current=await prisma.user.findUniqueOrThrow({where:{id:user.id}});assert.equal(current.activeCourseId,fx.steps.id);assert.equal(current.personalStudyMode,'STEPS');assert.equal(current.xpTotal,0);assert.equal(await prisma.userStudyContext.count({where:{userId:user.id}}),0);assert.equal(await prisma.studyStepProgress.count({where:{userId:user.id}}),0);assert.equal(await prisma.streakDay.count({where:{userId:user.id}}),0);
  if(language==='nl') {
   oldBackend=true;await page.reload();await page.getByText(t('nativeLearning.pathUnavailable'),{exact:true}).waitFor();assert.equal(await page.locator('[data-cfm-week-path]').count(),0);oldBackend=false;await page.reload();await page.locator('[data-cfm-week-path]').waitFor();
   await page.waitForLoadState('networkidle');holdNext=true;await page.evaluate(()=>window.dispatchEvent(new Event('versado:app-resumed')));for(let i=0;i<150&&!held.length;i++)await new Promise(r=>setTimeout(r,20));assert.equal(held.length,1);
   const other=await fx.account('nl');await page.locator('[data-subpage-back-bar] button').click();await page.locator('a[data-kompas-target="profile"]:visible').click();await page.getByRole('button',{name:t('nativeFoundation.logout'),exact:true}).click();await page.locator('form').waitFor();await page.getByLabel(t('nativeFoundation.email')).fill(other.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(fx.password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.locator('[data-today-overview]').waitFor();
   await page.locator('[data-main-nav]').getByRole('link',{name:t('nav.learn'),exact:true}).click();await page.locator(`.card-title-link[href="#/courses/${fx.steps.id}"]`).click();await page.locator('[data-cfm-week-path]').waitFor();for(const finish of held.splice(0))finish();await page.waitForLoadState('networkidle');assert.equal((await page.locator('main').innerText()).includes('LATE ACCOUNT A'),false);
  }
  console.log(`CFM browser ${language}: weken, archief, vrije studie en isolatie gecontroleerd`);await context.close();
 }
 assert.deepEqual(errors,[]);assert.equal(calls.some(c=>c.method!=='GET'&&/study-context|study-preference|\/courses|\/complete/.test(c.path)),false);
 assert.equal(calls.some(c=>/^\/api\/v1\/native\/courses\/[^/]+\/path$/.test(c.path)&&!oldBackend),true,'Oude capabilityfallback is werkelijk aangevraagd');
 console.log(`B3a-2: ${artifacts.length} echte web/native screenshots; vijf talen, 320px/200%, weken/zes stappen, vrije studie, archief, koude route, oude capability, tijdelijke fout/DOM/focus en late A-response/B-login; geen voortgangswrites. Geen fysieke acceptatie.`);
} finally {courseFailure=0;for(const finish of held)finish();await browser.close();front.closeAllConnections?.();await new Promise(r=>front.close(r));await fx.cleanup();await prisma.$disconnect();}
