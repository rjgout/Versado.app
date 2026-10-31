// De echte Next-webshell naast dezelfde React-views in de lokale Foundation.
// Alleen synthetische gebruikers en de eigen wegwerpdatabase; geen productie.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {prisma} from '../src/lib/db.ts';
import {hashPassword,createSessionToken} from '../src/lib/auth.ts';
import {getT} from '../src/lib/i18n/index.ts';
import {dayKeyInZone} from '../src/lib/timeZone.ts';
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL)throw Error('Alleen eigen geïsoleerde database');
const backend=process.env.NATIVE_TEST_BASE_URL;
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-browser/shared-shell';mkdirSync(out,{recursive:true});
const inputs=JSON.parse(readFileSync('dist/native.inputs.json','utf8'));
for(const component of ['shell/AppShellFrame','shell/AppShellHeader','shell/SubpageBackBarView','shell/HeaderAvatarView','shell/UserBadgesView','versado/UserAvatarView']) assert.ok(inputs.some(file=>file.endsWith(`src/components/${component}.tsx`)),`${component} ontbreekt in de echte native bundel`);
assert.ok(inputs.every(file=>!/(?:node_modules\/(?:next|@prisma)\/|src\/lib\/(?:db|auth)\.ts|\.server\.ts$)/.test(file)),'Geen Next/server/database-runtime in de lokale app');
copyFileSync('dist/native.inputs.json',`${out}/native.inputs.json`);
const bundle=await build({entryPoints:['tests/fixtures/native-foundation-client.tsx'],bundle:true,write:false,platform:'browser',define:{'process.env.NODE_ENV':'"production"'},minify:true});
const stylesheet=readFileSync('dist/native/index.css');
const secrets=new Map(),held=[];let holdMe=false;const nativeCalls=[];
const front=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/v1/native/')){
  nativeCalls.push({path:url.pathname,method:req.method});
  const chunks=[];for await(const c of req)chunks.push(c);
  const response=await fetch(`${backend}${req.url}`,{method:req.method,headers:{Origin:'capacitor://localhost','X-Versado-Client':'native-v1','x-real-ip':'127.0.0.41',...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  let body=await response.text();
  // Expliciete oude-backendcompatibiliteit; native-today.browser test het ongewijzigde nieuwe capabilitycontract.
  if(url.pathname==='/api/v1/native/capabilities'&&response.ok){const value=JSON.parse(body);value.features=value.features.filter(f=>f!=='today-overview-v1');body=JSON.stringify(value);}
  const finish=()=>{res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);};
  if(holdMe&&url.pathname==='/api/v1/native/me'){held.push(finish);}else finish();return;
 }
 if(url.pathname.startsWith('/test-keychain/')){if(req.method==='PUT'){const chunks=[];for await(const c of req)chunks.push(c);secrets.set(url.pathname,Buffer.concat(chunks).toString());}if(req.method==='DELETE')secrets.delete(url.pathname);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:secrets.get(url.pathname)??null}));return;}
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(url.pathname==='/index.css'){res.setHeader('Content-Type','text/css');res.end(stylesheet);return;}
 if(['/icons/','/mascots/','/scripture/'].some(prefix=>url.pathname.startsWith(prefix))&&!url.pathname.includes('..')){res.setHeader('Content-Type',url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.svg')?'image/svg+xml':'image/webp');res.end(readFileSync(`public${url.pathname}`));return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
}catch{res.writeHead(500);res.end();}});
await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${front.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const release=()=>{holdMe=false;for(const finish of held.splice(0))finish();};
const errors=[];const password='Synthetic-shell-browser-42';
const login=async(page,user,t)=>{await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.locator('a[data-kompas-target="profile"]').waitFor();};
try{
 await prisma.contentWork.upsert({where:{key:'bofm'},create:{key:'bofm',kind:'SCRIPTURE'},update:{}});
 const collection=await prisma.contentCollection.create({data:{id:`shell-browser-${randomUUID()}`,slug:`shell-browser-${randomUUID()}`,name:'Shelltest',icon:'book',work:'bofm',language:'nl',editionKey:'shell-browser',enabled:true,visibleToUsers:true,publicationState:'LEGACY'}});
 const book=await prisma.book.create({data:{slug:`shell-browser-${randomUUID()}`,name:'Shellboek',order:1,key:'bofm/1-ne',contentCollectionId:collection.id}});
 await prisma.chapter.create({data:{bookId:book.id,number:1,order:1,verses:{create:{number:1,text:'Synthetische shelltekst.'}}}});
 for(const [index,language]of ['nl','en','de','fr','es'].entries()){
  const t=getT(language);
  const user=await prisma.user.create({data:{email:`shell-browser-${randomUUID()}@example.invalid`,handle:`Shell${language}`,discriminator:'01',passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:collection.id,uiLanguage:language,xpTotal:12345+index,currentStreak:7,lastStudyDate:dayKeyInZone(new Date(),'Europe/Amsterdam'),lastStudyTimeZone:'Europe/Amsterdam',timeZone:'Europe/Amsterdam',avatarCharacterId:'aaron'}});
  const context=await browser.newContext({viewport:{width:390,height:844},locale:language,colorScheme:'light'}),web=await browser.newContext({viewport:{width:390,height:844},locale:language,colorScheme:'light'});
  const page=await context.newPage(),webPage=await web.newPage();for(const p of [page,webPage])p.on('pageerror',e=>errors.push(e.message));
  let sockets=0;page.on('websocket',()=>sockets++);
  await page.goto(`${origin}/?device=${randomUUID()}`);await login(page,user,t);
  await web.addCookies([{name:'bvm_session',value:await createSessionToken(user.id),url:backend}]);await webPage.goto(`${backend}/dashboard`);await webPage.locator('[data-app-global-header] a[data-kompas-target="profile"]').waitFor();
  const nativeHeader=page.locator('[data-app-global-header]'),webHeader=webPage.locator('[data-app-global-header]');
  // Werkelijke gedeelde badgepresentatie en eigen avatar; native badges hebben bewust geen dode links.
  const badgeText=await nativeHeader.locator('[role="img"][aria-label]').allTextContents();
  await nativeHeader.locator('img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
  assert.ok(badgeText.length>=2);for(const text of badgeText)assert.ok((await webHeader.textContent()).includes(text));
  assert.equal(await nativeHeader.locator('a[href="#/xp"], a[href="#/streak"], a[href="#/competition"]').count(),0);
  assert.equal(await page.locator('[data-main-nav] a').count(),1);assert.equal(await webPage.locator('[data-main-nav] a').count(),4);
  for(const [width,height,scale,scheme]of [[390,844,1,'light'],[320,844,2,'dark'],[1024,1366,1,'light'],[1366,1024,1,'dark']]){
   for(const [kind,p]of [['native',page],['web',webPage]]){
    await p.setViewportSize({width,height});await p.emulateMedia({colorScheme:scheme});
    await p.evaluate(scale=>{document.documentElement.style.fontSize=`${scale*100}%`;for(const [edge,size]of Object.entries({top:24,bottom:18,left:12,right:12}))document.documentElement.style.setProperty(`--safe-area-inset-${edge}`,`${size}px`);window.dispatchEvent(new Event('resize'));},scale);
    await p.waitForTimeout(100);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${kind} ${language} ${width} ${scale}: horizontale overflow`);
    assert.ok(await p.locator('[data-app-shell-main]').count());
    await p.screenshot({path:`${out}/${kind}-${language}-${width}-${scale}-${scheme}.png`,fullPage:true});
   }
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.style.fontSize='100%';window.dispatchEvent(new Event('resize'));});
  await page.locator('a[data-kompas-target="profile"]').click();await page.locator('[data-subpage-back-bar]').waitFor();
  await page.locator('[data-subpage-back-bar] button').click();await page.waitForFunction(()=>location.hash==='#/dashboard');
  if(language==='nl'){
   const other=await prisma.user.create({data:{email:`shell-b-${randomUUID()}@example.invalid`,handle:'ShellB',discriminator:'01',passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:collection.id,xpTotal:42,uiLanguage:'nl'}});
   holdMe=true;await page.evaluate(()=>window.dispatchEvent(new Event('versado:app-resumed')));
   for(let attempt=0;held.length===0&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,20));
   assert.ok(held.length>0,'Verversen van de echte header is vertraagd');
   holdMe=false; // Nieuwe accountaanvragen doorlaten; het oude A-antwoord blijft vastgehouden.
   await page.locator('a[data-kompas-target="profile"]').click();await page.getByRole('button',{name:t('nativeFoundation.logout'),exact:true}).click();await page.locator('form').waitFor();
   await login(page,other,t);
   await page.waitForFunction(()=>document.querySelector('[data-app-global-header]')?.textContent.includes('42'));
   const ownHeader=await nativeHeader.textContent();
   release();await page.waitForTimeout(100);
   assert.equal(await nativeHeader.textContent(),ownHeader,'Het late A-antwoord mag na de login van B geen headergegevens terugzetten');
   assert.equal(await nativeHeader.locator('[role="img"]').first().textContent(),'0');
  }
  assert.equal(sockets,0,'Deze Foundation-test maakt geen socket aan');
  await context.close();await web.close();
 }
 assert.deepEqual(errors,[]);assert.ok(nativeCalls.every(call=>call.method==='GET'||['/api/v1/native/login','/api/v1/native/logout'].includes(call.path)),'Shellhervatten verstuurt geen voortgangsmutatie');
 console.log('Gedeelde shell: echte web/native DOM in vijf talen, 320px/200%, licht/donker, tabletrotatie, avatar/terug, late accountresponse, geen schrijfretry; echte bundel zonder Next/serverimports.');
}finally{release();await browser.close();await new Promise(resolve=>front.close(resolve));await prisma.$disconnect();}
