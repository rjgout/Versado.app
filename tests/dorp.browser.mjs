import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {openVillage,mutateVillage} from '../src/lib/dorp/service.ts';
import {createGroup} from '../src/lib/social/groups.ts';
import {DORP_OBJECT_BY_ID} from '../src/lib/dorp/catalog.ts';
import {prisma} from '../src/lib/db.ts';
import {placementIsValid,suggestPlacement} from '../src/lib/dorp/geometry.ts';
import {placedObjects} from '../src/lib/dorp/ownership.ts';
import {createSessionToken,SESSION_COOKIE} from '../src/lib/auth.ts';
const url=new URL(process.env.DORP_TEST_DATABASE_URL??'http://invalid');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/versado_content_access_test'||url.href!==process.env.DATABASE_URL)throw Error('Alleen eigen Dorp-testdatabase');
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const base=process.env.DORP_TEST_BASE_URL,output=process.env.DORP_TEST_OUTPUT??'/tmp/versado-dorp-browser';mkdirSync(output,{recursive:true});
const admin=await prisma.user.create({data:{email:`dorp-browser-${randomUUID()}@example.invalid`,handle:'Dorptest',discriminator:'01',passwordHash:'not-a-login-password',isAdmin:true,emailVerifiedAt:new Date()}});
const token=await createSessionToken(admin.id);
const browser=await chromium.launch({args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH});
const results=[];
try{
 for(const [width,height,scale]of [[320,844,1],[390,844,1],[844,390,1],[1280,900,1],[320,844,2]].filter(v=>!process.env.DORP_BROWSER_SERVER_ONLY&&(!process.env.DORP_BROWSER_LARGE_ONLY||v[2]===2)))for(const scheme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height},colorScheme:scheme,hasTouch:width<900,isMobile:width<900});
  await context.addCookies([{name:SESSION_COOKIE,value:token,url:base}]);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/dev/versado-dorp`);await page.locator('canvas[aria-label="Interactieve isometrische dorpskaart"][aria-busy="false"]').waitFor();
  await page.waitForFunction(()=>localStorage.getItem('versado-dorp-prototype-v3'));
  if(scale===2)await page.evaluate(()=>document.documentElement.style.fontSize='200%');
  await page.getByRole('button',{name:'Bouwen',exact:true}).click();
  await page.getByRole('button',{name:/Paden ·/}).click();
  console.log('Dorp browser viewport',width,height,scheme,scale);await page.screenshot({path:`${output}/path-before-${width}-${scheme}-${scale}.png`});
  const canvas=page.locator('canvas'),box=await canvas.boundingBox();
  const before=JSON.parse(await page.evaluate(()=>localStorage.getItem('versado-dorp-prototype-v3')));
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.48);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.48,{steps:10});await page.mouse.up();
  await page.waitForFunction(count=>JSON.parse(localStorage.getItem('versado-dorp-prototype-v3')).paths.length!==count,before.paths.length);
  if(width===390&&scheme==='light'){
   const cdp=await context.newCDPSession(page);
   const start={x:box.x+box.width/2-4*64*.36,y:box.y+box.height/2},end={x:box.x+box.width/2,y:box.y+box.height/2+4*32*.36};
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});
   for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+(end.x-start.x)*i/8,y:start.y+(end.y-start.y)*i/8}]});
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('versado-dorp-prototype-v3')).paths.some(p=>p.u===-2&&p.v===2));
   await cdp.detach();
  }
  await page.screenshot({path:`${output}/path-${width}-${scheme}-${scale}.png`});
  await page.getByRole('button',{name:'Sluiten',exact:true}).last().click();
  await page.getByRole('button',{name:'Bouwen',exact:true}).click();
  await page.getByRole('button',{name:/Nephi/}).click();await page.getByRole('button',{name:'Plaatsen',exact:true}).click();
  await page.screenshot({path:`${output}/resident-${width}-${scheme}-${scale}.png`});
  if(width===390&&scheme==='light'){
   const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('versado-dorp-prototype-v3')));
   const screen=tile=>({x:box.x+box.width/2+(tile.u-tile.v)*64*.36,y:box.y+box.height/2+(tile.u+tile.v)*32*.36});
   async function drag(instanceId,label){
    const current=await state(),object=current.instances.find(i=>i.instanceId===instanceId),all=placedObjects(current);
    const target=suggestPlacement(object.objectId,all,8,{u:object.position.u+3,v:object.position.v},instanceId);
    assert.ok(target);assert.notDeepEqual(target,object.position);
    const from=screen(object.position),to=screen(target);
    await page.mouse.click(from.x,from.y);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});
    await page.screenshot({path:`${output}/drag-${label}.png`});await page.mouse.up();
    await page.waitForFunction(({instanceId,target})=>JSON.stringify(JSON.parse(localStorage.getItem('versado-dorp-prototype-v3')).instances.find(i=>i.instanceId===instanceId).position)===JSON.stringify(target),{instanceId,target});
    return target;
   }
   const resident=(await state()).instances.find(i=>i.objectId==='vd-c001');await drag(resident.instanceId,'resident');
   await page.getByRole('button',{name:'Selectie sluiten',exact:true}).click();
   await drag('fixture-family','building');
   const current=await state(),family=current.instances.find(i=>i.instanceId==='fixture-family'),well=current.instances.find(i=>i.instanceId==='fixture-well');
   assert.equal(placementIsValid({...well.position,instanceId:family.instanceId,objectId:family.objectId},placedObjects(current),8),false);
   const from=screen(family.position),to=screen(well.position);await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();
   assert.deepEqual((await state()).instances.find(i=>i.instanceId===family.instanceId).position,family.position);
   await page.getByRole('button',{name:'Selectie sluiten',exact:true}).click();
   await page.locator('summary').filter({hasText:'Weergave'}).click();await page.getByRole('button',{name:'Maximale toekomstige wereld tonen'}).click();
   await page.screenshot({path:`${output}/world-overview.png`});
   assert.equal((await state()).phase,0);
   await page.getByRole('button',{name:'Testmenu',exact:true}).click();await page.getByRole('button',{name:/Volledige kaart/}).click();await page.getByRole('button',{name:'Testmenu',exact:true}).click();
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('versado-dorp-prototype-v3')).phase===16);
   await page.screenshot({path:`${output}/world-r62.png`});
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);
  results.push({width,height,scheme,scale,paths:true,resident:true,overflow:false});await context.close();
 }
 if(!process.env.DORP_BROWSER_LARGE_ONLY){
 const friend=await prisma.user.create({data:{email:`dorp-friend-${randomUUID()}@example.invalid`,handle:'Dorpvriend',discriminator:'02',passwordHash:'synthetic',isAdmin:true,xpTotal:25,shareVillageWithFriends:true,emailVerifiedAt:new Date()}});
 await prisma.user.update({where:{id:admin.id},data:{xpTotal:50}});
 await prisma.friendship.create({data:{senderId:admin.id,receiverId:friend.id,status:'ACCEPTED'}});
 async function placeFixture(userId,snapshot,kind,position){const object=snapshot.world.instances.find(i=>i.objectId===kind&&snapshot.ownedIds.includes(i.instanceId));assert.ok(object);return mutateVillage(userId,{villageId:snapshot.villageId,expectedVersion:snapshot.version,actionId:randomUUID(),operation:{type:'place',objectId:object.instanceId,position}});}
 let friendWorld=await openVillage(friend.id);friendWorld=await placeFixture(friend.id,friendWorld,'vd-b001',{u:0,v:0});await placeFixture(friend.id,friendWorld,'vd-c003',{u:3,v:0});
 const group=await createGroup(admin.id,'Dorp browsergroep');
 await prisma.groupMembership.create({data:{groupId:group.id,userId:friend.id,eligibleFromDay:'2026-01-01'}});await prisma.socialGroup.update({where:{id:group.id},data:{memberCount:2}});
 let groupWorld=await openVillage(admin.id,group.id);await placeFixture(admin.id,groupWorld,'vd-b001',{u:-3,v:0});
 groupWorld=await openVillage(friend.id,group.id);await placeFixture(friend.id,groupWorld,'vd-b002',{u:2,v:0});
 for(const [width,height]of [[320,844],[390,844],[844,390],[1280,900]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<900,isMobile:width<900});await context.addCookies([{name:SESSION_COOKIE,value:token,url:base}]);const page=await context.newPage();
  if(width===320){
   await page.goto(`${base}/adminbackend/content`);await page.locator('details').filter({has:page.locator('[data-dorp-availability]')}).locator('summary').first().click();await page.locator('[data-dorp-availability]').waitFor();await page.locator('[data-dorp-availability]').screenshot({path:`${output}/admin-availability.png`});
   const beforeSettings=await (await context.request.get(`${base}/api/admin/content-switcher`)).json();
   const ordinary=await prisma.user.create({data:{email:`dorp-ordinary-${randomUUID()}@example.invalid`,handle:'Dorpbezoeker',discriminator:'03',passwordHash:'synthetic',emailVerifiedAt:new Date()}});
   const ordinaryContext=await browser.newContext();await ordinaryContext.addCookies([{name:SESSION_COOKIE,value:await createSessionToken(ordinary.id),url:base}]);
   for(const visible of [false,true,false]){
    const response=await context.request.put(`${base}/api/admin/content-switcher`,{headers:{Origin:base},data:{activity:'dorp',visibleToUsers:visible}});assert.equal(response.status(),200);const settings=await response.json();assert.equal(settings.dorpVisibleToUsers,visible);assert.equal(settings.hymnsVisibleToUsers,beforeSettings.hymnsVisibleToUsers);assert.equal(settings.enabled,beforeSettings.enabled);
    assert.deepEqual(settings.collections.map(c=>[c.id,c.visibleToUsers]),beforeSettings.collections.map(c=>[c.id,c.visibleToUsers]));
    assert.equal((await ordinaryContext.request.get(`${base}/api/dorp`)).status(),visible?200:404);
   }
   assert.equal((await ordinaryContext.request.put(`${base}/api/admin/content-switcher`,{headers:{Origin:base},data:{activity:'dorp',visibleToUsers:true}})).status(),403);await ordinaryContext.close();
   for(const path of ['/dorp',`/dorp/visit/${friend.id}`]){
    const direct=await context.newPage();await direct.goto(`${base}${path}`);
    if(path==='/dorp')await direct.getByRole('button',{name:'Dorp openen',exact:true}).click();
    await direct.locator('canvas[aria-busy="false"]').waitFor();await direct.getByRole('button',{name:'Versado Dorp sluiten',exact:true}).click();
    await direct.waitForURL(`${base}${path==='/dorp'?'/dashboard':`/friends/${friend.id}`}`);await direct.locator('[data-sticky-header]').waitFor({state:'visible'});await direct.waitForLoadState('networkidle');await direct.close();
   }
  }
  await page.goto(`${base}/dorp`);await page.getByRole('button',{name:'Dorp openen',exact:true}).click();await page.locator('canvas[aria-busy="false"]').waitFor();
  if(!await prisma.dorpPlacement.count({where:{village:{ownerId:admin.id}}})){await page.getByRole('button',{name:'Bouwen',exact:true}).click();await page.getByRole('button',{name:new RegExp(DORP_OBJECT_BY_ID.get('vd-b001').name)}).click();await page.getByRole('button',{name:'Plaatsen',exact:true}).click();}
  await page.getByRole('status').filter({hasText:'Opgeslagen'}).waitFor();await page.screenshot({path:`${output}/personal-server-${width}.png`});
  await page.goto(`${base}/dorp/groups/${group.id}`);await page.getByRole('button',{name:'Dorp openen',exact:true}).click();await page.locator('canvas[aria-busy="false"]').waitFor();await page.screenshot({path:`${output}/group-${width}.png`});
  await page.goto(`${base}/friends/${friend.id}`);const preview=page.getByRole('link',{name:'Dorp bezoeken',exact:true});await preview.waitFor();await preview.screenshot({path:`${output}/profile-preview-${width}.png`});await preview.click();await page.waitForURL(`${base}/dorp/visit/${friend.id}`);await page.getByRole('button',{name:'Versado Dorp sluiten',exact:true}).waitFor();await page.locator('canvas[aria-busy="false"]').waitFor();await page.locator('[data-sticky-header]').waitFor({state:'hidden'});await page.locator('[data-main-nav]').waitFor({state:'hidden'});assert.equal(await page.getByRole('button',{name:'Bouwen',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Testmenu',exact:true}).count(),0);
  const visitBox=await page.locator('canvas').boundingBox();assert.ok(Math.abs(visitBox.y)<2);assert.ok(visitBox.height>=height-2);await page.screenshot({path:`${output}/visit-${width}.png`});
  if(width===390){await page.getByRole('button',{name:'Geef 5 XP',exact:true}).click();await page.getByRole('group',{name:'5 XP van je eigen saldo aan deze vriend geven?'}).waitFor();await page.screenshot({path:`${output}/gift-confirm.png`});await page.getByRole('group').getByRole('button',{name:'Geef 5 XP',exact:true}).click();await page.getByRole('status').filter({hasText:'Presentje verstuurd'}).waitFor();await page.screenshot({path:`${output}/gift-received.png`});assert.equal((await prisma.user.findUniqueOrThrow({where:{id:admin.id}})).xpTotal,45);assert.equal((await prisma.user.findUniqueOrThrow({where:{id:friend.id}})).xpTotal,30);}
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  results.push({width,height,server:true,group:true,friendPreview:true,readOnlyVisit:true});await context.close();
 }
 }
 writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));console.log(`Dorp browser: ${results.length} viewport/thema-combinaties geslaagd; ${output}`);
}finally{await browser.close();await prisma.$disconnect();}
