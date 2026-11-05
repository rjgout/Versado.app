// Echte Next-SSR naast dezelfde lokaal gebundelde Vandaag-view; uitsluitend eigen testdatabase.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {prisma} from '../src/lib/db.ts';
import {hashPassword,createSessionToken,SESSION_COOKIE} from '../src/lib/auth.ts';
import {contentKeyOf} from '../src/lib/learning/contentProgress.ts';
import {getT} from '../src/lib/i18n/index.ts';
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL)throw Error('Alleen eigen geïsoleerde database');
const backend=process.env.NATIVE_TEST_BASE_URL,require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-browser/today';mkdirSync(out,{recursive:true});
const inputs=JSON.parse(readFileSync('dist/native.inputs.json','utf8'));
for(const component of ['TodayView','Greeting','TodaySection','ContinueSection','OpenActions','SocialPreview','SocialView','DiscoverySection','TodayProgramView','StreakContinuationCardView'])assert.ok(inputs.some(f=>f.endsWith(`today/${component}.tsx`)),`${component} ontbreekt in de echte lokale bundel`);
assert.equal(inputs.some(f=>/node_modules\/(?:next|@prisma)\/|src\/lib\/socketClient\.ts|\.server\.ts$/.test(f)),false,'Geen web-cookie/socket/serverruntime');
copyFileSync('dist/native.inputs.json',`${out}/native.inputs.json`);
const osBoundary={name:'native-today-os-events-only',setup(api){api.onLoad({filter:/src\/lib\/platform\.ts$/},args=>{const source=readFileSync(args.path,'utf8'),start=source.indexOf('export async function startNativeFoundationRuntime(');assert.ok(start>0);return{loader:'ts',contents:source.slice(0,start)+`export async function startNativeFoundationRuntime(options){const back=()=>options.onBack(),resume=()=>options.onResume();window.addEventListener('today:test-back',back);window.addEventListener('today:test-resume',resume);return()=>{window.removeEventListener('today:test-back',back);window.removeEventListener('today:test-resume',resume);};}`};});}};
const bundle=await build({plugins:[osBoundary],entryPoints:['tests/fixtures/native-foundation-client.tsx'],bundle:true,write:false,minify:true,platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
const css=readFileSync('dist/native/index.css'),secrets=new Map(),calls=[],errors=[];
let failOverview=false,holdNext=false,held=[],priorChapter;
const front=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/v1/native/')){
  const record={method:req.method,path:url.pathname};calls.push(record);
  if(failOverview&&url.pathname.endsWith('/today-overview')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'native_request_failed'}));return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await fetch(`${backend}${req.url}`,{method:req.method,headers:{Origin:'capacitor://localhost','X-Versado-Client':'native-v1','x-real-ip':'127.0.0.61',...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  const body=await response.text();if(url.pathname.endsWith('/today-overview')||url.pathname.endsWith('/me')){const value=JSON.parse(body);record.response={status:response.status,language:value.language??value.uiLanguage,error:value.error};}const finish=()=>{if(!res.destroyed){res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);}};
  if(holdNext&&url.pathname.endsWith('/today-overview')){holdNext=false;held.push(finish);}else finish();return;
 }
 if(url.pathname.startsWith('/test-keychain/')){if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);secrets.set(url.pathname,Buffer.concat(chunks).toString());}if(req.method==='DELETE')secrets.delete(url.pathname);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:secrets.get(url.pathname)??null}));return;}
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(url.pathname==='/index.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
 if(['/native-artwork/','/images/','/icons/','/mascots/','/scripture/'].some(prefix=>url.pathname.startsWith(prefix))&&!url.pathname.includes('..')){res.setHeader('Content-Type',url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.svg')?'image/svg+xml':'image/webp');res.end(readFileSync(url.pathname.startsWith('/native-artwork/')?`dist/native${url.pathname}`:`public${url.pathname}`));return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
}catch(error){console.error('Today testproxy:',error.message);res.writeHead(500);res.end();}});
await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${front.address().port}`,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const password='Synthetic-Today-B2-42',collections=[],artifacts=[];
async function seedAccount(language,collectionId,lessonId){const user=await prisma.user.create({data:{email:`today-${randomUUID()}@example.invalid`,handle:`Vandaag${language}${randomUUID().slice(0,6)}`,discriminator:'01',passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),avatarCharacterId:'aaron',activeContentCollectionId:collectionId,contentLanguage:'nl',uiLanguage:language,timeZone:'Europe/Amsterdam',companion:'VERA',shareOnlineStatus:false}});await prisma.contentProgress.create({data:{userId:user.id,contentKey:contentKeyOf({id:priorChapter.id,number:1,book:{key:"bofm/alma"}}),lastChapterId:priorChapter.id,readStatus:"READ",readVerse:3,readAt:new Date()}});await prisma.userCourseProgress.create({data:{userId:user.id,courseId:lessonId.courseId,subscribed:true,currentLessonId:lessonId.id,lastActivityAt:new Date()}});return user;}
async function login(page,user,t){await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.locator('[data-today-overview]').waitFor();}
try{
 await prisma.contentSwitcherSettings.upsert({where:{id:"singleton"},create:{id:"singleton",enabled:true},update:{enabled:true}});
 await prisma.contentWork.upsert({where:{key:'bofm'},create:{key:'bofm',kind:'SCRIPTURE'},update:{}});
 const prefix=`today-browser-${randomUUID()}`;
 for(const language of ['nl','en']){
  const collection=await prisma.contentCollection.create({data:{id:`${prefix}-${language}`,icon:"book",slug:`${prefix}-${language}`,work:'bofm',name:`Vandaagbron ${language}`,language,editionKey:prefix,visibleToUsers:true,enabled:true,publicationState:'PUBLISHED'}});collections.push(collection.id);
  const book=await prisma.book.create({data:{slug:`${prefix}-${language}`,key:'bofm/alma',name:'Alma',order:1,contentCollectionId:collection.id}});
  for(const number of [1,32])await prisma.chapter.create({data:{bookId:book.id,number,order:number,verses:{create:[1,2,3].map(number=>({number,text:`Synthetische Vandaagtekst ${language}, zonder echte persoonsgegevens.`}))}}});
 }
 const chapter=await prisma.chapter.findFirstOrThrow({where:{number:32,book:{contentCollectionId:collections[0]}}});
 priorChapter=await prisma.chapter.findFirstOrThrow({where:{number:1,book:{contentCollectionId:collections[0]}}});
 const course=await prisma.course.create({data:{slug:prefix,type:'READING_LESSONS',name:'Stap voor stap',contentCollectionId:collections[0],lessons:{create:[{order:1,chapterId:priorChapter.id,startVerse:1,endVerse:3},{order:2,chapterId:chapter.id,startVerse:1,endVerse:2}]}},include:{lessons:{orderBy:{order:'asc'}}}});
 for(const language of ['nl','en','de','fr','es']){
  const t=getT(language),user=await seedAccount(language,collections[0],course.lessons[1]);
  const context=await browser.newContext({viewport:{width:390,height:844},locale:language}),web=await browser.newContext({viewport:{width:390,height:844},locale:language});
  let sockets=0;const page=await context.newPage();page.on('websocket',()=>sockets++);page.on('pageerror',error=>errors.push(error.message));await page.goto(`${origin}/?device=today-${language}&language=${language}&accountLanguage=1`);await login(page,user,t);
  await web.addCookies([{name:SESSION_COOKIE,value:await createSessionToken(user.id),url:backend}]);const webPage=await web.newPage();webPage.on('pageerror',error=>errors.push(error.message));await webPage.goto(`${backend}/dashboard`);await webPage.locator('[data-today-overview]').waitFor();
  const content=async p=>p.locator('[data-today-overview]').evaluate(root=>({headings:[...root.querySelectorAll('h1,h2,h3')].map(h=>h.textContent),sections:[...root.querySelectorAll('section[aria-labelledby]')].map(s=>s.getAttribute('aria-labelledby')),positions:[...root.querySelectorAll('.card-title-link')].map(a=>a.parentElement.parentElement.textContent),art:[...root.querySelectorAll('[data-artwork]')].map(i=>i.getAttribute('data-artwork'))}));
  // Relative timestamps can advance during rendering; their course-position container excludes the footer time.
  assert.deepEqual(await content(page),await content(webPage),'Dezelfde daadwerkelijke Vandaag-renderer, kaarten, volgorde, cursor en artwork');
  assert.match(await page.locator('[data-today-overview]').textContent(),/Alma 32/);
  assert.equal(await page.locator('button').filter({hasText:/Alma 1 —/}).count(),0,'Geen eerste-hoofdstukproef in het echte overzicht');
  await page.waitForFunction(()=>document.activeElement?.matches('[data-today-overview] h1[data-native-route-focus]'));
  assert.equal(await page.locator('[data-today-overview] h1').evaluate(h=>getComputedStyle(h).outlineStyle),'none');
  const quote=page.locator('[data-today-overview] blockquote').filter({hasText:'Synthetische Vandaagtekst nl'}).first();
  assert.notEqual(await quote.evaluate(el=>getComputedStyle(el).userSelect),'none');
  const selected=await quote.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);const text=selection.toString();selection.removeAllRanges();return text;});assert.ok(selected.includes('Synthetische Vandaagtekst nl'));
  for(const [width,height,scale,scheme]of [[320,844,1,'light'],[320,844,2,'dark'],[375,844,1,'dark'],[375,844,2,'light'],[390,844,1,'light'],[390,844,2,'dark'],[400,844,1,'dark'],[400,844,2,'light'],[1024,1366,1,'light'],[1366,1024,2,'dark']])for(const [kind,p]of [['native',page],['web',webPage]]){
   await p.setViewportSize({width,height});await p.emulateMedia({colorScheme:scheme});await p.evaluate(scale=>{document.documentElement.style.fontSize=`${scale*100}%`;window.dispatchEvent(new Event('resize'));},scale);await p.waitForTimeout(80);
   const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
   if(overflow){await p.screenshot({path:`${out}/FAILED-${kind}-${language}-${width}-${scale}-${scheme}.png`,fullPage:true});console.error('Today overflow:',await p.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.right>innerWidth+1&&r.width>0;}).slice(0,18).map(el=>({tag:el.tagName,classes:el.className,text:el.textContent?.slice(0,80),width:el.getBoundingClientRect().width,right:el.getBoundingClientRect().right}))));}
   assert.equal(overflow,false,`${kind} ${language} ${width} ${scale}: overflow`);
   await p.locator('[data-today-overview] [data-artwork] img').evaluateAll(images=>Promise.all(images.map(image=>{image.loading='eager';return image.decode();})));
   const name=`${kind}-${language}-${width}-${scale}-${scheme}.png`;await p.screenshot({path:`${out}/${name}`,fullPage:true});artifacts.push(name);
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.style.fontSize='100%';window.dispatchEvent(new Event('resize'));});
  await page.keyboard.press('Tab');await page.locator('.card-title-link').first().evaluate(el=>el.focus({preventScroll:true}));
  assert.equal(await page.locator('.card-title-link').first().evaluate(el=>el.matches(':focus-visible')&&getComputedStyle(el.closest('article')).getPropertyValue('--tw-ring-shadow').includes('2px')),true);
  await page.keyboard.press('Enter');await page.getByRole('dialog').waitFor();await page.getByText(t('nativeToday.unavailable'),{exact:true}).first().waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('today:test-back')));await page.getByRole('dialog').waitFor({state:'detached'});assert.equal(new URL(page.url()).hash,'#/dashboard','Systeemterug sluit de melding zonder de Vandaag-route te verlaten');
  await page.locator('.card-title-link').first().click();await page.getByRole('button',{name:t('common.close'),exact:true}).click();assert.equal(new URL(page.url()).hash,'#/dashboard');
  await page.mouse.wheel(0,1000);await page.waitForFunction(()=>scrollY>400);const position=await page.evaluate(()=>scrollY);
  // DOM click preserves the existing scroll position; it does not scroll the fixed avatar into view.
  await page.locator('a[data-kompas-target="profile"]').evaluate(a=>a.click());await page.locator('[data-subpage-back-bar] button').click();await page.waitForFunction(position=>Math.abs(scrollY-position)<2,position,{timeout:4000});
  if(language==='nl'){
   await page.locator('a[data-kompas-target="profile"]').click();
   await prisma.user.update({where:{id:user.id},data:{uiLanguage:'de'}});await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));await page.getByRole('heading',{level:1,name:getT('de')('nativeFoundation.account'),exact:true}).waitFor();await page.locator('[data-subpage-back-bar] button').click();await page.waitForFunction(title=>document.documentElement.lang==='de'&&document.querySelector('[data-kompas-target="kompas-entry"]')?.textContent.includes(title),getT('de')('kompas.entry.title'));
   await prisma.user.update({where:{id:user.id},data:{uiLanguage:'nl'}});await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));await page.waitForFunction(title=>document.documentElement.lang==='nl'&&document.querySelector('[data-kompas-target="kompas-entry"]')?.textContent.includes(title),t('kompas.entry.title'));
   await webPage.locator('[aria-labelledby="today-continue"] button[aria-haspopup="menu"]').click();await webPage.getByRole('menuitem',{name:t('today.hideContinue'),exact:true}).click();await webPage.locator('.card-title-link').waitFor({state:'detached'});
   await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));await page.locator('.card-title-link').waitFor({state:'detached'});
   assert.equal((await prisma.userCourseProgress.findUniqueOrThrow({where:{userId_courseId:{userId:user.id,courseId:course.id}}})).currentLessonId,course.lessons[1].id,'Web hide changes only the existing personal list preference');
   failOverview=true;await page.evaluate(()=>window.dispatchEvent(new Event('versado:app-resumed')));await page.getByText(t('nativeFoundation.error'),{exact:true}).first().waitFor();assert.ok((await page.locator('[data-today-overview]').textContent()).includes(user.handle));
   failOverview=false;await page.getByRole('button',{name:t('nativeFoundation.retry'),exact:true}).first().click();await page.getByText(t('nativeFoundation.error'),{exact:true}).first().waitFor({state:'hidden'});await page.locator('[data-today-overview]').waitFor();
   // Real source switch clears old content and preserves the existing course cursor in storage.
   await page.locator('[data-kompas-target="content-switcher"] a').click();await page.locator('[data-content-language]').getByRole('button',{name:'English',exact:true}).click();await page.locator('[data-today-overview]').waitFor();await page.waitForFunction(()=>scrollY===0);assert.equal(await page.locator('.card-title-link').count(),0);
   assert.equal((await prisma.userCourseProgress.findUniqueOrThrow({where:{userId_courseId:{userId:user.id,courseId:course.id}}})).currentLessonId,course.lessons[1].id);
   const other=await seedAccount('nl',collections[0],course.lessons[1]);holdNext=true;await page.evaluate(()=>window.dispatchEvent(new Event('versado:app-resumed')));
   for(let i=0;held.length===0&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(held.length);
   await page.locator('a[data-kompas-target="profile"]').click();await page.getByRole('button',{name:t('nativeFoundation.logout'),exact:true}).click();await page.locator('form').waitFor();await login(page,other,t);
   for(const finish of held.splice(0))finish();await page.waitForTimeout(100);assert.ok((await page.locator('[data-today-overview]').textContent()).includes(other.handle));assert.equal((await page.locator('[data-today-overview]').textContent()).includes(user.handle),false,'Late A-response cannot overwrite B');
   await prisma.nativeSession.updateMany({where:{userId:other.id},data:{revokedAt:new Date()}});await page.evaluate(()=>window.dispatchEvent(new Event('versado:app-resumed')));await page.locator('form').waitFor();assert.equal(await page.locator('[data-today-overview]').count(),0);
  }
  assert.equal(sockets,0);await context.close();await web.close();
 }
 assert.deepEqual(errors,[]);assert.equal(calls.some(call=>call.path==='/api/v1/native/today'),false,'Een capabele backend gebruikt nooit de Foundation-hoofdstukproef');assert.equal(calls.filter(call=>call.method==='POST'&&call.path==='/api/v1/native/content-context').length,1,'Precies één bewust gekozen B1-bronwissel, zonder automatische retry');assert.deepEqual(calls.filter(call=>call.method!=='GET'&&!['login','logout','refresh','content-context'].some(path=>call.path.endsWith('/'+path))),[],'Geen voortgangs-, hide-, friends- of beloningswrites via onbewezen native routes');
 console.log(`Gedeelde Vandaag: ${artifacts.length} web/native screenshots, vijf talen, echte vers-stapcursor, kaarten/volgorde/artwork, 320px/200%, licht/donker/tablets, veilige bestemmingen, focus/scroll, bronwissel, leesfout/herstel, late accountresponse en intrekking. Geen fysieke acceptatie.`);
}finally{for(const finish of held.splice(0))finish();await browser.close();await new Promise(resolve=>front.close(resolve));await prisma.contentCollection.deleteMany({where:{id:{in:collections}}});await prisma.$disconnect();}
