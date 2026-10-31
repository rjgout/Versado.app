// Echte Next-SSR naast dezelfde lokaal gebundelde Vandaag-view; uitsluitend eigen testdatabase.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {build} from 'esbuild';
import {seedNativeCourses} from './fixtures/native-courses.ts';
import {prisma} from '../src/lib/db.ts';
import {createSessionToken,SESSION_COOKIE} from '../src/lib/auth.ts';
import {getT} from '../src/lib/i18n/index.ts';
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL)throw Error('Alleen eigen geïsoleerde database');
const backend=process.env.NATIVE_TEST_BASE_URL,require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-browser/courses';mkdirSync(out,{recursive:true});
const inputs=JSON.parse(readFileSync('dist/native.inputs.json','utf8'));
for(const file of ['CoursesView.tsx','ReadingCourseView.tsx','ChapterListCourseView.tsx','reading/ReadingPath.tsx','reading/ChapterPath.tsx'])assert.ok(inputs.some(f=>f.endsWith(file)),`${file} ontbreekt in echte lokale bundel`);
assert.equal(inputs.some(f=>/node_modules\/(?:next|@prisma)\/|src\/lib\/socketClient\.ts|\.server\.ts$/.test(f)),false,'Geen web-cookie/socket/serverruntime');
copyFileSync('dist/native.inputs.json',`${out}/native.inputs.json`);
const osBoundary={name:'native-today-os-events-only',setup(api){api.onLoad({filter:/src\/lib\/platform\.ts$/},args=>{const source=readFileSync(args.path,'utf8'),start=source.indexOf('export async function startNativeFoundationRuntime(');assert.ok(start>0);return{loader:'ts',contents:source.slice(0,start)+`export async function startNativeFoundationRuntime(options){const back=()=>options.onBack(),resume=()=>options.onResume();window.addEventListener('today:test-back',back);window.addEventListener('today:test-resume',resume);return()=>{window.removeEventListener('today:test-back',back);window.removeEventListener('today:test-resume',resume);};}`};});}};
const bundle=await build({plugins:[osBoundary],entryPoints:['tests/fixtures/native-foundation-client.tsx'],bundle:true,write:false,minify:true,platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
const css=readFileSync('dist/native/index.css'),secrets=new Map(),calls=[],errors=[];
let failOverview=false,holdNext=false,held=[];let oldBackend=false;
const front=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/v1/native/')){
  const record={method:req.method,path:url.pathname};calls.push(record);
  if(failOverview&&url.pathname.endsWith('/today-overview')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'native_request_failed'}));return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await fetch(`${backend}${req.url}`,{method:req.method,headers:{Origin:'capacitor://localhost','X-Versado-Client':'native-v1','x-real-ip':'127.0.0.61',...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  let body=await response.text();if(oldBackend&&url.pathname.endsWith("/capabilities")){const data=JSON.parse(body);data.features=data.features.filter(f=>f!=="courses-overview-v1");body=JSON.stringify(data);}if(url.pathname.endsWith('/today-overview')||url.pathname.endsWith('/me')){const value=JSON.parse(body);record.response={status:response.status,language:value.language??value.uiLanguage,error:value.error};}const finish=()=>{if(!res.destroyed){res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);}};
  if(holdNext&&url.pathname.endsWith('/courses')){holdNext=false;held.push(finish);}else finish();return;
 }
 if(url.pathname.startsWith('/test-keychain/')){if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);secrets.set(url.pathname,Buffer.concat(chunks).toString());}if(req.method==='DELETE')secrets.delete(url.pathname);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:secrets.get(url.pathname)??null}));return;}
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(url.pathname==='/index.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
 if(['/native-artwork/','/images/','/icons/','/mascots/','/scripture/'].some(prefix=>url.pathname.startsWith(prefix))&&!url.pathname.includes('..')){res.setHeader('Content-Type',url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.svg')?'image/svg+xml':'image/webp');res.end(readFileSync(url.pathname.startsWith('/native-artwork/')?`dist/native${url.pathname}`:`public${url.pathname}`));return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
}catch(error){console.error('Today testproxy:',error.message);res.writeHead(500);res.end();}});
await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${front.address().port}`,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});

const artifacts=[],fixtures=[];
try {
 await prisma.contentSwitcherSettings.upsert({where:{id:"singleton"},create:{id:"singleton",enabled:true},update:{enabled:true}});
 for(const language of ['nl','en','de','fr','es']) {
  const fixture=await seedNativeCourses(language);fixtures.push(fixture);const user=await fixture.account(language),t=getT(language);
  const context=await browser.newContext({viewport:{width:320,height:844},locale:language,colorScheme:language==='en'?'dark':'light'}),page=await context.newPage(),web=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await context.addCookies([{name:SESSION_COOKIE,value:await createSessionToken(user.id),url:backend}]);
  await web.goto(`${backend}/courses`);await web.locator('.card-title-link').first().waitFor();
  await page.goto(`${origin}/?accountLanguage=1&device=${user.id}#/login`);
  await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(fixture.password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.locator('[data-today-overview]').waitFor();
  await page.locator('[data-main-nav]').getByRole('link',{name:t('nav.learn'),exact:true}).click();await page.locator('.card-title-link').first().waitFor();
  assert.deepEqual(await page.locator('.card-title-link').allTextContents(),await web.locator('.card-title-link').allTextContents());
  await page.waitForFunction(()=>document.activeElement?.matches('h1[data-native-route-focus]'));
  const refresh=page.waitForResponse(res=>res.url().endsWith('/api/v1/native/courses'));
  await page.evaluate(()=>window.dispatchEvent(new Event('versado:app-resumed')));await refresh;await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('h1').evaluate(el=>el===document.activeElement&&el.hasAttribute('data-native-route-focus')&&getComputedStyle(el).outlineStyle==='none'),true,'Achtergrondverversing behoudt veilige kopfocus zonder blauwe rand');

  for(const scale of [1,2]) {
   for(const p of [page,web])await p.evaluate(scale=>{document.documentElement.style.fontSize=`${scale*100}%`;window.dispatchEvent(new Event('resize'));},scale);
   for(const [name,p]of [['native',page],['web',web]]){assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const tools=await p.locator('[data-course-tools-label]').evaluate(el=>({height:el.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(el).lineHeight)}));assert.ok(tools.height<=tools.lineHeight*3+1,`${name} ${language} ${scale}: hulpmiddelenlabel blijft leesbaar, geen letterkolom`);const file=`${out}/${language}-courses-${scale}-${name}.png`;await p.locator('main [data-artwork] img').evaluateAll(images=>Promise.all(images.map(image=>{image.loading='eager';return image.decode();})));await p.screenshot({path:file,fullPage:true});artifacts.push(file);}
  }
  await page.evaluate(()=>{document.documentElement.style.fontSize='100%';});
  if(language==='nl') {
   for(const size of [{width:768,height:1024},{width:1024,height:768}]) {
    for(const [name,p]of [['native',page],['web',web]]){await p.setViewportSize(size);await p.evaluate(()=>{document.documentElement.style.fontSize='100%';window.dispatchEvent(new Event('resize'));});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const file=`${out}/nl-tablet-${size.width}-${name}.png`;await p.locator('main [data-artwork] img').evaluateAll(images=>Promise.all(images.map(image=>{image.loading='eager';return image.decode();})));await p.screenshot({path:file,fullPage:true});artifacts.push(file);}
   }
   for(const p of [page,web])await p.setViewportSize({width:320,height:844});
   await page.mouse.wheel(0,400);await page.waitForFunction(()=>scrollY>200);const position=await page.evaluate(()=>scrollY);
   await page.locator('.card-title-link').first().evaluate(a=>a.click());await page.locator('[data-reading-path]').waitFor();
   await page.locator('[data-subpage-back-bar] button').click();await page.locator('.card-title-link').first().waitFor();await page.waitForFunction(y=>Math.abs(scrollY-y)<2,position,{timeout:4000});
  }

  for(const course of fixture.courses) {
   await web.goto(`${backend}/courses/${course.id}/pad`);await web.locator('[data-reading-path], [data-chapter-path]').first().waitFor().catch(async()=>{await web.getByRole('heading',{level:1}).waitFor();});
   await page.goto(`${origin}/?accountLanguage=1&device=${user.id}&case=${course.id}#/courses/${course.id}/pad`);
   try{await page.waitForFunction(()=>document.querySelector('[data-path-chapter]'));}catch(error){console.error('B3a path diagnostic',{route:new URL(page.url()).hash,text:await page.locator('main').innerText(),calls:calls.slice(-12),errors});await page.screenshot({path:`${out}/path-error.png`,fullPage:true});throw error;}
   assert.equal(await page.getByRole('heading',{level:1}).textContent(),await web.getByRole('heading',{level:1}).textContent());
   assert.equal(await page.locator('[data-subpage-back-bar]').innerText(),await web.locator('[data-subpage-back-bar]').innerText(),'Dezelfde cursus-terugbalk op web en native');
   assert.equal(await page.locator('[data-path-chapter]').count(),await web.locator('[data-path-chapter]').count());
   for(const [name,p]of [['native',page],['web',web]]){const file=`${out}/${language}-${course.type}-${name}.png`;await p.locator('main [data-artwork] img').evaluateAll(images=>Promise.all(images.map(image=>{image.loading='eager';return image.decode();})));await p.screenshot({path:file,fullPage:true});artifacts.push(file);}
   if(course.type==='READING_LESSONS') {assert.ok(await page.locator(`[data-native-unavailable-href="/reading-lesson/${fixture.steps.lessons[1].id}"]`).count());await page.locator(`[data-native-unavailable-href="/reading-lesson/${fixture.steps.lessons[1].id}"]`).click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:t('common.close'),exact:true}).click();}
  }
  if(language==='nl') {
   oldBackend=true;await page.goto(`${origin}/?accountLanguage=1&device=${user.id}&case=old-backend#/courses`);await page.getByText(t('nativeLearning.unsupported'),{exact:true}).first().waitFor();assert.equal(await page.locator('.card-title-link').count(),0);assert.equal(await page.locator('[data-main-nav] a').count(),1);oldBackend=false;
   await page.reload();await page.locator('.card-title-link').first().waitFor();
   await context.setOffline(true);await page.evaluate(()=>window.dispatchEvent(new Event('versado:app-resumed')));await context.setOffline(false);await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.locator('.card-title-link').first().waitFor();
   const other=await fixture.account('nl'),free=fixture.courses.find(c=>c.type==='FREE_CHOICE');
   await prisma.userCourseProgress.updateMany({where:{userId:other.id,courseId:{not:free.id}},data:{subscribed:false}});await prisma.user.update({where:{id:other.id},data:{activeCourseId:free.id}});
   await page.waitForLoadState('networkidle');holdNext=true;await page.evaluate(()=>window.dispatchEvent(new Event('versado:app-resumed')));
   for(let i=0;i<100&&held.length===0;i++)await new Promise(r=>setTimeout(r,20));assert.equal(held.length,1);
   await page.locator('a[data-kompas-target="profile"]').click();await page.getByRole('button',{name:t('nativeFoundation.logout'),exact:true}).click();await page.locator('form').waitFor();
   await page.getByLabel(t('nativeFoundation.email')).fill(other.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(fixture.password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.locator('[data-today-overview]').waitFor();
   await page.locator('[data-main-nav]').getByRole('link',{name:t('nav.learn'),exact:true}).click();await page.locator('.card-title-link').first().waitFor();
   for(const finish of held.splice(0))finish();await page.waitForLoadState('networkidle');
   assert.equal(await page.locator('main [role="progressbar"]').count(),1,'Alleen de persoonlijke cursus van B toont voortgang; de twee beschikbare cataloguscursussen hebben geen persoonlijke voortgang');
   assert.equal(await page.locator('[aria-labelledby="discover-courses"]').count(),0,'Laat antwoord van A herstelt niet diens twee andere persoonlijke cursussen');
   assert.ok((await page.locator('[aria-labelledby="current-journey"] .card-title-link').getAttribute('href')).includes(free.id));

  }
  assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).xpTotal,0);assert.equal(await prisma.streakDay.count({where:{userId:user.id}}),0);assert.equal(await prisma.userCourseLessonProgress.count({where:{userId:user.id}}),0);
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.equal(calls.some(c=>c.method==='POST'&&/complete|exercise|courses/.test(c.path)),false);
 console.log(`B3a: ${artifacts.length} echte web/native screenshots, vijf talen, 320px/200%, drie gedeelde leespaden, echte verscursor, oude capabilityfallback, offline/online herstel en veilige lesmelding; geen afrondings-/XP-mutaties. Geen fysieke acceptatie.`);
} finally {for(const finish of held)finish();await browser.close();front.closeAllConnections?.();await new Promise(resolve=>front.close(resolve));for(const fixture of fixtures)await prisma.contentCollection.update({where:{id:fixture.collection.id},data:{enabled:false}});await prisma.$disconnect();}
