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
const out='/tmp/versado-native-browser/today-actions';mkdirSync(out,{recursive:true});
const inputs=JSON.parse(readFileSync('dist/native.inputs.json','utf8'));
for(const component of ['TodayView','Greeting','TodaySection','ContinueSection','OpenActions','SocialPreview','SocialView','DiscoverySection','TodayProgramView','StreakContinuationCardView'])assert.ok(inputs.some(f=>f.endsWith(`today/${component}.tsx`)),`${component} ontbreekt in de echte lokale bundel`);
assert.equal(inputs.some(f=>/node_modules\/(?:next|@prisma)\/|src\/lib\/socketClient\.ts|\.server\.ts$/.test(f)),false,'Geen web-cookie/socket/serverruntime');
copyFileSync('dist/native.inputs.json',`${out}/native.inputs.json`);
const osBoundary={name:'native-today-os-events-only',setup(api){api.onLoad({filter:/src\/lib\/platform\.ts$/},args=>{const source=readFileSync(args.path,'utf8'),start=source.indexOf('export async function startNativeFoundationRuntime(');assert.ok(start>0);return{loader:'ts',contents:source.slice(0,start)+`export async function startNativeFoundationRuntime(options){const back=()=>options.onBack(),resume=()=>options.onResume();window.addEventListener('today:test-back',back);window.addEventListener('today:test-resume',resume);return()=>{window.removeEventListener('today:test-back',back);window.removeEventListener('today:test-resume',resume);};}`};});}};
const bundle=await build({plugins:[osBoundary],entryPoints:['tests/fixtures/native-foundation-client.tsx'],bundle:true,write:false,minify:true,platform:'browser',define:{'process.env.NODE_ENV':'"production"'}});
const css=readFileSync('dist/native/index.css'),secrets=new Map(),calls=[],errors=[];
let failOverview=false,failAction=false,holdNext=false,holdAction=false,held=[],heldActions=[],priorChapter;
const front=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/api/v1/native/')){
  const record={method:req.method,path:url.pathname};calls.push(record);
  if(failAction&&url.pathname.includes('/today-actions/')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'native_request_failed'}));return;}
  if(failOverview&&url.pathname.endsWith('/today-overview')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'native_request_failed'}));return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await fetch(`${backend}${req.url}`,{method:req.method,headers:{Origin:'capacitor://localhost','X-Versado-Client':'native-v1','x-real-ip':'127.0.0.61',...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(req.headers['content-type']?{'Content-Type':req.headers['content-type']}:{})},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
  const body=await response.text();if(url.pathname.endsWith('/today-overview')||url.pathname.endsWith('/me')){const value=JSON.parse(body);record.response={status:response.status,language:value.language??value.uiLanguage,error:value.error};}const finish=()=>{if(!res.destroyed){res.writeHead(response.status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);}};
  if(holdAction&&url.pathname.includes('/today-actions/')){holdAction=false;heldActions.push(finish);}else if(holdNext&&url.pathname.endsWith('/today-overview')){holdNext=false;held.push(finish);}else finish();return;
 }
 if(url.pathname.startsWith('/test-keychain/')){if(req.method==='PUT'){const chunks=[];for await(const chunk of req)chunks.push(chunk);secrets.set(url.pathname,Buffer.concat(chunks).toString());}if(req.method==='DELETE')secrets.delete(url.pathname);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({value:secrets.get(url.pathname)??null}));return;}
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(url.pathname==='/index.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
 if(['/native-artwork/','/images/','/icons/','/mascots/','/scripture/'].some(prefix=>url.pathname.startsWith(prefix))&&!url.pathname.includes('..')){res.setHeader('Content-Type',url.pathname.endsWith('.png')?'image/png':url.pathname.endsWith('.svg')?'image/svg+xml':'image/webp');res.end(readFileSync(url.pathname.startsWith('/native-artwork/')?`dist/native${url.pathname}`:`public${url.pathname}`));return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
}catch(error){console.error('Today testproxy:',error.message);res.writeHead(500);res.end();}});
await new Promise(resolve=>front.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${front.address().port}`,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const password='Synthetic-Today-B2-42',collections=[];
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
 const language='nl',t=getT(language),user=await seedAccount(language,collections[0],course.lessons[1]);
 const sender=await seedAccount('nl',collections[0],course.lessons[1]),rejectSender=await seedAccount('nl',collections[0],course.lessons[1]);
 const incoming=await prisma.friendship.create({data:{senderId:sender.id,receiverId:user.id}}),rejected=await prisma.friendship.create({data:{senderId:rejectSender.id,receiverId:user.id}});
 const context=await browser.newContext({viewport:{width:320,height:844},locale:'nl-NL'}),web=await browser.newContext({viewport:{width:320,height:844},locale:'nl-NL'});
 const page=await context.newPage();let sockets=0;page.on('websocket',()=>sockets++);page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${origin}/?device=today-actions&language=nl&accountLanguage=1`);await login(page,user,t);
 await web.addCookies([{name:SESSION_COOKIE,value:await createSessionToken(user.id),url:backend}]);const webPage=await web.newPage();await webPage.goto(`${backend}/dashboard`);await webPage.locator('[data-today-overview]').waitFor();
 const courseBefore=await prisma.userCourseProgress.findUniqueOrThrow({where:{userId_courseId:{userId:user.id,courseId:course.id}}});
 const hide=async()=>{await page.locator('[aria-labelledby="today-continue"] button[aria-haspopup="menu"]').click();await page.getByRole('menuitem',{name:t('today.hideContinue'),exact:true}).evaluate(button=>{button.click();button.click();});};
 const friendRow=(p,name)=>p.locator('[aria-labelledby="today-actions"] li').filter({hasText:name});
 const overflow=async p=>p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
 for(const scale of [1,2]){
  for(const p of [page,webPage]){await p.evaluate(scale=>{document.documentElement.style.fontSize=`${100*scale}%`;window.dispatchEvent(new Event('resize'));},scale);await p.waitForTimeout(100);assert.equal(await overflow(p),false);const buttons=await p.locator('[aria-labelledby="today-actions"] button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect(),clip=button.closest('ul').getBoundingClientRect();return {label:button.textContent,button:{left:r.left,right:r.right,width:r.width},clip:{left:clip.left,right:clip.right},parent:button.parentElement.className,display:getComputedStyle(button.parentElement).display,wrap:getComputedStyle(button.parentElement).flexWrap};}));if(buttons.some(b=>b.button.left<b.clip.left||b.button.right>b.clip.right)){console.error('B2b action clipping',scale,buttons);await p.screenshot({path:`${out}/FAILED-clipping-${scale}.png`,fullPage:true});}assert.equal(buttons.every(b=>b.button.left>=b.clip.left&&b.button.right<=b.clip.right),true,'Friend actions must not be clipped at large text');}
  for(const [kind,p] of [['native',page],['web',webPage]])await p.screenshot({path:`${out}/${kind}-requests-320-${scale}.png`,fullPage:true});
 }
 await page.evaluate(()=>document.documentElement.style.fontSize='100%');
 // Offline writes fail immediately; going online must not replay them.
 await context.setOffline(true);const beforeOffline=calls.filter(c=>c.path.includes('/today-actions/')).length;await hide();await page.getByText(t('today.actionFailed'),{exact:true}).waitFor();assert.equal(await page.locator('.card-title-link').count(),1);
 await context.setOffline(false);await page.waitForTimeout(200);assert.equal(calls.filter(c=>c.path.includes('/today-actions/')).length,beforeOffline);
 // Visible server failure, then an explicit retry. Double DOM clicks still send once.
 failAction=true;await hide();await page.getByText(t('today.actionFailed'),{exact:true}).waitFor();assert.equal(calls.filter(c=>c.path.endsWith('/today-actions/hide')).length,1);assert.equal(await page.locator('.card-title-link').count(),1);
 failAction=false;holdNext=true;await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));
 for(let i=0;held.length===0&&i<100;i++)await page.waitForTimeout(20);assert.equal(held.length,1,'Real old GET captured before the write');
 failOverview=true;await hide();await page.locator('.card-title-link').waitFor({state:'detached'});assert.equal(calls.filter(c=>c.path.endsWith('/today-actions/hide')).length,2);
 for(const finish of held.splice(0))finish();await page.waitForTimeout(150);assert.equal(await page.locator('.card-title-link').count(),0,'Late GET cannot restore a confirmed hide');
 await webPage.reload();assert.equal(await webPage.locator('.card-title-link').count(),0,'Native preference is the real web preference');assert.deepEqual(await prisma.userCourseProgress.findUniqueOrThrow({where:{userId_courseId:{userId:user.id,courseId:course.id}}}),courseBefore);
 failOverview=false;await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));
 // A failed friend action stays actionable; success must survive a failed follow-up GET.
 failAction=true;await friendRow(page,sender.handle).getByRole('button',{name:t('today.cta.accept'),exact:true}).evaluate(b=>{b.click();b.click();});await friendRow(page,sender.handle).getByRole('alert').waitFor();
 assert.equal((await prisma.friendship.findUniqueOrThrow({where:{id:incoming.id}})).status,'PENDING');
 failAction=false;failOverview=true;await friendRow(page,sender.handle).getByRole('button',{name:t('today.cta.accept'),exact:true}).evaluate(b=>{b.click();b.click();});await friendRow(page,sender.handle).waitFor({state:'detached'});
 assert.equal((await prisma.friendship.findUniqueOrThrow({where:{id:incoming.id}})).status,'ACCEPTED');
 await friendRow(page,rejectSender.handle).getByRole('button',{name:t('today.declineAria',{name:rejectSender.handle}),exact:true}).evaluate(b=>{b.click();b.click();});await friendRow(page,rejectSender.handle).waitFor({state:'detached'});assert.equal(await prisma.friendship.count({where:{id:rejected.id}}),0);
 assert.equal(calls.filter(c=>c.path.endsWith('/today-actions/friend-response')).length,3,'One failed accept, one explicit accept retry, one decline');
 failOverview=false;await page.reload();await page.locator('[data-today-overview]').waitFor();assert.equal(await page.locator('.card-title-link').count(),0);assert.equal(await friendRow(page,sender.handle).count(),0);await webPage.reload();assert.equal(await friendRow(webPage,sender.handle).count(),0);assert.equal(await friendRow(webPage,rejectSender.handle).count(),0);
 for(const [kind,p] of [['native',page],['web',webPage]])await p.screenshot({path:`${out}/${kind}-confirmed.png`,fullPage:true});
 // A successful write whose response arrives after switching accounts affects only A.
 const late=await prisma.friendship.create({data:{senderId:rejectSender.id,receiverId:user.id}});await page.evaluate(()=>window.dispatchEvent(new Event('today:test-resume')));await friendRow(page,rejectSender.handle).waitFor();
 holdAction=true;await friendRow(page,rejectSender.handle).getByRole('button',{name:t('today.cta.accept'),exact:true}).click();for(let i=0;heldActions.length===0&&i<100;i++)await page.waitForTimeout(20);assert.equal(heldActions.length,1);
 await page.locator('a[data-kompas-target="profile"]').click();await page.getByRole('button',{name:t('nativeFoundation.logout'),exact:true}).click();await page.locator('form').waitFor();await login(page,sender,t);for(const finish of heldActions.splice(0))finish();await page.waitForTimeout(150);
 assert.ok((await page.locator('[data-today-overview]').textContent()).includes(sender.handle));assert.equal((await page.locator('[data-today-overview]').textContent()).includes(user.handle),false);assert.equal((await prisma.friendship.findUniqueOrThrow({where:{id:late.id}})).status,'ACCEPTED');assert.equal(await page.locator('.card-title-link').count(),1,'B keeps its own course card');
 // Revocation at an actual action is fail-closed and clears the old account UI.
 await prisma.nativeSession.updateMany({where:{userId:sender.id},data:{revokedAt:new Date()}});await hide();await page.locator('form').waitFor();assert.equal(await page.locator('[data-today-overview]').count(),0);
 assert.equal(sockets,0);assert.deepEqual(errors,[]);await context.close();await web.close();
 assert.deepEqual(calls.filter(c=>c.method!=='GET'&&!['login','logout','refresh','hide','friend-response'].some(path=>c.path.endsWith('/'+path))),[],'No progress/reward writes');
 console.log('B2b actions: real native + web, hide/friend failures and manual retry, duplicate taps, offline no replay, confirmed action + failed/stale GET, restart persistence, late A action/B login, revocation, 320px/200%, six paired screenshots. No physical acceptance.');
}finally{for(const finish of [...held.splice(0),...heldActions.splice(0)])finish();await browser.close();await new Promise(resolve=>front.close(resolve));await prisma.contentCollection.deleteMany({where:{id:{in:collections}}});await prisma.$disconnect();}
