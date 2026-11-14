import {checkGlassShell,checkGlassAccessibility,checkGlassPalette} from "./fixtures/native-glass-checks.mjs";
// Werkelijke gedeelde web-/nativeprofielen, uitsluitend synthetische accounts.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {prisma} from '../src/lib/db.ts';
import {hashPassword,createSessionToken} from '../src/lib/auth.ts';
import {getT} from '../src/lib/i18n/index.ts';
import {generateTotpCode} from '../src/lib/totp.ts';
import {PROFILE_VIEWS} from '../src/lib/profileViews.ts';
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL)throw Error('Alleen eigen geïsoleerde database');
const backend=process.env.NATIVE_TEST_BASE_URL;
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out=process.env.NATIVE_GLASS_TEST==='1'?'/tmp/versado-native-browser/liquid-glass/shared-profile':'/tmp/versado-native-browser/shared-profile';mkdirSync(out,{recursive:true});
const inputs=JSON.parse(readFileSync('dist/native.inputs.json','utf8'));
for(const view of ['ProfileOverview','ProfileSettingsViews','AvatarEditorView','TwoFactorSettingsView','LanguageSettingsView','CompanionPreference'])assert.ok(inputs.some(file=>file.endsWith(`/profile/${view}.tsx`)),view);
assert.ok(inputs.every(file=>!/(?:node_modules\/(?:next|@prisma)\/|src\/lib\/(?:db|auth)\.ts|\.server\.ts$)/.test(file)));
const bundle=await build({entryPoints:['tests/fixtures/native-profile-client.tsx'],bundle:true,write:false,platform:'browser',define:{'process.env.NODE_ENV':'"production"'},minify:true});
const secrets=new Map(),calls=[],missing=[],held=[],heldAccounts=[];let holdAccount=false,holdProfile=false,rejectSave=false,issuedSecret=null;
const front=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/v1/native/')){
  calls.push({path:url.pathname,method:req.method});const chunks=[];for await(const chunk of req)chunks.push(chunk);
  if(rejectSave&&url.pathname==='/api/v1/native/profile'&&req.method==='POST'){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"unavailable"}');return;}
  const response=await fetch(`${backend}${req.url}`,{method:req.method,headers:{Origin:'capacitor://localhost','X-Versado-Client':'native-v1','x-real-ip':'127.0.0.43',...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  const body=await response.text();
  if(url.pathname==='/api/v1/native/profile/two-factor'&&response.ok){const value=JSON.parse(body);if(typeof value.result?.secret==='string')issuedSecret=value.result.secret;}
  const finish=()=>{res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);};
  if(holdAccount&&url.pathname==='/api/v1/native/me'&&req.method==='GET'){heldAccounts.push(finish);return;}
  if(holdProfile&&url.pathname==='/api/v1/native/profile'&&req.method==='GET')held.push(finish);else finish();return;
 }
 if(url.pathname.startsWith('/test-keychain/')){if(req.method==='PUT'){const chunks=[];for await(const c of req)chunks.push(c);secrets.set(url.pathname,Buffer.concat(chunks).toString());}if(req.method==='DELETE')secrets.delete(url.pathname);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:secrets.get(url.pathname)??null}));return;}
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(url.pathname==='/index.css'){res.setHeader('Content-Type','text/css');res.end(readFileSync('dist/native/index.css'));return;}
 if(/\.(?:png|svg|webp|jpg)$/.test(url.pathname)){
  // Geen public/ of backendfallback: uitsluitend de daadwerkelijk verpakte assets.
  const path=resolve('dist/native',`.${url.pathname}`);assert.ok(path.startsWith(resolve('dist/native')+'/'));
  if(!existsSync(path)){missing.push(url.pathname);res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',url.pathname.endsWith('.svg')?'image/svg+xml':url.pathname.endsWith('.png')?'image/png':'image/webp');res.end(readFileSync(path));return;
 }
 if(url.pathname.startsWith('/api/')){calls.push({path:url.pathname,method:req.method});res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
}catch{res.writeHead(500);res.end();}});
await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${front.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const errors=[],password='Synthetic-profile-browser-42',passwordHash=await hashPassword(password);
const releaseAccount=()=>{holdAccount=false;for(const finish of heldAccounts.splice(0))finish();};
const release=()=>{holdProfile=false;for(const finish of held.splice(0))finish();};
async function login(page,user,t){await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await page.locator('a[data-kompas-target="profile"]').waitFor();await page.locator('a[data-kompas-target="profile"]').click();await page.locator('[data-profile-page] h1, [data-profile-page] h2').filter({hasText:user.handle}).waitFor();}
async function profileRoot(page){if(new URL(page.url()).hash!=="#/profile"){await page.locator('[data-subpage-back-bar] button').click();await page.waitForFunction(()=>location.hash==='#/profile');}}
async function openView(page,view,t){
 await profileRoot(page);
 const label=t(view==='competition'?'profile.thisWeek':PROFILE_VIEWS[view].title);
 await page.locator('[data-profile-page] button').filter({hasText:label}).first().click();
 await page.waitForFunction(view=>location.hash===`#/profile?view=${view}`,view);
}
async function renderedImages(page){await page.locator('[data-profile-page] img').evaluateAll(images=>Promise.all(images.map(image=>{image.loading='eager';return image.decode();})));}
try{
 await prisma.contentWork.upsert({where:{key:'bofm'},create:{key:'bofm',kind:'SCRIPTURE'},update:{}});
 const collection=await prisma.contentCollection.create({data:{id:`profile-browser-${randomUUID()}`,slug:`profile-browser-${randomUUID()}`,name:'Profieltest',icon:'book',work:'bofm',language:'nl',editionKey:'profile-browser',enabled:true,visibleToUsers:true,publicationState:'LEGACY'}});
 const book=await prisma.book.create({data:{slug:`profile-browser-${randomUUID()}`,name:'Profielboek',order:1,key:'bofm/1-ne',contentCollectionId:collection.id}});
 await prisma.chapter.create({data:{bookId:book.id,number:1,order:1,verses:{create:{number:1,text:'Synthetische profieltekst.'}}}});
 const makeUser=language=>prisma.user.create({data:{email:`profile-browser-${randomUUID()}@example.invalid`,handle:`Profiel${language}`,discriminator:'01',passwordHash,emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:collection.id,uiLanguage:language,pushNotificationsEnabled:language==='nl',xpTotal:1234,currentStreak:7,timeZone:'Europe/Amsterdam',avatarCharacterId:'nephi'}});
 for(const language of ['nl','en','de','fr','es']){
  const t=getT(language),user=await makeUser(language);
  const context=await browser.newContext({viewport:{width:390,height:844},locale:language,colorScheme:'light'}),web=await browser.newContext({viewport:{width:390,height:844},locale:language,colorScheme:'light'});
  const page=await context.newPage(),webPage=await web.newPage();for(const p of [page,webPage])p.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${origin}/?device=${randomUUID()}&accountLanguage=1${process.env.NATIVE_GLASS_TEST==='1'?'&material=ios':''}`);await login(page,user,t);if(process.env.NATIVE_GLASS_TEST==='1')await checkGlassShell(page);
  await web.addCookies([{name:'bvm_session',value:await createSessionToken(user.id),url:backend}]);await webPage.goto(`${backend}/profile`);await webPage.locator('[data-profile-page] h1, [data-profile-page] h2').filter({hasText:user.handle}).waitFor();
  for(const [width,scale,scheme]of [[390,1,'light'],[320,2,'dark'],[1024,1,'light']])for(const [kind,p]of [['native',page],['web',webPage]]){
   await p.setViewportSize({width,height:844});await p.emulateMedia({colorScheme:scheme});if(kind==='native'&&process.env.NATIVE_GLASS_TEST==='1')await checkGlassPalette(p,scheme);await p.evaluate(scale=>{document.documentElement.style.fontSize=`${scale*100}%`;},scale);await renderedImages(p);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${kind} ${language} ${width}/${scale}: overflow`);
   await p.screenshot({path:`${out}/${kind}-${language}-${width}-${scale}-${scheme}.png`,fullPage:process.env.NATIVE_GLASS_TEST!=='1'});
  }
  for(const p of [page,webPage]){await p.setViewportSize({width:390,height:844});await p.evaluate(()=>document.documentElement.style.fontSize='100%');}
  if(process.env.NATIVE_GLASS_TEST==='1'&&language==='nl'){await profileRoot(page);await checkGlassAccessibility(page,t,out);}
  for(const [view,{title}]of Object.entries(PROFILE_VIEWS)){
   await openView(page,view,t);await page.locator('[data-profile-page]').waitFor();await page.getByRole('heading',{name:t(title),exact:true}).last().waitFor();await renderedImages(page);
   assert.equal(await page.locator('[data-profile-page] footer').count(),0);
   if(language==='nl'&&view==='notifications'){await page.getByText(t('nativeProfile.pushUnavailable'),{exact:true}).waitFor();assert.equal(await page.getByRole('switch',{name:t('profile.pushLabel')}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:t('profile.sendTestPush'),exact:true}).isDisabled(),true);assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).pushNotificationsEnabled,true,'Een niet-beschikbaar toestel verandert bestaande webvoorkeuren niet');}
   if(language==='nl'){await page.screenshot({path:`${out}/native-nl-${view}.png`,fullPage:process.env.NATIVE_GLASS_TEST!=='1'});await webPage.goto(`${backend}/profile?view=${view}`);await webPage.getByRole('heading',{name:t(title),exact:true}).last().waitFor();await renderedImages(webPage);await webPage.screenshot({path:`${out}/web-nl-${view}.png`,fullPage:process.env.NATIVE_GLASS_TEST!=='1'});}
  }
  if(language==='nl'){
   await profileRoot(page);await page.getByRole('button',{name:t('profile.changeHandle'),exact:true}).click();await page.getByRole('textbox',{name:t('profile.changeHandle'),exact:true}).fill('ZichtbaarNieuw');await page.getByRole('button',{name:t('profile.save'),exact:true}).click();await page.locator('[data-profile-page] h2').filter({hasText:'ZichtbaarNieuw'}).waitFor();
   assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).handle,'ZichtbaarNieuw');
   await openView(page,'privacy',t);const toggle=page.getByRole('switch').first();const before=await toggle.isChecked();rejectSave=true;await toggle.locator("xpath=ancestor::label[1]").click();await page.getByText(t('apiErrors.notSaved'),{exact:true}).first().waitFor();assert.equal(await toggle.isChecked(),before,'Mislukte opslag mag geen bevestigde instelling suggereren');rejectSave=false;await toggle.locator("xpath=ancestor::label[1]").click();await page.waitForFunction(before=>document.querySelector('[role="switch"]')?.checked!==before,before);assert.equal(await page.getByRole("alert").count(),0,"Succesvol herstel wist de eerdere opslagfout");
   await openView(page,'twoFactor',t);holdAccount=true;await page.getByRole('button',{name:t('twoFactor.setup'),exact:true}).click();await page.getByLabel(t('twoFactor.step3'),{exact:true}).waitFor();assert.ok(issuedSecret,'Synthetisch setupbewijs is alleen in het testproces beschikbaar');for(let i=0;heldAccounts.length<2&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(heldAccounts.length>=2,"Accountadapter en gedeelde header hebben elk een ouder antwoord vaststaan");holdAccount=false;await page.getByLabel(t('twoFactor.step3'),{exact:true}).fill(generateTotpCode(issuedSecret));await page.getByRole('button',{name:t('twoFactor.confirm'),exact:true}).click();await page.getByRole('button',{name:t('twoFactor.savedSafely'),exact:true}).click();assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).totpEnabled,true);
   await profileRoot(page);await page.getByRole('link',{name:t('profile.changePassword'),exact:true}).click();await page.getByLabel(t('nativeFoundation.code'),{exact:true}).waitFor();releaseAccount();await page.waitForTimeout(100);assert.equal(await page.getByLabel(t('nativeFoundation.code'),{exact:true}).count(),1,'Een oudere accountrefresh mag de bevestigde 2FA-status niet terugzetten');
   await profileRoot(page);await page.getByRole('link',{name:t('profile.changeAvatar'),exact:true}).click();await page.getByRole('button',{name:'Sariah',exact:true}).click();await page.locator('[data-subpage-back-bar] button').click();await page.getByRole('dialog').getByRole('button',{name:t('common.cancel'),exact:true}).click();assert.equal(new URL(page.url()).hash,'#/profile/avatar');await page.getByRole('button',{name:t('profile.save'),exact:true}).click();await page.waitForFunction(()=>location.hash==='#/profile');assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).avatarCharacterId,'sariah');
   // Houd A's echte GET vast; na logout/login mag dit geen gegevens van B overschrijven.
   holdProfile=true;await page.evaluate(()=>window.dispatchEvent(new Event('versado:app-resumed')));
   for(let i=0;held.length===0&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(held.length);holdProfile=false;
   const other=await makeUser('nl');await page.getByRole('button',{name:t('profile.logout'),exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:t('profile.logoutYes'),exact:true}).click();await page.locator('form').waitFor();await login(page,other,t);release();await page.waitForTimeout(100);assert.ok(!(await page.locator('[data-profile-page]').textContent()).includes('ZichtbaarNieuw'));
  }
  await context.close();await web.close();console.log("Profielbrowser gereed:",language);
 }
 assert.deepEqual(errors,[]);assert.deepEqual(missing,[],'Alle profielbeelden zitten in de lokale appbundel');assert.ok(calls.every(call=>call.path.startsWith('/api/v1/native/')),'Geen cookie-web-API vanuit native');
 console.log('Gedeeld profiel: vijf talen, web/native screenshots, 320px/200%, tablet/licht/donker, alle instellingen, echte opslag/foutafhandeling/avatar/logout/accountwisseling, uitsluitend lokale assets. Geen fysieke iOS-acceptatie.');
}catch(error){
 let index=0;for(const context of browser.contexts())for(const page of context.pages())if(!page.isClosed())await page.screenshot({path:`${out}/failure-${index++}.png`,fullPage:process.env.NATIVE_GLASS_TEST!=='1'}).catch(()=>{});
 throw error;
}finally{release();releaseAccount();await browser.close();await new Promise(resolve=>front.close(resolve));await prisma.$disconnect();}
