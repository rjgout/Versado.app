import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db.ts';
import {hashPassword,createSessionToken,verifySessionToken,verifyPassword} from '../src/lib/auth.ts';
import {startPendingRegistration} from '../src/lib/registration.ts';
import {createAuthToken} from '../src/lib/authTokens.ts';
import {decryptTotpSecret,generateTotpCode} from '../src/lib/totp.ts';
const db=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL)throw Error('Alleen eigen geïsoleerde database');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-browser';rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
// Maak een onveranderlijke asset-snapshot vóór de browser start.
const stylesheet=readFileSync('dist/native/index.css');
const bundle=await build({entryPoints:['tests/fixtures/native-foundation-client.tsx'],bundle:true,write:false,platform:'browser',define:{'process.env.NODE_ENV':'"production"'},minify:true});
const secrets=new Map();let network=true,blockMe=false,completionAttempts=0,failChapterReads=false;const backend=process.env.NATIVE_TEST_BASE_URL;
const front=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname.startsWith('/api/v1/native/')){
   if(url.pathname.endsWith('/complete')&&req.method==='POST')completionAttempts++;
   if(failChapterReads&&req.method==='GET'&&/^\/api\/v1\/native\/chapters\/[^/]+$/.test(url.pathname)){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'network_unavailable'}));return;}
   if(!network||(blockMe&&url.pathname==='/api/v1/native/me')){res.destroy();return;}
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
  if(url.pathname.startsWith('/icons/')||url.pathname.startsWith('/mascots/')||url.pathname.startsWith('/scripture/')){if(url.pathname.includes('..')){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',url.pathname.endsWith('.png')?'image/png':'image/webp');res.end(readFileSync(`public${url.pathname}`));return;}
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
  await context.addInitScript(({scale})=>{window.wp6CompletionAttempts=0;const originalFetch=window.fetch;window.fetch=(input,init)=>{if(typeof input==='string'&&input.includes('/api/v1/native/chapters/')&&input.endsWith('/complete')&&init?.method==='POST')window.wp6CompletionAttempts++;return originalFetch(input,init);};const apply=()=>{document.documentElement.style.fontSize=`${100*scale}%`;for(const [edge,size]of Object.entries({top:24,bottom:18,left:12,right:12}))document.documentElement.style.setProperty(`--safe-area-inset-${edge}`,`${size}px`);};if(document.documentElement)apply();else document.addEventListener('DOMContentLoaded',apply,{once:true});},{scale});
  let page=await context.newPage();const errors=[],failedResponses=[],expectedAuthFailures=[],expectedReadFailures=[];let expectExpired=false;const recordResponse=r=>{if(r.status()>=400){const path=new URL(r.url()).pathname;if(failChapterReads&&r.status()===503&&r.request().method()==='GET'&&/^\/api\/v1\/native\/chapters\/[^/]+$/.test(path)){expectedReadFailures.push(path);return;}if(expectExpired&&r.status()===401&&['/api/v1/native/account/password','/api/v1/native/refresh'].includes(path)){expectedAuthFailures.push(path);return;}failedResponses.push({path,status:r.status()});console.error('Native testresponse:',path,r.status());}};page.on('pageerror',e=>{errors.push(e.message);console.error('Native browserfout:',e.message);});page.on('response',recordResponse);network=false;
  try{
  const device=`${width}-${randomUUID()}`;
  await page.goto(`${origin}/?device=${device}`);await page.getByRole('heading',{level:1}).waitFor();await page.getByRole('alert').waitFor();
  const brand=page.locator('header img[src="/icons/native/versado-flame.png"]');
  await brand.evaluate(image=>image.decode());
  assert.equal(await brand.evaluate(image=>image.naturalWidth),132);
  assert.equal(await page.locator('img[src="/icons/icon-512.png"]').count(),0);
  await page.screenshot({path:`${out}/branding-${width}-${scheme}-${scale}.png`,fullPage:true});
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
   if(width===320){
    const before=await page.evaluate(()=>window.wp6CompletionAttempts),backendBefore=completionAttempts;await context.setOffline(true);
    await page.getByRole('button',{name:'Markeer als gelezen',exact:true}).click();await page.getByRole('alert').waitFor();
    assert.equal(await page.evaluate(()=>window.wp6CompletionAttempts),before+1,'Offline afronding roept de transportfunctie één keer aan');
    assert.equal(completionAttempts,backendBefore,'Offline mutatie bereikt de backend niet');
    assert.equal(await prisma.contentProgress.count({where:{userId:user.id,readStatus:'READ'}}),0,'Geen offline leesafronding');
    assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).xpTotal,0,'Geen offline XP');
    assert.equal(await prisma.streakActivity.count({where:{userId:user.id}}),0,'Geen offline reeksactie');
    const refreshed=page.waitForResponse(response=>response.request().method()==='GET'&&/\/api\/v1\/native\/chapters\/[^/]+$/.test(new URL(response.url()).pathname)&&response.status()===200);
    await context.setOffline(false);await refreshed;
    await page.getByRole('button',{name:'Opnieuw proberen',exact:true}).click({trial:true});
    assert.equal(await page.evaluate(()=>window.wp6CompletionAttempts),before+1,'Onlineherstel herhaalt de mislukte schrijfactie niet');
    assert.equal(completionAttempts,backendBefore,'Hervatten start geen uitgestelde schrijfactie');
    failChapterReads=true;
    const postReceipt=page.waitForResponse(response=>response.request().method()==='POST'&&new URL(response.url()).pathname.endsWith('/complete'));
    await page.getByRole('button',{name:'Markeer als gelezen',exact:true}).click();
    const receipt=await postReceipt;assert.equal(receipt.status(),200);assert.equal((await receipt.json()).content.read,'READ');
    assert.equal(await prisma.contentProgress.count({where:{userId:user.id,readStatus:'READ'}}),1,'De server heeft de afronding daadwerkelijk opgeslagen');
    await page.getByRole('alert').waitFor();
    const confirmed=page.getByRole('button',{name:'Opgeslagen op de server',exact:true});
    assert.equal(await confirmed.count(),1,'Bevestigde POST blijft zichtbaar wanneer de verificatie-GET mislukt');
    assert.equal(await confirmed.isDisabled(),true,'Een mislukte herlaadactie biedt geen nieuwe afronding aan');
    assert.equal(expectedReadFailures.length,1,'Alleen de gerichte verificatie-GET is mislukt');
    failChapterReads=false;
    assert.equal(await page.evaluate(()=>window.wp6CompletionAttempts),before+2,'Alleen een nieuwe bewuste klik verstuurt de volgende mutatie');
    assert.equal(completionAttempts,backendBefore+1,'Eén bevestigde online mutatie bereikt de backend');
   }
   await page.getByRole('button',{name:'Opgeslagen op de server',exact:true}).waitFor();
   assert.equal((await prisma.user.findUniqueOrThrow({where:{id:user.id}})).xpTotal,0);
   await page.reload();await page.getByRole('heading',{name:'Nativeboek 1',exact:true}).waitFor();
   await page.getByRole('button',{name:'Opgeslagen op de server',exact:true}).waitFor();
   assert.match(new URL(page.url()).hash,/^#\/lesson\//,'Heropening herstelt de echte leesroute');
   assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0,'Geen sessiegeheimen in webopslag');
   await page.screenshot({path:`${out}/reader-${width}-${scheme}-${scale}.png`,fullPage:true});
   // Vernietig de WebView; alleen de gesimuleerde beveiligde platformopslag blijft bestaan.
   await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',recordResponse);
   await page.goto(`${origin}/?device=${device}`);await page.getByRole('heading',{name:/Vandaag/}).waitFor();
   await page.getByRole('link',{name:'Profiel',exact:true}).click();
   await page.getByLabel('Wachtwoord',{exact:true}).fill(password);
   await page.getByRole('button',{name:'Uitloggen',exact:true}).click();await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();
   assert.equal(await page.getByLabel('Wachtwoord',{exact:true}).inputValue(),'','Logout bewaart geen herauthenticatiewachtwoord');
   await page.reload();await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();
   // Het welkomstscherm verschijnt direct; wacht ook op bevestigde intrekking na reload.
   await page.getByRole('button',{name:'Opnieuw proberen',exact:true}).click({trial:true});
   assert.equal(secrets.has(`/test-keychain/${device}`),false,'Beveiligde logoutqueue is na serverbevestiging verwijderd');
   const changedPassword='Synthetic-password-changed-42', finalPassword='Synthetic-password-final-42';
   const forced=await prisma.user.create({data:{email:`forced-${randomUUID()}@example.invalid`,handle:`Nativeforced${width}`,discriminator:'01',passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),mustChangePassword:true}});
   const login=async(email,secret)=>{await page.getByLabel('E-mail of gebruikerstag').fill(email);await page.getByLabel('Wachtwoord',{exact:true}).fill(secret);await page.getByRole('button',{name:'Inloggen',exact:true}).click();};
   const change=async(next,current)=>{if(current)await page.getByLabel('Huidig wachtwoord',{exact:true}).fill(current);await page.getByLabel('Nieuw wachtwoord',{exact:true}).fill(next);await page.getByLabel('Bevestig nieuw wachtwoord',{exact:true}).fill(next);await page.getByRole('button',{name:'Wachtwoord opslaan',exact:true}).click();};
   await login(forced.email,password);await page.getByRole('heading',{name:'Wachtwoord wijzigen',exact:true}).waitFor();
   assert.equal(await prisma.nativeSession.count({where:{userId:forced.id}}),0,'Verplichte setup heeft nog geen gewone sessie');
   const setupIntent=JSON.parse(secrets.get(`/test-keychain/${device}`));assert.equal(setupIntent.kind,'setup');assert.equal(setupIntent.logoutPending,true);
   await page.reload();await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();await page.getByRole('button',{name:'Opnieuw proberen',exact:true}).click({trial:true});
   assert.equal(await prisma.nativeAuthChallenge.count({where:{userId:forced.id}}),0,'Heropening trekt het setupbewijs in');
   await login(forced.email,password);await page.getByRole('heading',{name:'Wachtwoord wijzigen',exact:true}).waitFor();blockMe=true;await change(changedPassword);
   await page.getByRole('alert').first().waitFor();blockMe=false;
   await page.getByRole('button',{name:'Opnieuw proberen',exact:true}).click({timeout:3000});
   await page.getByRole('heading',{name:/Vandaag/}).waitFor();
   assert.equal(await prisma.nativeSession.count({where:{userId:forced.id}}),1,'Herstel na uitval van accountdata herhaalt geen afgeronde setup');
   await page.getByRole('link',{name:'Profiel',exact:true}).click();await page.getByRole('link',{name:'Wachtwoord wijzigen',exact:true}).click();
   await page.getByRole('heading',{name:'Wachtwoord wijzigen',exact:true}).waitFor();assert.equal(new URL(page.url()).hash,'#/change-password');
   await change(finalPassword,changedPassword);await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();
   await login(forced.email,finalPassword);await page.getByRole('heading',{name:/Vandaag/}).waitFor();
   await page.getByRole('link',{name:'Profiel',exact:true}).click();await page.getByRole('link',{name:'Wachtwoord wijzigen',exact:true}).click();
   await page.getByLabel('Huidig wachtwoord',{exact:true}).waitFor();await prisma.user.update({where:{id:forced.id},data:{sessionVersion:{increment:1}}});
   expectExpired=true;await change('Synthetic-expired-attempt-42',finalPassword);await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();expectExpired=false;
   assert.equal(expectedAuthFailures.length,2,'Verlopen sessie en refresh zijn geweigerd, zonder herhaling van de wachtwoordmutatie');
   assert.equal(await verifyPassword(finalPassword,(await prisma.user.findUniqueOrThrow({where:{id:forced.id}})).passwordHash),true,'Een verlopen sessie verandert het wachtwoord niet');
   await login(forced.email,finalPassword);await page.getByRole('heading',{name:'Wachtwoord wijzigen',exact:true}).waitFor();
   await page.getByRole('button',{name:'Uitloggen',exact:true}).click();await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();
   const admin=await prisma.user.create({data:{email:`admin-setup-${randomUUID()}@example.invalid`,handle:`Nativesetup${width}`,discriminator:'01',passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),mustChangePassword:true,isAdmin:true}});
   await login(admin.email,password);await page.getByRole('heading',{name:'Wachtwoord wijzigen',exact:true}).waitFor();await change(changedPassword);
   await page.getByRole('heading',{name:'Tweestapsverificatie',exact:true}).waitFor();await page.getByAltText('QR-code voor tweestapsverificatie').waitFor();
   assert.equal(await prisma.nativeSession.count({where:{userId:admin.id}}),0,'Ook na wachtwoordstap blijft de beheerder tot TOTP begrensd');
   const challenge=await prisma.nativeAuthChallenge.findFirstOrThrow({where:{userId:admin.id,intent:'totp'}}),totpSecret=decryptTotpSecret(challenge.totpSecretEncrypted);
   await page.getByText(totpSecret,{exact:true}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'QR en sleutel passen ook bij 200% tekst');
   await page.screenshot({path:`${out}/security-setup-${width}-${scheme}-${scale}.png`,fullPage:true});
   blockMe=true;await page.getByLabel('Vul de 6-cijferige code uit de app hieronder in.').fill(generateTotpCode(totpSecret));await page.getByRole('button',{name:'Bevestigen',exact:true}).click();
   await page.getByRole('button',{name:'Ik heb ze veilig bewaard',exact:true}).waitFor();await page.getByRole('alert').first().waitFor();blockMe=false;assert.equal((await prisma.user.findUniqueOrThrow({where:{id:admin.id}})).totpEnabled,true);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Herstelcodes blijven leesbaar binnen het scherm');
   assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0,'Geen setupgeheim of herstelcodes in browseropslag');
   assert.equal(secrets.get(`/test-keychain/${device}`).includes(totpSecret),false,'TOTP-sleutel staat niet in de platform-intrekkingsqueue');
   await page.getByRole('button',{name:'Ik heb ze veilig bewaard',exact:true}).click();await page.getByRole('button',{name:'Opnieuw proberen',exact:true}).click();await page.getByRole('heading',{name:/Vandaag/}).waitFor();
   assert.equal(await prisma.nativeSession.count({where:{userId:admin.id}}),1,'Dataherstel na TOTP herhaalt de afronding niet');
   await page.getByRole('button',{name:'Uitloggen',exact:true}).click();await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();

   // Bestaande herstelmail wordt lokaal afgehandeld, ook zonder OS-linkassociatie.
   const resetToken=await createAuthToken(forced.id,'PASSWORD_RESET'),resetLink=`${origin}/reset-password?token=${resetToken}`,resetPassword='Synthetic-mail-reset-44';
   await page.getByRole('button',{name:'Wachtwoord vergeten',exact:true}).click();
   await page.getByRole('link',{name:'Resetlink openen',exact:true}).click();
   await page.getByLabel('Resetlink uit je e-mail').fill(`https://evil.invalid/reset-password?token=${resetToken}`);await page.getByRole('button',{name:'Resetlink openen',exact:true}).click();
   await page.getByRole('alert').waitFor();assert.equal(await page.getByLabel('Resetlink uit je e-mail').inputValue(),'','Ongeldige link wordt niet bewaard');
   const openReset=async()=>{await page.getByLabel('Resetlink uit je e-mail').fill(resetLink);await page.getByRole('button',{name:'Resetlink openen',exact:true}).click();await page.getByLabel('Nieuw wachtwoord',{exact:true}).waitFor();};
   await openReset();assert.equal(new URL(page.url()).hash,'#/reset-password');
   assert.equal(await page.evaluate(token=>JSON.stringify(history.state).includes(token),resetToken),false);
   await page.reload();await page.getByLabel('Resetlink uit je e-mail').waitFor();await openReset();
   await page.getByLabel('Nieuw wachtwoord',{exact:true}).fill(resetPassword);await page.getByLabel('Bevestig nieuw wachtwoord',{exact:true}).fill(resetPassword);
   network=false;await page.getByRole('button',{name:'Wachtwoord instellen',exact:true}).click();await page.getByRole('alert').waitFor();network=true;
   await page.getByRole('button',{name:'Wachtwoord instellen',exact:true}).click();await page.getByText('Je wachtwoord is gewijzigd. Log opnieuw in; tweestapsverificatie blijft vereist als die is ingeschakeld.',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.equal([...secrets.values()].some(value=>value.includes(resetToken)),false);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Resetformulier en succesmelding passen bij grote tekst');
   await page.screenshot({path:`${out}/password-reset-${width}-${scheme}-${scale}.png`,fullPage:true});
   await page.getByRole('button',{name:'Terug naar inloggen',exact:true}).click();await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();
   await login(forced.email,resetPassword);await page.getByRole('heading',{name:/Vandaag/}).waitFor();
   await page.getByRole('button',{name:'Uitloggen',exact:true}).click();await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();

   const verifiedEmail=`verify-browser-${randomUUID()}@example.invalid`,verifyToken=await startPendingRegistration({email:verifiedEmail,handle:`Nieuw${width}`,passwordHash:await hashPassword(password),uiLanguage:'nl',contentLanguage:'nl'},backend);
   assert.ok(verifyToken);await page.getByRole('link',{name:'Bevestigingslink openen',exact:true}).click();
   const openConfirmation=async()=>{await page.getByLabel('Bevestigingslink uit je e-mail').fill(`${origin}/verify-email?token=${verifyToken}`);await page.getByRole('button',{name:'Bevestigingslink openen',exact:true}).click();await page.getByRole('button',{name:'Verder →',exact:true}).waitFor();};
   await openConfirmation();assert.equal(await prisma.user.count({where:{email:verifiedEmail}}),0,'Plakken is nog geen bevestiging');
   assert.equal(new URL(page.url()).hash,'#/verify-email');assert.equal(await page.evaluate(token=>JSON.stringify(history.state).includes(token),verifyToken),false);
   await page.reload();await page.getByLabel('Bevestigingslink uit je e-mail').waitFor();await openConfirmation();
   network=false;await page.getByRole('button',{name:'Verder →',exact:true}).click();await page.getByRole('alert').waitFor();network=true;
   await page.getByRole('button',{name:'Verder →',exact:true}).click();await page.getByRole('heading',{name:'Account bevestigd!',exact:true}).waitFor();
   const confirmed=await prisma.user.findUniqueOrThrow({where:{email:verifiedEmail}});assert.ok(confirmed.emailVerifiedAt);assert.equal(await prisma.nativeSession.count({where:{userId:confirmed.id}}),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.equal([...secrets.values()].some(value=>value.includes(verifyToken)),false);
   await page.screenshot({path:`${out}/email-confirmation-${width}-${scheme}-${scale}.png`,fullPage:true});
   await page.getByRole('button',{name:'Log in',exact:true}).click();await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();
   await login(verifiedEmail,password);await page.getByRole('heading',{name:/Vandaag/}).waitFor();await page.getByRole('button',{name:'Uitloggen',exact:true}).click();await page.getByRole('heading',{name:'Welkom bij Versado'}).waitFor();

  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Geen horizontale overflow');assert.deepEqual(errors,[]);assert.deepEqual(failedResponses,[],'Geen ontbrekende stylesheets/assets of geweigerde geldige API-acties');
  await page.screenshot({path:`${out}/welcome-${width}-${scheme}-${scale}-${locale}.png`,fullPage:true});results.push({width,height,scheme,scale,locale,offlineStartup:true,offlineMutationNoReplay:width===320&&locale==='nl-NL',confirmedPostDespiteGetFailure:width===320&&locale==='nl-NL',localLegalRoutes:true,routeReload:true,historyBack:true,systemTheme:true,safeAreaInsets:true,accountSetup:locale==='nl-NL',passwordReset:locale==='nl-NL',emailConfirmation:locale==='nl-NL',overflow:false});
  }catch(error){console.error('Native testscherm:',await page.locator('body').innerText());await page.screenshot({path:`${out}/failure-${width}.png`,fullPage:true});throw error;}finally{await context.close();}
 }
 // Dezelfde geëxtraheerde formulieren/kaarten blijven op de echte Next-site werken.
 const webUser=await prisma.user.create({data:{email:`web-account-${randomUUID()}@example.invalid`,handle:'Webaccount',discriminator:'01',passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),activeContentCollectionId:collection.id}});
 const webCookie=await createSessionToken(webUser.id),webContext=await browser.newContext({viewport:{width:320,height:844},locale:'nl-NL'});
 await webContext.addCookies([{name:'bvm_session',value:webCookie,url:backend,httpOnly:true}]);
 await webContext.addInitScript(()=>{const apply=()=>document.documentElement.style.fontSize='200%';if(document.documentElement)apply();else document.addEventListener('DOMContentLoaded',apply,{once:true});});
 const webPage=await webContext.newPage(),webErrors=[];webPage.on('pageerror',error=>webErrors.push(error.message));
 try{
  await webPage.goto(`${backend}/profile?view=twoFactor`);await webPage.getByRole('button',{name:'2FA instellen',exact:true}).click();
  await webPage.getByAltText('QR-code voor tweestapsverificatie').waitFor();
  assert.equal(await webPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Gedeelde QR-kaart past ook op de echte webpagina bij 200% tekst');
  const userSetup=await prisma.user.findUniqueOrThrow({where:{id:webUser.id}});
  await webPage.getByLabel('Vul de 6-cijferige code uit de app hieronder in.').fill(generateTotpCode(decryptTotpSecret(userSetup.totpSecretEncrypted)));
  await webPage.getByRole('button',{name:'Bevestigen',exact:true}).click();await webPage.getByRole('button',{name:'Ik heb ze veilig bewaard',exact:true}).waitFor();
  assert.equal(await webPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'Gedeelde herstelcodes passen ook op web');
  await webPage.getByRole('button',{name:'Ik heb ze veilig bewaard',exact:true}).click();
  await webPage.goto(`${backend}/change-password`);await webPage.getByLabel('Huidig wachtwoord',{exact:true}).fill(password);
  await webPage.getByLabel('Nieuw wachtwoord',{exact:true}).fill('Synthetic-web-password-43');await webPage.getByLabel('Bevestig nieuw wachtwoord',{exact:true}).fill('Synthetic-web-password-43');
  await webPage.getByRole('button',{name:'Wachtwoord opslaan',exact:true}).click();await webPage.waitForURL(url=>url.pathname==='/dashboard');
  assert.equal(await verifyPassword('Synthetic-web-password-43',(await prisma.user.findUniqueOrThrow({where:{id:webUser.id}})).passwordHash),true);
  assert.equal(await verifySessionToken(webCookie),null);
  // Hetzelfde resetformulier behoudt de bestaande web-TOTP-stap en herstelt na netwerkuitval.
  const webReset=await createAuthToken(webUser.id,'PASSWORD_RESET'),webResetPassword='Synthetic-web-reset-44';
  await webContext.clearCookies();await webPage.goto(`${backend}/reset-password?token=${webReset}`);
  await webPage.getByLabel('Nieuw wachtwoord',{exact:true}).fill(webResetPassword);await webPage.getByLabel('Bevestig nieuw wachtwoord',{exact:true}).fill(webResetPassword);
  await webPage.route('**/api/auth/reset-password',route=>route.abort(),{times:1});await webPage.getByRole('button',{name:'Wachtwoord instellen',exact:true}).click();await webPage.getByRole('alert').waitFor();
  await webPage.getByRole('button',{name:'Wachtwoord instellen',exact:true}).click();await webPage.getByLabel('2FA-code of herstelcode',{exact:true}).waitFor();
  assert.equal((await webContext.cookies()).some(cookie=>cookie.name==='bvm_session'),false,'Reset slaat TOTP niet over');
  await webPage.getByLabel('2FA-code of herstelcode',{exact:true}).fill(generateTotpCode(decryptTotpSecret(userSetup.totpSecretEncrypted)));
  await webPage.getByRole('button',{name:'Wachtwoord instellen',exact:true}).click();await webPage.waitForURL(url=>url.pathname==='/dashboard');
  assert.equal(await verifyPassword(webResetPassword,(await prisma.user.findUniqueOrThrow({where:{id:webUser.id}})).passwordHash),true);assert.deepEqual(webErrors,[]);
  await webPage.goto(`${backend}/verify-email?status=confirmed`);await webPage.getByRole('heading',{name:'Account bevestigd!',exact:true}).waitFor();assert.equal(await webPage.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'De gedeelde bevestigingskaart past op de echte webpagina');
  await webPage.screenshot({path:`${out}/web-account-320-200.png`,fullPage:true});
  writeFileSync(`${out}/web-account-results.json`,JSON.stringify({web:true,width:320,scale:2,sharedQr:true,sharedRecoveryCodes:true,sharedPasswordChange:true,oldSessionRevoked:true},null,2));
  console.log('Gedeelde accountbrowser: web/Next TOTP, herstelcodes en wachtwoordwijziging op 320px/200% geslaagd.');
 }finally{await webContext.close();}
 writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));console.log('Native browserbewijs:',JSON.stringify(results));
}finally{await browser.close();await new Promise(resolve=>front.close(resolve));await prisma.$disconnect();}
