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
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL)throw Error('Alleen eigen geïsoleerde database');
const backend=process.env.NATIVE_TEST_BASE_URL;
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-browser/content-picker';mkdirSync(out,{recursive:true});
const inputs=JSON.parse(readFileSync('dist/native.inputs.json','utf8'));
for(const component of ['content/ContentPickerView','content/ContentSwitcherView','shell/AppShellFrame','shell/AppShellHeader','shell/SubpageBackBarView','shell/HeaderAvatarView','shell/UserBadgesView','versado/UserAvatarView']) assert.ok(inputs.some(file=>file.endsWith(`src/components/${component}.tsx`)),`${component} ontbreekt in de echte native bundel`);
assert.ok(inputs.every(file=>!/(?:node_modules\/(?:next|@prisma)\/|src\/lib\/(?:db|auth)\.ts|\.server\.ts$)/.test(file)),'Geen Next/server/database-runtime in de lokale app');
copyFileSync('dist/native.inputs.json',`${out}/native.inputs.json`);
const bundle=await build({entryPoints:['tests/fixtures/native-foundation-client.tsx'],bundle:true,write:false,platform:'browser',define:{'process.env.NODE_ENV':'"production"'},minify:true});
const stylesheet=readFileSync('dist/native/index.css');
const secrets=new Map(),held=[];let holdMe=false,failContext=false;const nativeCalls=[];
const front=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/v1/native/')){
  nativeCalls.push({path:url.pathname,method:req.method});
  if(failContext&&url.pathname==='/api/v1/native/content-context'&&req.method==='GET'){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'network_unavailable'}));return;}
  const chunks=[];for await(const c of req)chunks.push(c);
  const response=await fetch(`${backend}${req.url}`,{method:req.method,headers:{Origin:'capacitor://localhost','X-Versado-Client':'native-v1','x-real-ip':'127.0.0.41',...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  const body=await response.text();const finish=()=>{res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);};
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
 await prisma.contentSwitcherSettings.upsert({where:{id:'singleton'},create:{id:'singleton',enabled:true},update:{enabled:true}});
 await prisma.contentWork.upsert({where:{key:'bofm'},create:{key:'bofm',kind:'SCRIPTURE'},update:{}});
 const prefix='picker-browser-'+randomUUID(),collections={},chapters={};
 for(const language of ['nl','en','de','fr','es']){
  collections[language]=await prisma.contentCollection.create({data:{id:`${prefix}-${language}`,slug:`${prefix}-${language}`,name:`Boek van Mormon (${language})`,icon:'book',work:'bofm',language,editionKey:prefix,enabled:true,visibleToUsers:true,publicationState:'PUBLISHED'}});
  const book=await prisma.book.create({data:{slug:`${prefix}-${language}`,name:`Boek ${language}`,order:1,key:'bofm/1-ne',contentCollectionId:collections[language].id}});
  chapters[language]=await prisma.chapter.create({data:{bookId:book.id,number:1,order:1,verses:{create:{number:1,text:`Synthetische ${language}-passage voor de contentkiezer.`}}}});
 }
 const artifacts=[];
 for(const language of ['nl','en','de','fr','es']){
  const t=getT(language),user=await prisma.user.create({data:{email:`picker-browser-${randomUUID()}@example.invalid`,handle:`Kiezer${language}${randomUUID().slice(0,6)}`,discriminator:'01',passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:collections.nl.id,contentLanguage:'nl',uiLanguage:language,xpTotal:37}});
  const context=await browser.newContext({viewport:{width:390,height:844},locale:language,colorScheme:'light'}),web=await browser.newContext({viewport:{width:390,height:844},locale:language,colorScheme:'light'});
  const page=await context.newPage(),webPage=await web.newPage();for(const p of [page,webPage])p.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/?device=${randomUUID()}`);await login(page,user,t);
  await page.locator('[data-kompas-target="content-switcher"] a').click();await page.locator('[data-content-work="bofm"]').waitFor();
  assert.equal(await page.getByRole('region',{name:t('nativeAccess.title')}).count(),0,'Geen intern paneel in gewone contentkiezer');
  assert.equal(await page.getByRole('button',{name:t('nativeFoundation.keyboardDone'),exact:true}).count(),0);
  await web.addCookies([{name:'bvm_session',value:await createSessionToken(user.id),url:backend}]);await webPage.goto(`${backend}/content`);await webPage.locator('[data-content-work="bofm"]').waitFor();
  await page.waitForFunction(()=>document.activeElement?.matches('[data-content-picker] h1[data-native-route-focus]'));
  assert.equal(await page.locator('[data-content-picker] h1').evaluate(h=>getComputedStyle(h).outlineStyle),'none');
  await webPage.waitForFunction(()=>document.activeElement?.matches('[data-content-picker] h1'));
  assert.equal(await webPage.locator('[data-content-picker] h1').getAttribute('data-native-route-focus'),null,'Web behoudt eigen focus zonder native marker');
  const cards=async p=>p.locator('[data-content-work]').evaluateAll(cards=>cards.map(card=>({work:card.dataset.contentWork,text:card.textContent,classes:card.className})).sort((a,b)=>a.work.localeCompare(b.work)));
  assert.deepEqual(await cards(page),await cards(webPage),'Exact dezelfde kaarten, teksten en stijlen uit één renderer');
  for(const [width,height,scale,scheme]of [[320,844,1,'light'],[320,844,2,'dark'],[375,844,1,'dark'],[375,844,2,'light'],[390,844,1,'light'],[390,844,2,'dark'],[400,844,1,'dark'],[400,844,2,'light'],[1024,1366,1,'light'],[1366,1024,2,'dark']]){
   for(const [kind,p]of [['native',page],['web',webPage]]){
    await p.setViewportSize({width,height});await p.emulateMedia({colorScheme:scheme});
    await p.evaluate(scale=>{document.documentElement.style.fontSize=`${scale*100}%`;for(const [edge,size]of Object.entries({top:24,bottom:18,left:12,right:12}))document.documentElement.style.setProperty(`--safe-area-inset-${edge}`,`${size}px`);window.dispatchEvent(new Event('resize'));},scale);
    await p.waitForTimeout(80);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${kind} ${language} ${width} ${scale}: horizontale overflow`);
    assert.equal(await p.locator('[data-content-picker]').count(),1);assert.equal(await p.locator('[data-app-shell-main]').count(),1);
    await p.locator('[data-content-work="bofm"] img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
    const name=`${kind}-${language}-${width}-${scale}-${scheme}.png`;await p.screenshot({path:`${out}/${name}`,fullPage:true});artifacts.push(name);
   }
  }
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.style.fontSize='100%';window.dispatchEvent(new Event('resize'));});
  if(language==='nl'){
   const selected=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/native/content-context');
   await page.locator('[data-content-language]').getByRole('button',{name:'English',exact:true}).click();assert.equal((await selected).status(),200);
   await page.waitForFunction(()=>location.hash==='#/dashboard');
   assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).activeContentCollectionId,collections.en.id);
   await webPage.reload();await webPage.locator('[data-content-language] button[aria-pressed="true"]').waitFor();
   assert.equal(await webPage.locator('[data-content-language] button[aria-pressed="true"]').textContent(),'English');
   const update=webPage.waitForResponse(r=>r.request().method()==='PUT'&&new URL(r.url()).pathname==='/api/content-context');
   await webPage.locator('[data-content-language]').getByRole('button',{name:'Deutsch',exact:true}).click();assert.equal((await update).status(),200);
   // Accessnative heeft bewust geen WebSocket: de bestaande storepoll synchroniseert uiterlijk15s, hervatten meteen.
   await page.waitForFunction(()=>document.querySelector('[data-kompas-target="content-switcher"] a')?.getAttribute('title')==='Boek van Mormon (de)',{},{timeout:20_000});
   await page.getByRole('button',{name:/Boek de 1/}).click();await page.getByText('Synthetische de-passage voor de contentkiezer.',{exact:false}).waitFor();
   await page.locator('[data-subpage-back-bar] button').click();await page.waitForFunction(()=>location.hash==='#/dashboard');
   await page.locator('[data-kompas-target="content-switcher"] a').click();
   const remap=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/v1/native/content-context');
   await page.locator('[data-content-language]').getByRole('button',{name:'Français',exact:true}).click();assert.equal((await remap).status(),200);
   await page.getByRole('button',{name:/Boek fr 1/}).click();
   await page.getByText('Synthetische fr-passage voor de contentkiezer.',{exact:false}).waitFor();
   assert.equal(await page.getByText('Synthetische de-passage voor de contentkiezer.',{exact:false}).count(),0,'Geen oude hoofdstuktekst onder nieuwe bron');
   await page.locator('[data-subpage-back-bar] button').click();await page.waitForFunction(()=>location.hash==='#/dashboard');
   await page.locator('a[data-kompas-target="profile"]').click();await page.getByRole('link',{name:t('nativeDiagnostics.open'),exact:true}).click();
   await page.getByRole('heading',{name:t('nativeDiagnostics.title'),exact:true}).waitFor();await page.getByRole('button',{name:t('nativeFoundation.keyboardDone'),exact:true}).waitFor();
   await page.screenshot({path:`${out}/internal-diagnostics.png`,fullPage:true});await page.locator('[data-subpage-back-bar] button').click();
   await page.getByRole('button',{name:t('nativeFoundation.logout'),exact:true}).click();await page.locator('form').waitFor();
   const other=await prisma.user.create({data:{email:`picker-other-${randomUUID()}@example.invalid`,handle:'Ander'+randomUUID().slice(0,6),discriminator:'01',passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:collections.es.id,contentLanguage:'es'}});
   await login(page,other,t);await page.locator('[data-kompas-target="content-switcher"] a').click();await page.locator('[data-content-work="bofm"]').waitFor();
   assert.equal(await page.locator('[data-content-language] button[aria-pressed="true"]').textContent(),'Español');
   const writes=nativeCalls.filter(c=>c.method==='POST'&&c.path==='/api/v1/native/content-context').length;
   await context.setOffline(true);await page.locator('[data-content-language]').getByRole('button',{name:'English',exact:true}).click();await page.getByRole('alert').first().waitFor();
   await context.setOffline(false);await page.locator('[data-content-work="bofm"]').waitFor();await page.waitForTimeout(150);
   assert.equal(nativeCalls.filter(c=>c.method==='POST'&&c.path==='/api/v1/native/content-context').length,writes,'Offline actie wordt niet opgeslagen of hervat als schrijfretry');
   assert.equal((await prisma.user.findUniqueOrThrow({where:{id:other.id}})).activeContentCollectionId,collections.es.id);
   assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).xpTotal,37);
   assert.equal(await prisma.contentProgress.count({where:{userId:user.id}}),0);
  }
  await context.close();await web.close();
 }
 assert.deepEqual(errors,[]);
 console.log(`Gedeelde contentkiezer: ${artifacts.length} gekoppelde web/native screenshots, vijf talen,320/375/390/400px,200%,licht/donker,tablets; echte selectie,web/native synchronisatie,hoofdstukequivalent,diagnostiek,accountwisseling en offline zonder schrijfretry.`);
}finally{release();await browser.close();await new Promise(resolve=>front.close(resolve));await prisma.$disconnect();}
