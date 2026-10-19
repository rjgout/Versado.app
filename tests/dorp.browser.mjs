import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {prisma} from '../src/lib/db.ts';
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
 for(const [width,height]of [[320,844],[390,844],[844,390],[1280,900]])for(const scheme of ['light','dark']){
  const context=await browser.newContext({viewport:{width,height},colorScheme:scheme,hasTouch:width<900,isMobile:width<900});
  await context.addCookies([{name:SESSION_COOKIE,value:token,url:base}]);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/dev/versado-dorp`);await page.locator('canvas[aria-label="Interactieve isometrische dorpskaart"]').waitFor();
  await page.waitForFunction(()=>localStorage.getItem('versado-dorp-prototype-v3'));
  await page.getByRole('button',{name:'Bouwen',exact:true}).click();
  await page.getByRole('button',{name:/Paden ·/}).click();
  const canvas=page.locator('canvas'),box=await canvas.boundingBox();
  const before=JSON.parse(await page.evaluate(()=>localStorage.getItem('versado-dorp-prototype-v3')));
  await page.mouse.move(box.x+box.width*.4,box.y+box.height*.48);await page.mouse.down();await page.mouse.move(box.x+box.width*.65,box.y+box.height*.48,{steps:10});await page.mouse.up();
  await page.waitForFunction(count=>JSON.parse(localStorage.getItem('versado-dorp-prototype-v3')).paths.length!==count,before.paths.length);
  await page.screenshot({path:`${output}/path-${width}-${scheme}.png`});
  await page.getByRole('button',{name:'Sluiten',exact:true}).last().click();
  await page.getByRole('button',{name:'Bouwen',exact:true}).click();
  await page.getByRole('button',{name:/Nephi/}).click();await page.getByRole('button',{name:'Plaatsen',exact:true}).click();
  await page.screenshot({path:`${output}/resident-${width}-${scheme}.png`});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);assert.deepEqual(errors,[]);
  results.push({width,height,scheme,paths:true,resident:true,overflow:false});await context.close();
 }
 writeFileSync(`${output}/results.json`,JSON.stringify(results,null,2));console.log(`Dorp browser: ${results.length} viewport/thema-combinaties geslaagd; ${output}`);
}finally{await browser.close();await prisma.$disconnect();}
