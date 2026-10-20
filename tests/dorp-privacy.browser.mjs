import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db.ts';
import {openVillage,mutateVillage} from '../src/lib/dorp/service.ts';
import {getT} from '../src/lib/i18n/index.ts';
import {weekStartKey} from '../src/lib/dates.ts';
import {SESSION_COOKIE,createSessionToken} from '../src/lib/auth.ts';
const database=new URL(process.env.DORP_TEST_DATABASE_URL??'http://invalid');
if(database.hostname!=='127.0.0.1'||database.pathname!=='/versado_content_access_test'||database.href!==process.env.DATABASE_URL)throw Error('Alleen eigen Dorp-testdatabase');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.DORP_TEST_BASE_URL,output=process.env.DORP_TEST_OUTPUT??'/tmp/versado-dorp-browser';mkdirSync(output,{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH});
async function account(isAdmin){const uid=randomUUID();return prisma.user.create({data:{email:`privacy-${uid}@example.invalid`,handle:`Privacy${uid.slice(0,5)}`,discriminator:'01',isAdmin,passwordHash:'synthetic',emailVerifiedAt:new Date(),shareVillageWithFriends:true}});}
async function contextFor(user,options={}){const context=await browser.newContext(options);await context.addCookies([{name:SESSION_COOKIE,value:await createSessionToken(user.id),url:base}]);return context;}
const results=[];
try{
 const owner=await account(true),viewer=await account(false);
 await prisma.contentSwitcherSettings.upsert({where:{id:'singleton'},create:{dorpVisibleToUsers:true},update:{dorpVisibleToUsers:true}});
 let friendship=await prisma.friendship.create({data:{senderId:owner.id,receiverId:viewer.id,status:'ACCEPTED'}});
 const world=await openVillage(owner.id),object=world.world.instances.find(i=>i.objectId==='vd-c001');
 await mutateVillage(owner.id,{villageId:world.villageId,expectedVersion:world.version,actionId:randomUUID(),operation:{type:'place',objectId:object.instanceId,position:{u:0,v:0}}});
 const ownerContext=await contextFor(owner),previewContext=await contextFor(viewer,{viewport:{width:390,height:844}}),visitContext=await contextFor(viewer,{viewport:{width:1280,height:900}}),mapContext=await contextFor(viewer,{viewport:{width:390,height:844}});
 const preview=await previewContext.newPage(),visit=await visitContext.newPage(),map=await mapContext.newPage(),frames=[];
 for(const page of [preview,visit,map])page.on('websocket',socket=>socket.on('framereceived',event=>frames.push({page:page===preview?'preview':'visit',payload:String(event.payload)})));
 await preview.goto(`${base}/friends/${owner.id}`);await visit.goto(`${base}/dorp/visit/${owner.id}`);
 const previewCard=preview.getByRole('link',{name:'Dorp bezoeken',exact:true});
 const canvas=visit.locator('canvas[aria-busy="false"]');
 await previewCard.waitFor();await canvas.waitFor();
 await map.goto(`${base}/profile`);await map.getByRole('link',{name:'Mijn dorp',exact:true}).waitFor();await map.getByRole('link',{name:'Mijn dorp',exact:true}).click();
 await map.getByRole('button',{name:'Dorp openen',exact:true}).click();await map.locator('canvas[aria-busy="false"]').waitFor();
 await map.locator('summary').filter({hasText:'Weergave'}).click();await map.getByRole('button',{name:'Maximale toekomstige wereld tonen'}).click();
 const marker=map.locator('[data-dorp-friend-marker]');await marker.waitFor();assert.equal(await marker.getAttribute('href'),`/dorp/visit/${owner.id}`);
 await map.screenshot({path:`${output}/friend-world-390.png`});
 const markerResponse=await previewContext.request.get(`${base}/api/dorp?markers=friends`);assert.equal(markerResponse.status(),200);assert.match(markerResponse.headers()['cache-control'],/no-store/);
 assert.deepEqual(await markerResponse.json(),{markers:[{ownerId:owner.id,label:owner.handle}]});

 async function ownerPrivacy(value){const response=await ownerContext.request.patch(`${base}/api/account`,{headers:{Origin:base},data:{shareVillageWithFriends:value}});assert.equal(response.status(),200);}
 async function hidden(){await marker.waitFor({state:"hidden"});await previewCard.waitFor({state:'hidden'});await visit.locator('p[role="alert"]').filter({hasText:/^Dit dorp of deze actie is niet beschikbaar\.$/}).waitFor();assert.equal(await visit.locator('canvas').count(),0);}
 async function shown(){await marker.waitFor();await previewCard.waitFor();await canvas.waitFor();}
 // Actieve HTTP-aanvraag bevat nog de oude toegestane wereld; de response wordt bewust vertraagd.
 let intercepted;const ready=Promise.withResolvers(),release=Promise.withResolvers();let once=true;
 await visit.route('**/api/dorp?ownerId=*',async route=>{if(!once)return route.continue();once=false;intercepted=await route.fetch();assert.equal(intercepted.status(),200);ready.resolve();await release.promise;await route.fulfill({response:intercepted});});
 await visit.evaluate(()=>window.dispatchEvent(new Event('focus')));await ready.promise;
 const before=frames.length;await ownerPrivacy(false);release.resolve();
 await hidden();assert.ok(frames.slice(before).some(f=>f.payload.includes('dorpAccessChanged')),'Echt realtime-signaal tussen twee sessies');
 await visit.unroute('**/api/dorp?ownerId=*');await visit.screenshot({path:`${output}/privacy-revoked.png`});
 assert.equal((await visitContext.request.get(`${base}/api/dorp?ownerId=${owner.id}`)).status(),404);
 await ownerPrivacy(true);await shown();
 // Ontvrienden: beide reeds geopende weergaven verliezen toegang zonder handmatig verversen.
 const removed=await ownerContext.request.delete(`${base}/api/friends/${friendship.id}`,{headers:{Origin:base}});assert.equal(removed.status(),200);await hidden();
 friendship=await prisma.friendship.create({data:{senderId:owner.id,receiverId:viewer.id,status:'ACCEPTED'}});await ownerPrivacy(true);await shown();
 // Backend-noodstop voor gewone gebruikers; admins blijven technisch beschikbare alpha testen.
 const disabled=await ownerContext.request.put(`${base}/api/admin/content-switcher`,{headers:{Origin:base},data:{activity:'dorp',visibleToUsers:false}});assert.equal(disabled.status(),200);await hidden();
 assert.ok(frames.some(f=>f.page==='preview'&&f.payload.includes('dorpAccessChanged')));assert.ok(frames.some(f=>f.page==='visit'&&f.payload.includes('dorpAccessChanged')));
 await ownerContext.request.put(`${base}/api/admin/content-switcher`,{headers:{Origin:base},data:{activity:'dorp',visibleToUsers:true}});await shown();
 await previewContext.setOffline(true);await visitContext.setOffline(true);await mapContext.setOffline(true);
 await previewCard.waitFor({state:'hidden'});await visit.locator('canvas').waitFor({state:'hidden'});await marker.waitFor({state:'hidden'});
 await previewContext.setOffline(false);await visitContext.setOffline(false);await mapContext.setOffline(false);await shown();
 results.push({twoConcurrentSessions:true,privacyRevoked:true,unfriend:true,featureDisabled:true,lateResponseDiscarded:true,realtimeSignals:true,offlineHidesCache:true,worldMarkers:true,profileEntry:true});

 await marker.focus();await marker.press('Enter');await map.waitForURL(`${base}/dorp/visit/${owner.id}`);
 await map.locator('canvas[aria-busy="false"]').waitFor();assert.equal(await map.getByRole('button',{name:'Bouwen',exact:true}).count(),0);
 await map.locator('summary').filter({hasText:'Weergave'}).click();await map.getByRole('button',{name:'Detail',exact:true}).click();
 await map.screenshot({path:`${output}/friend-marker-visit-detail.png`});
 await ownerContext.close();await previewContext.close();await visitContext.close();await mapContext.close();
 // De nieuwe XP-begrippen worden op echte pagina's en in alle vijf UI-talen gecontroleerd.
 await prisma.user.update({where:{id:viewer.id},data:{xpTotal:50}});
 await prisma.xPTransaction.createMany({data:[{userId:viewer.id,amount:12,reason:'ACHIEVEMENT'},{userId:viewer.id,amount:5,reason:'VILLAGE_GIFT_RECEIVED'},{userId:viewer.id,amount:-5,reason:'VILLAGE_GIFT_SENT'}]});
 await prisma.weeklyScore.create({data:{userId:viewer.id,weekStart:weekStartKey(),xp:7}});
 for(const [language,width,scale]of [['nl',320,2],['en',390,1],['de',1280,1],['fr',390,1],['es',320,2]])for(const theme of ['light','dark']){
  await prisma.user.update({where:{id:viewer.id},data:{uiLanguage:language}});
  const context=await contextFor(viewer,{viewport:{width,height:900},colorScheme:theme}),page=await context.newPage();
  await page.goto(`${base}/xp`);await page.locator('[data-xp-summary]').waitFor();if(scale===2)await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  const t=getT(language);
  await page.getByText(t('xpHistory.thisWeek',{xp:12}),{exact:true}).waitFor();
  for(const [key,xp] of [['receivedThisWeek',5],['sentThisWeek',5],['competitionThisWeek',7]])await page.getByText(t(`xpHistory.${key}`,{xp}),{exact:true}).waitFor();
  await page.getByText(t('xpHistory.collected'),{exact:true}).waitFor();
  assert.equal(await page.locator('[data-xp-summary] p').count(),3);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.locator('[data-xp-summary]').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${output}/xp-${language}-${theme}-${width}.png`});results.push({language,width,scale,theme,xpSummary:true});await context.close();
 }
 writeFileSync(`${output}/privacy-results.json`,JSON.stringify(results,null,2));console.log(`Dorp privacy/XP browser: ${results.length} flows geslaagd`);
}finally{await browser.close();await prisma.$disconnect();}
