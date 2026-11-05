// Echte Foundation + bestaande authroutes in een eigen wegwerpdatabase.
// Alleen platformdetectie en capability-aanbod zijn testvarianten; geen Apple-providerclaim.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {prisma} from '../src/lib/db.ts';
import {hashPassword} from '../src/lib/auth.ts';
import {generateTotpSecret,encryptTotpSecret,generateTotpCode} from '../src/lib/totp.ts';
import {issueNativeSession} from '../src/lib/native/sessions.ts';
import {getT} from '../src/lib/i18n/index.ts';
const database=new URL(process.env.NATIVE_TEST_DATABASE_URL??'http://invalid');
if(database.hostname!=='127.0.0.1'||database.pathname!=='/versado_content_access_test'||database.href!==process.env.DATABASE_URL)throw Error('Alleen eigen geïsoleerde database');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-browser/apple-ui';mkdirSync(out,{recursive:true});
const bundles={};
for(const platform of ['ios','android']){
 const result=await build({entryPoints:['tests/fixtures/native-foundation-client.tsx'],bundle:true,write:false,platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'test-only-apple-platform',setup(api){api.onLoad({filter:/src\/lib\/platform\.ts$/},()=>({contents:readFileSync('src/lib/platform.ts','utf8').replace('return appPlatform() === "ios";',`return ${platform==='ios'};`),loader:'ts'}));}}]});
 bundles[platform]=result.outputFiles[0].text;
}
const backend=process.env.NATIVE_TEST_BASE_URL,stylesheet=readFileSync('dist/native/index.css'),sessions=new Map(),calls=[];
const cases=new Map();
const front=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1'),id=url.searchParams.get('device')??(req.headers.referer?new URL(req.headers.referer).searchParams.get('device'):null),scenario=cases.get(id);
 if(url.pathname.startsWith('/api/v1/native/')){
  assert.ok(scenario);calls.push({method:req.method,path:url.pathname});
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await fetch(`${backend}${req.url}`,{method:req.method,headers:{Origin:'capacitor://localhost','X-Versado-Client':'native-v1','x-real-ip':'127.0.0.51',...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  let body=await response.text();
  if(url.pathname==='/api/v1/native/capabilities'&&response.ok){const value=JSON.parse(body);value.apple=scenario.capable;value.features=value.features.filter(feature=>feature!=='apple-sign-in-ui-v1');if(scenario.released)value.features.push('apple-sign-in-ui-v1');body=JSON.stringify(value);}
  res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);return;
 }
 if(url.pathname.startsWith('/test-keychain/')){const key=url.pathname.slice('/test-keychain/'.length);if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);sessions.set(key,Buffer.concat(chunks).toString());}if(req.method==='DELETE')sessions.delete(key);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:sessions.get(key)??null}));return;}
 if(url.pathname==='/app.js'){assert.ok(scenario);res.setHeader('Content-Type','text/javascript');res.end(bundles[scenario.platform]);return;}
 if(url.pathname==='/index.css'){res.setHeader('Content-Type','text/css');res.end(stylesheet);return;}
 if(['/icons/','/mascots/','/scripture/'].some(prefix=>url.pathname.startsWith(prefix))&&!url.pathname.includes('..')){res.setHeader('Content-Type',url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.svg')?'image/svg+xml':'image/webp');res.end(readFileSync(`public${url.pathname}`));return;}
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js?device=${encodeURIComponent(id)}"></script></body></html>`);
}catch{res.writeHead(500);res.end();}});
await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${front.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const password='Synthetic-apple-ui-42',errors=[];
const userData=async(extra={})=>({email:`apple-ui-${randomUUID()}@example.invalid`,handle:`Apple${randomUUID().replaceAll('-','').slice(0,12)}`,discriminator:'01',passwordHash:await hashPassword(password),emailVerifiedAt:new Date(),onboardingSeenAt:new Date(),...extra});
const profile=page=>page.locator('a[data-kompas-target="profile"]');
async function login(page,user,t,secret){
 await page.getByLabel(t('nativeFoundation.email')).fill(user.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);
 if(secret)await page.getByLabel(t('nativeFoundation.code')).fill(generateTotpCode(secret));
 await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await profile(page).waitFor();
}
async function open(scenario,language='nl',saved){
 const device=randomUUID();cases.set(device,scenario);if(saved)sessions.set(device,saved);
 const context=await browser.newContext({viewport:{width:320,height:844},locale:language});const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${origin}/?device=${device}`);
 if(!saved)await page.getByRole('button',{name:getT(language)('nativeFoundation.login'),exact:true}).waitFor({state:'visible'});
 return {page,context};
}
async function expectApple(page,t,available){
 assert.equal(await page.getByRole('button',{name:t('nativeFoundation.apple'),exact:true}).count(),Number(available));
 assert.equal(await page.getByText(t('nativeFoundation.appleResetHelp'),{exact:true}).count(),Number(available));
 assert.equal(await page.getByText(t('nativeFoundation.appleUnavailable'),{exact:true}).count(),0,'Geen misleidende configuratiestatus');
}
try{
 const user=await prisma.user.create({data:await userData()});
 // Ook een ingerichte Apple-server zonder UI-vrijgave blijft volledig uitgesteld, in alle talen.
 for(const language of ['nl','en','de','fr','es']){
  const t=getT(language),{page,context}=await open({platform:'ios',capable:true,released:false},language);
  await page.waitForFunction(()=>!document.querySelector('form button[type="submit"]')?.disabled);await expectApple(page,t,false);
  await page.getByRole('button',{name:t('nativeFoundation.forgot'),exact:true}).click();await expectApple(page,t,false);
  await page.locator('a[href="#/reset-password"]').click();await page.getByLabel(t('password.resetLinkLabel')).waitFor();
  assert.equal(await page.getByText(t('nativeFoundation.appleResetHelp'),{exact:true}).count(),0);
  await page.locator('a[href="#/login"]').click();await login(page,user,t);await profile(page).click();
  await expectApple(page,t,false);
  assert.equal(await page.getByRole('button',{name:t('nativeFoundation.appleLink'),exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:t('nativeFoundation.appleUnlink'),exact:true}).count(),0);
  assert.equal(await page.getByLabel(t('nativeFoundation.password'),{exact:true}).count(),0,'Geen ongebruikte Apple-wachtwoordvelden');
  await page.screenshot({path:`${out}/disabled-profile-${language}.png`,fullPage:true});
  await page.getByRole('button',{name:t('nativeFoundation.logout'),exact:true}).click();await expectApple(page,t,false);
  await login(page,user,t);await context.close();
 }
 // Beide poorten en iOS zijn noodzakelijk: geen knop of hersteladvies bij slechts één signaal/Android.
 for(const scenario of [{platform:'ios',capable:false,released:false},{platform:'ios',capable:false,released:true},{platform:'android',capable:true,released:true},{platform:'ios',capable:true,released:true}]){
  const t=getT('nl'),{page,context}=await open(scenario),available=scenario.platform==='ios'&&scenario.capable&&scenario.released;
  await page.waitForFunction(()=>!document.querySelector('form button[type="submit"]')?.disabled);
  await expectApple(page,t,available);
  await page.getByRole('button',{name:t('nativeFoundation.forgot'),exact:true}).click();await expectApple(page,t,available);
  await page.getByRole('button',{name:t('nativeFoundation.register'),exact:true}).click();await expectApple(page,t,available);
  await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();await login(page,user,t);await profile(page).click();
  assert.equal(await page.getByRole('button',{name:t('nativeFoundation.appleLink'),exact:true}).count(),Number(available));
  assert.equal(await page.getByText(t('nativeFoundation.appleLinked'),{exact:true}).count(),0);
  assert.equal(await page.getByText(t('nativeFoundation.appleUnavailable'),{exact:true}).count(),0);
  await context.close();
 }
 // Bestaande koppeling blijft ook zonder Apple-aanbod op dit toestel te beheren, met echte 2FA/proof.
 const secret=generateTotpSecret(),linked=await prisma.user.create({data:await userData({totpEnabled:true,totpSecretEncrypted:encryptTotpSecret(secret)})});
 await prisma.externalIdentity.create({data:{userId:linked.id,provider:'APPLE',scope:'TESTTEAM01',subject:randomUUID()}});
 const t=getT('nl'),{page,context}=await open({platform:'ios',capable:false,released:false});
 await page.getByLabel(t('nativeFoundation.email')).fill(linked.email);await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await page.getByRole('button',{name:t('nativeFoundation.login'),exact:true}).click();
 await page.getByText(t('nativeFoundation.twoFactorRequired'),{exact:true}).waitFor();assert.equal(await profile(page).count(),0);
 await login(page,linked,t,secret);await profile(page).click();
 await page.getByText(t('nativeFoundation.appleLinked'),{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:t('nativeFoundation.appleLink'),exact:true}).count(),0);
 const unlink=page.getByRole('button',{name:t('nativeFoundation.appleUnlink'),exact:true});assert.equal(await unlink.isDisabled(),true);
 await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);await unlink.click();await page.getByRole('alert').waitFor();
 assert.equal(await prisma.externalIdentity.count({where:{userId:linked.id}}),1,'Ontkoppelen zonder 2FA wordt server-side geweigerd');
 await page.getByRole('button',{name:t('nativeFoundation.logout'),exact:true}).click();await page.locator('form').waitFor();
 assert.equal(await page.getByLabel(t('nativeFoundation.password'),{exact:true}).inputValue(),'','Logout wist ook ingevulde Apple-herauthenticatie');
 await login(page,linked,t,secret);await profile(page).click();await page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);
 await page.getByLabel(t('nativeFoundation.code')).fill(generateTotpCode(secret));await unlink.click();await page.locator('form').waitFor();
 assert.equal(await prisma.externalIdentity.count({where:{userId:linked.id}}),0);await expectApple(page,t,false);
 await login(page,user,t);await profile(page).click();assert.equal(await page.getByText(t('nativeFoundation.appleLinked'),{exact:true}).count(),0,'Accountwisseling neemt geen Apple-status over');
 assert.equal(await page.getByRole('button',{name:t('nativeFoundation.appleUnlink'),exact:true}).count(),0);await context.close();
 // Apple-only: herstelbare bestaande sessie; UI mag de laatste inlogmethode nooit ontkoppelen.
 const only=await prisma.user.create({data:await userData({passwordLoginEnabled:false})});
 await prisma.externalIdentity.create({data:{userId:only.id,provider:'APPLE',scope:'TESTTEAM01',subject:randomUUID()}});
 const pair=await issueNativeSession(only.id,only.sessionVersion),saved=JSON.stringify({refreshToken:pair.refreshToken});
 const account=await open({platform:'android',capable:false,released:false},'nl',saved);
 await profile(account.page).waitFor();await profile(account.page).click();await account.page.getByText(t('nativeFoundation.appleLinked'),{exact:true}).waitFor();
 await account.page.getByLabel(t('nativeFoundation.password'),{exact:true}).fill(password);
 assert.equal(await account.page.getByRole('button',{name:t('nativeFoundation.appleUnlink'),exact:true}).isDisabled(),true);
 await account.page.getByText(t('nativeFoundation.alternativeRequired'),{exact:true}).waitFor();await account.context.close();
 assert.deepEqual(errors,[]);assert.ok(calls.every(call=>!call.path.endsWith('/apple/challenge')&&!call.path.endsWith('/apple/complete')),'Weergave start geen Apple-authenticatie');
 console.log('Apple-UI: vijf talen zonder vrijgave; login/herstel/registratie/profiel; expliciete vrijgave en platformgrens; bestaande koppeling/echte TOTP-ontkoppeling; Apple-only beschermd; logout/herlogin/accountwisseling geslaagd. Geen fysieke Apple-provideracceptatie.');
}finally{await browser.close();await new Promise(resolve=>front.close(resolve));await prisma.$disconnect();}
