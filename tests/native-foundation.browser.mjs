import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db.ts';
import {hashPassword} from '../src/lib/auth.ts';
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL)throw Error('Alleen eigen geïsoleerde database');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-browser';rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
// Maak een onveranderlijke asset-snapshot vóór de browser start.
const stylesheet=readFileSync('dist/native/index.css');
const bundle=await build({entryPoints:['tests/fixtures/native-foundation-client.tsx'],bundle:true,write:false,platform:'browser',define:{'process.env.NODE_ENV':'"production"'},minify:true});
const secrets=new Map();let network=true;const backend=process.env.NATIVE_TEST_BASE_URL;
const front=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/v1/native/')){
   if(!network){res.destroy();return;}
   const chunks=[];for await(const c of req)chunks.push(c);
   const response=await fetch(`${backend}${req.url}`,{method:req.method,headers:{Origin:'capacitor://localhost','X-Versado-Client':'native-v1','x-real-ip':'127.0.0.21',...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
   res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(await response.text());return;
  }
  if(url.pathname.startsWith('/test-keychain/')){
   const id=url.pathname;if(req.method==='PUT'){const chunks=[];for await(const c of req)chunks.push(c);secrets.set(id,Buffer.concat(chunks).toString());}if(req.method==='DELETE')secrets.delete(id);
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:secrets.get(id)??null}));return;
  }
  if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
  if(url.pathname==='/index.css'){res.setHeader('Content-Type','text/css');res.end(stylesheet);return;}
  if(url.pathname.startsWith('/icons/')||url.pathname.startsWith('/mascots/')){if(url.pathname.includes('..')){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',url.pathname.endsWith('.png')?'image/png':'image/webp');res.end(readFileSync(`public${url.pathname}`));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="nl"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
 }catch{res.writeHead(500);res.end();}
});
await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${front.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const results=[];
try{
 await prisma.contentWork.upsert({where:{key:'bofm'},create:{key:'bofm',kind:'SCRIPTURE'},update:{}});
 const collection=await prisma.contentCollection.create({data:{id:`native-browser-${randomUUID()}`,slug:`native-browser-${randomUUID()}`,name:'Native proef',icon:'book',work:'bofm',language:'nl',editionKey:'native-browser',enabled:true,visibleToUsers:true,publicationState:'LEGACY'}});
 const book=await prisma.book.create({data:{slug:`native-browser-${randomUUID()}`,name:'Nativeboek',order:1,key:'bofm/1-ne',contentCollectionId:collection.id}});
 await prisma.chapter.create({data:{bookId:book.id,number:1,order:1,verses:{create:[{number:1,text:'Een synthetische passage voor de gedeelde leesproef.'},{number:2,text:'Voortgang blijft bij dezelfde gebruiker bewaard.'}]}}});
 const password='Synthetic-browser-42',user=await prisma.user.create({data:{email:`native-browser-${randomUUID()}@example.invalid`,handle:'Nativebrowser',discriminator:'01',passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:collection.id}});
 for(const [width,height,scheme,scale,locale]of [[320,844,'light',2,'nl-NL'],[390,844,'dark',1,'nl-NL'],[1280,900,'light',1,'de-DE'],[844,390,'dark',1,'fr-FR']]){
  const context=await browser.newContext({viewport:{width,height},locale,hasTouch:width<900,isMobile:width<900,colorScheme:scheme});
  await context.addInitScript(({scale})=>{const apply=()=>{document.documentElement.style.fontSize=`${100*scale}%`;for(const [edge,size]of Object.entries({top:24,bottom:18,left:12,right:12}))document.documentElement.style.setProperty(`--safe-area-inset-${edge}`,`${size}px`);};if(document.documentElement)apply();else document.addEventListener('DOMContentLoaded',apply,{once:true});},{scale});
  let page=await context.newPage();const errors=[],failedResponses=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Native browserfout:',e.message);});page.on('response',r=>{if(r.status()>=400){failedResponses.push({path:new URL(r.url()).pathname,status:r.status()});console.error('Native testresponse:',new URL(r.url()).pathname,r.status());}});network=false;
  try{
  const device=`${width}-${randomUUID()}`;
  await page.goto(`${origin}/?device=${device}`);await page.getByRole('heading',{level:1}).waitFor();await page.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('dark')),scheme==='dark','De echte lokale adapter volgt het systeemthema');
  await page.emulateMedia({colorScheme:scheme==='dark'?'light':'dark'});
  await page.waitForFunction(expected=>document.documentElement.classList.contains('dark')===expected,scheme!=='dark');
  await page.emulateMedia({colorScheme:scheme});
  await page.waitForFunction(expected=>document.documentElement.classList.contains('dark')===expected,scheme==='dark');
  assert.equal(await page.locator('form').count(),1,'Offline cold start toont lokale inloginterface');
  await page.locator('a[href="#/privacy"]').click();assert.equal(new URL(page.url()).hash,'#/privacy');
  await page.evaluate(()=>scrollTo(0,0));
  await page.waitForFunction(()=>{const heading=document.querySelector('h1'),bar=document.querySelector('[data-sticky-header]');return heading&&bar&&heading.getBoundingClientRect().top>=bar.getBoundingClientRect().bottom-1;});
  const barTop=await page.locator('[data-subpage-back-bar]').evaluate(el=>el.getBoundingClientRect().top);
  const tall=await page.evaluate(()=>document.documentElement.hasAttribute('data-header-tall'));
  assert.equal(await page.locator('[data-sticky-header]').evaluate(el=>getComputedStyle(el).position),tall?'absolute':'fixed','Grote tekst volgt het bestaande ShellMetrics-contract');
  await page.evaluate(()=>scrollTo(0,300));
  const scroll=await page.evaluate(()=>scrollY);
  assert.equal(Math.round(await page.locator('[data-subpage-back-bar]').evaluate(el=>el.getBoundingClientRect().top)),Math.round(barTop-(tall?scroll:0)),'Normale terugbalk blijft staan; een schermvullende tekstbalk scrollt volgens de shellregel mee');
  await page.locator('a[href="#/cookies"]').click();assert.equal(new URL(page.url()).hash,'#/cookies');
  await page.reload();await page.locator('table').waitFor();assert.equal(new URL(page.url()).hash,'#/cookies','Offline herladen bewaart de lokale route');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Ook juridische tekst heeft geen overflow');
  await page.goBack();await page.locator('a[href="#/cookies"]').waitFor();
  await page.goBack();await page.locator('form').waitFor();network=true;
  // Nederlands voor functionele interacties; andere talen worden op layout/overflow getest.
  if(locale==='nl-NL'){
   await page.getByLabel('E-mail of gebruikerstag').fill(user.email);await page.getByLabel('Wachtwoord',{exact:true}).fill(password);await page.getByRole('button',{name:'Inloggen',exact:true}).click();
   await page.getByRole('heading',{name:/Vandaag/}).waitFor();await page.getByRole('button',{name:/Nativeboek 1/}).click();
   await page.getByText('Een synthetische passage voor de gedeelde leesproef.',{exact:false}).waitFor();
   if(width===320)await page.getByRole('button',{name:'Markeer als gelezen',exact:true}).click();
   await page.getByRole('button',{name:'Opgeslagen op de server',exact:true}).waitFor();
   assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).xpTotal,0);
   await page.reload();await page.getByRole('heading',{name:'Nativeboek 1',exact:true}).waitFor();
   await page.getByRole('button',{name:'Opgeslagen op de server',exact:true}).waitFor();
   assert.match(new URL(page.url()).hash,/^#\/lesson\//,'Heropening herstelt de echte leesroute');
   assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0,'Geen sessiegeheimen in webopslag');
   await page.screenshot({path:`${out}/reader-${width}-${scheme}-${scale}.png`,fullPage:true});
   // Vernietig de WebView; alleen de gesimuleerde beveiligde platformopslag blijft bestaan.
   await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto(`${origin}/?device=${device}`);await page.getByRole('heading',{name:/Vandaag/}).waitFor();
   await page.getByRole('button',{name:'Accountinstellingen',exact:true}).click();
   await page.getByLabel('Wachtwoord',{exact:true}).fill(password);
   await page.getByRole('button',{name:'Uitloggen',exact:true}).click();await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();
   assert.equal(await page.getByLabel('Wachtwoord',{exact:true}).inputValue(),'','Logout bewaart geen herauthenticatiewachtwoord');
   await page.reload();await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();
   // Het welkomstscherm verschijnt direct; wacht ook op bevestigde intrekking na reload.
   await page.getByRole('button',{name:'Opnieuw proberen',exact:true}).click({trial:true});
   assert.equal(secrets.has(`/test-keychain/${device}`),false,'Beveiligde logoutqueue is na serverbevestiging verwijderd');
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Geen horizontale overflow');assert.deepEqual(errors,[]);assert.deepEqual(failedResponses,[],'Geen ontbrekende stylesheets/assets of geweigerde geldige API-acties');
  await page.screenshot({path:`${out}/welcome-${width}-${scheme}-${scale}-${locale}.png`,fullPage:true});results.push({width,height,scheme,scale,locale,offlineStartup:true,localLegalRoutes:true,routeReload:true,historyBack:true,systemTheme:true,safeAreaInsets:true,overflow:false});
  }catch(error){console.error('Native testscherm:',await page.locator('body').innerText());await page.screenshot({path:`${out}/failure-${width}.png`,fullPage:true});throw error;}finally{await context.close();}
 }
 writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log('Native browserbewijs:',JSON.stringify(results));
}finally{await browser.close();await new Promise(resolve=>front.close(resolve));await prisma.$disconnect();}
