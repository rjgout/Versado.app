// Extra 2E-bewijs tegen dezelfde productiebuild en lokale wegwerpdatabase.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {prisma} from '../src/lib/db.ts';
import {SESSION_COOKIE,createSessionToken} from '../src/lib/auth.ts';
import {DEFAULT_DORP_STATE} from '../src/lib/dorp/storage.ts';
import {DORP_OBJECT_BY_ID} from '../src/lib/dorp/catalog.ts';
const db=new URL(process.env.DORP_TEST_DATABASE_URL??'http://invalid');
if(db.hostname!=='127.0.0.1'||db.pathname!=='/versado_content_access_test'||db.href!==process.env.DATABASE_URL)throw Error('Alleen geïsoleerde testdatabase');
const require=createRequire(import.meta.url),{chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const engine=process.env.DORP_WEBKIT==='1'?webkit:chromium;
const browser=await engine.launch({args:engine===chromium?['--no-sandbox']:[],executablePath:engine===chromium?process.env.CHROMIUM_PATH:undefined});
const base=process.env.DORP_TEST_BASE_URL,output=process.env.DORP_TEST_OUTPUT??'/tmp/versado-dorp-browser';mkdirSync(output,{recursive:true});
const user=await prisma.user.create({data:{email:`iphone-${randomUUID()}@example.invalid`,handle:'iPhonetest',discriminator:'01',passwordHash:'synthetic',isAdmin:true,emailVerifiedAt:new Date()}});
const results=[];
try{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,serviceWorkers:"block"});
 await context.addCookies([{name:SESSION_COOKIE,value:await createSessionToken(user.id),url:base}]);
 const page=await context.newPage();const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/api/dorp'))requests.push({url:r.url(),status:r.status()});});
 async function settled(){await page.locator('canvas[aria-busy="false"]').waitFor();await page.evaluate(async()=>{for(let i=0;i<3;i++)await new Promise(resolve=>requestAnimationFrame(resolve));});}
 await page.goto(`${base}/profile`);await page.getByRole('link',{name:'Mijn dorp',exact:true}).click();
 await page.getByRole('button',{name:'Dorp openen',exact:true}).waitFor();
 assert.equal(await prisma.dorpVillage.count({where:{ownerId:user.id}}),0,'GET en navigatie creëren geen dorp');
 await page.getByRole('button',{name:'Versado Dorp sluiten',exact:true}).click();await page.waitForURL(`${base}/profile`);
 await page.goForward();await page.waitForURL(`${base}/dorp`);await page.getByRole('button',{name:'Dorp openen',exact:true}).click();await settled();
 const snapshot=await prisma.dorpVillage.findUniqueOrThrow({where:{ownerId:user.id}});
 let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/api/dorp'))posts++;});
 await page.reload();await settled();assert.equal(posts,0);assert.deepEqual(await prisma.dorpVillage.findUniqueOrThrow({where:{id:snapshot.id}}),snapshot);
 let recover=false,deniedRequests=0;const recovery=Promise.withResolvers();
 const denied=url=>url.pathname==='/api/dorp'&&url.searchParams.has('villageId');
 await page.route(denied,async route=>{if(!recover){deniedRequests++;return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'Niet beschikbaar'})});}await recovery.promise;await route.continue();});
 await page.reload();try{await page.locator('p[role=alert]').filter({hasText:/^Dit dorp of deze actie is niet beschikbaar\.$/}).waitFor();}catch(error){console.error('Leesfoutfixture',JSON.stringify({deniedRequests,requests,body:await page.locator('body').innerText()}));await page.screenshot({path:`${output}/2e-failed-read-fixture.png`});throw error;}assert.ok(deniedRequests>0);
 await page.evaluate(()=>document.documentElement.style.setProperty('--vs-safe-area-top','47px'));
 const close=await page.getByRole('button',{name:'Versado Dorp sluiten',exact:true}).boundingBox();
 assert.ok(close.y>=47,'Ook bij een leesfout blijft sluiten onder de iPhone-safe-area');
 assert.equal(await page.locator('canvas').count(),0,'Geen oude kaart tijdens een mislukte leesflow');
 await page.screenshot({path:`${output}/2e-read-error-safe-area.png`});
 assert.equal(await page.locator('canvas').count(),0,'Automatische retries verbergen de fout niet achter oude data');
 recover=true;await page.getByRole('button',{name:'Opnieuw laden',exact:true}).click();recovery.resolve();await settled();await page.unroute(denied);assert.equal(posts,0,'Herstel na een leesfout blijft GET-only');
 const hud=await page.locator('summary').filter({hasText:'Kies een dorp'}).boundingBox();assert.ok(hud.height<=48,'Ingeklapte dorpskeuze is één compacte touchrij');
 assert.equal(await page.getByRole('button',{name:'Opnieuw laden',exact:true}).isVisible(),false);
 await page.screenshot({path:`${output}/2e-mobile-hud.png`});
 await page.getByRole('button',{name:'Versado Dorp sluiten',exact:true}).click();await page.waitForURL(`${base}/profile`);
 results.push({profileBack:true,firstCreationExplicit:true,reloadGetOnly:true,readErrorSafeArea:true,compactHud:true});
 // Vaste lokale geometriefixtures; nooit serverposities of eigendom herschrijven.
 await page.goto(`${base}/dev/versado-dorp`);await settled();
 for(const [phase,radius]of [[0,8],[8,35],[16,62]]){
  const state=structuredClone(DEFAULT_DORP_STATE);state.phase=phase;
  state.instances.find(i=>i.objectId==='vd-b001').position={u:-1,v:-1};
  await page.evaluate(state=>localStorage.setItem('versado-dorp-prototype-v3',JSON.stringify(state)),state);await page.reload();await settled();
  await page.locator('summary').filter({hasText:'Weergave'}).click();
  for(const [name,label]of [['Detail','detail'],['Normaal','normal'],['Huidige kaart volledig tonen','map'],['Wereld','world']]){
   await page.getByRole('button',{name,exact:true}).click();await settled();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   await page.screenshot({path:`${output}/2e-r${radius}-${label}.png`});
  }
  results.push({radius,views:4});
 }
 // Werkelijke pinch en pan: brondata blijft gelijk en LOD blijft render-on-demand.
 if(engine===chromium){
  await page.getByRole('button',{name:'Normaal',exact:true}).click();
  await page.locator('summary').filter({hasText:'Weergave'}).click();
  const before=await page.evaluate(()=>localStorage.getItem('versado-dorp-prototype-v3'));
  await page.evaluate(()=>{const ctx=document.querySelector('canvas').getContext('2d'),draw=ctx.drawImage.bind(ctx),fill=ctx.fillRect.bind(ctx);window.dorp2eStats={calls:0,max:0,frames:0};ctx.drawImage=(...args)=>{window.dorp2eStats.calls++;return draw(...args);};ctx.fillRect=(...args)=>{const s=window.dorp2eStats;s.max=Math.max(s.max,s.calls);s.calls=0;s.frames++;return fill(...args);};});
  const cdp=await context.newCDPSession(page),center={x:195,y:422};
  const touches=distance=>[{x:center.x-distance/2,y:center.y},{x:center.x+distance/2,y:center.y}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches(160)});
  for(const distance of [140,120,100,80,60,45,60,80,100,140,180,220,280]){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touches(distance)});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
  await page.mouse.move(30,300);await page.mouse.down();await page.mouse.move(130,350,{steps:10});await page.mouse.up();
  await settled();await page.screenshot({path:`${output}/2e-pinch-pan.png`});
  assert.equal(await page.evaluate(()=>localStorage.getItem('versado-dorp-prototype-v3')),before,'Pinch/pan verplaatst geen opgeslagen object of pad');
  const stats=await page.evaluate(async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>requestAnimationFrame(resolve));const first=window.dorp2eStats.frames;for(let i=0;i<8;i++)await new Promise(resolve=>requestAnimationFrame(resolve));return {...window.dorp2eStats,idle:window.dorp2eStats.frames-first};});
  assert.equal(stats.idle,0);assert.ok(Math.max(stats.max,stats.calls)<1000);
  results.push({pinchPan:true,worldUnchanged:true,maxSpriteDraws:stats.max,idleDraws:stats.idle});
 }
 // Regressie #154: cache bestaat, padding raakt gras maar de viewport niet.
 for(const [phase,radius]of [[0,8],[8,35],[16,62]]){
  const state=structuredClone(DEFAULT_DORP_STATE);state.phase=phase;state.paths=[{u:0,v:0},{u:1,v:0}];
  state.instances.find(i=>i.objectId==='vd-b001').position={u:-1,v:-1};
  await page.evaluate(state=>localStorage.setItem('versado-dorp-prototype-v3',JSON.stringify(state)),state);await page.reload();await settled();
  await page.locator('summary').filter({hasText:'Weergave'}).click();await page.getByRole('button',{name:'Detail',exact:true}).click();await settled();
  await page.locator('summary').filter({hasText:'Weergave'}).click();
  await page.evaluate(()=>{
   const create=document.createElement.bind(document),ctx=document.querySelector('canvas').getContext('2d'),fill=ctx.fillRect.bind(ctx);
   window.terrainEdgeStats={allocations:0,frames:0};
   document.createElement=(name,...options)=>{if(name==='canvas')window.terrainEdgeStats.allocations++;return create(name,...options);};
   ctx.fillRect=(...args)=>{window.terrainEdgeStats.frames++;return fill(...args);};
  });
  let cameraX=0,zoom=1;
  async function panTo(x){
   await page.mouse.move(300,350);await page.mouse.down();await page.mouse.move(300-(x-cameraX)*zoom,350,{steps:2});await page.mouse.up();cameraX=x;
   await settled();assert.deepEqual(errors,[],`Geen rendercrash bij R${radius}, x=${x}, zoom=${zoom}`);
  }
  async function zoomTo(next){
   await page.mouse.move(195,422);await page.mouse.wheel(0,-Math.log(next/zoom)/.001);zoom=next;
   await settled();assert.deepEqual(errors,[],`Geen rendercrash tijdens zoomen bij R${radius}`);
  }
  const right=Math.ceil((radius+4)*64*Math.SQRT2),edge=right+195-64,paddingOnly=right+195+68;
  await panTo(edge);await panTo(paddingOnly); // R8: exact x=1350 uit de review.
  const before=await page.evaluate(()=>window.terrainEdgeStats.allocations);
  for(const offset of [-1,1,-2,2,0])await panTo(paddingOnly+offset);
  assert.equal(await page.evaluate(()=>window.terrainEdgeStats.allocations),before,'Geen nieuwe cache bij padding-only pan');
  await zoomTo(.9);await panTo(paddingOnly+500);await zoomTo(.65);
  await panTo(paddingOnly);await zoomTo(1);await panTo(edge);await panTo(0);
  assert.deepEqual(JSON.parse(await page.evaluate(()=>localStorage.getItem('versado-dorp-prototype-v3'))),state,'Objecten en paden blijven behouden na dorp → rand → bos → dorp');
  const idle=await page.evaluate(async()=>{const before=window.terrainEdgeStats.frames;for(let i=0;i<8;i++)await new Promise(resolve=>requestAnimationFrame(resolve));return window.terrainEdgeStats.frames-before;});
  assert.equal(idle,0,'Geen idle-render na de cacheovergang');
  await page.screenshot({path:`${output}/2e-terrain-cache-return-r${radius}.png`});
  results.push({terrainCacheEdge:true,radius,paddingOnlyX:paddingOnly,zoomDuringTransition:true,stablePaddingCache:true,idleDraws:idle,worldUnchanged:true});
 }
 for(const id of ['vd-b001','vd-b002','vd-b003','vd-p002','vd-p003','vd-p006','vd-c001']){
  const state=structuredClone(DEFAULT_DORP_STATE);state.instances.find(i=>i.objectId===id).position={u:0,v:0};
  await page.evaluate(state=>localStorage.setItem('versado-dorp-prototype-v3',JSON.stringify(state)),state);await page.reload();await settled();
  const box=await page.locator('canvas').boundingBox();await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await page.locator('[data-dorp-selection]').getByRole('heading',{name:DORP_OBJECT_BY_ID.get(id).name,exact:true}).waitFor();
  await page.screenshot({path:`${output}/2e-registration-${id}.png`});
  assert.deepEqual(JSON.parse(await page.evaluate(()=>localStorage.getItem('versado-dorp-prototype-v3'))),state,'Selectie en weergave behouden opgeslagen coördinaten');
 }
 assert.deepEqual(errors,[]);results.push({registeredObjects:7,positionsPreserved:true});await context.close();
 writeFileSync(`${output}/2e-${engine===webkit?'webkit':'chromium'}-results.json`,JSON.stringify(results,null,2));
 console.log('Dorp 2E browserbewijs:',JSON.stringify(results));
}finally{await browser.close();await prisma.$disconnect();}
