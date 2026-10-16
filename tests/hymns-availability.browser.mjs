import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { prisma } from '../src/lib/db.ts';
import { SESSION_COOKIE } from '../src/lib/auth.ts';
import { assertReferenceTestEnvironment } from './fixtures/reference-content.mjs';
const base=assertReferenceTestEnvironment();
const flow=JSON.parse(await fs.readFile(path.join(path.dirname(process.env.CONTENT_MIGRATION_TEST_STATE),'hymns-flow.json'),'utf8'));
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE??'playwright');
const browser=await chromium.launch({args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH});
const output='/tmp/versado-hymns-availability-browser';await fs.mkdir(output,{recursive:true});
const results=[];
const before=await prisma.user.findUniqueOrThrow({where:{id:flow.userId}});
const counts=()=>Promise.all(['contentProgress','readingSession','activityFeedItem','studyPublicationAction'].map(m=>prisma[m].count()));const beforeCounts=await counts();
async function context(token,width,scheme){const c=await browser.newContext({viewport:{width,height:900},colorScheme:scheme,hasTouch:width<500});await c.addCookies([{name:SESSION_COOKIE,value:token,url:base}]);return c;}
try{
 for(const [width,scheme,scale] of [[320,'light',200],[390,'dark',100],[1280,'light',100]]){
  const admin=await context(flow.adminToken,width,scheme), user=await context(flow.userToken,width,scheme);
  const a=await admin.newPage(),u=await user.newPage();
  await a.goto(base+'/adminbackend/content');
  const row=a.locator('[data-hymns-availability]');await row.waitFor({state:'attached'});
  await a.locator('details').filter({has:row}).locator('summary').first().click();
  if(scale===200)await a.addStyleTag({content:'html{font-size:200% !important}'});
  const toggle=row.getByRole('switch');assert.equal(await toggle.isChecked(),false);
  await u.goto(base+'/content');assert.equal(await u.locator('[data-hymns-link]').count(),0);
  await a.goto(base+'/content');assert.equal(await a.locator('[data-hymns-link]').count(),1);
  assert.equal(await a.locator('[data-admin-hymns]').count(),0);
  await a.locator('[data-hymns-link]').click();await a.locator('h1').filter({hasText:'Kies een lofzang'}).waitFor();
  await a.goto(base+'/adminbackend/content');await row.waitFor({state:'attached'});await a.locator('details').filter({has:row}).locator('summary').first().click();
  const saved=a.waitForResponse(r=>r.url().endsWith('/api/admin/content-switcher')&&r.request().method()==='PUT');
  await row.click();const savedResponse=await saved;assert.equal(savedResponse.status(),200);assert.equal((await savedResponse.json()).hymnsVisibleToUsers,true);assert.equal((await prisma.contentSwitcherSettings.findUniqueOrThrow({where:{id:'singleton'}})).hymnsVisibleToUsers,true);await a.waitForFunction(()=>document.querySelector('[data-hymns-availability] input')?.checked===true);
  if(scale===200)await a.addStyleTag({content:'html{font-size:200% !important}'});
  await row.scrollIntoViewIfNeeded();await a.screenshot({path:`${output}/backend-${width}-${scheme}.png`});
  const overflow=await a.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,items:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)}).slice(0,16).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent?.slice(0,90),width:e.getBoundingClientRect().width}))}));assert.equal(overflow.scroll<=overflow.width+1,true,JSON.stringify(overflow));
  await a.reload();await row.waitFor({state:'attached'});await a.locator('details').filter({has:row}).locator('summary').first().click();await a.waitForFunction(()=>document.querySelector('[data-hymns-availability] input')?.checked===true);assert.equal(await toggle.isChecked(),true,'Instelling blijft na herladen behouden');
  await u.reload();const link=u.locator('[data-hymns-link]');await link.waitFor();assert.equal(await link.count(),1);
  if(scale===200)await u.addStyleTag({content:'html{font-size:200% !important}'});
  await link.scrollIntoViewIfNeeded();assert.equal(await u.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await u.screenshot({path:`${output}/picker-${width}-${scheme}.png`});
  // Gewone semantische link en toetsenbord, geen content-context-PUT.
  let selectionWrites=0;u.on('request',r=>{if(r.url().includes('/api/content-context')&&r.method()==='PUT')selectionWrites++;});
  await link.focus();await u.keyboard.press('Enter');await u.waitForURL(base+'/dev/lofzangen');await u.locator('h1').filter({hasText:'Kies een lofzang'}).waitFor();assert.equal(selectionWrites,0);
  const disabled=a.waitForResponse(r=>r.url().endsWith('/api/admin/content-switcher')&&r.request().method()==='PUT');
  await toggle.focus();await a.keyboard.press('Space');assert.equal((await disabled).status(),200);
  assert.equal((await user.request.get(base+'/api/hymns/index')).status(),404);
  await u.goto(base+'/content');assert.equal(await u.locator('[data-hymns-link]').count(),0);
  assert.equal((await u.goto(base+'/dev/lofzangen')).status(),404);
  results.push({width,scheme,text:scale,adminHiddenAccess:true,ordinaryHiddenDenied:true,backendToggle:true,enabledUse:true,selectionUnchanged:true,noOverflow:true});
  await admin.close();await user.close();
 }
 const after=await prisma.user.findUniqueOrThrow({where:{id:flow.userId}});
 for(const field of ['activeContentCollectionId','contentLanguage','activeCourseId','xpTotal','hintBalance','currentStreak'])assert.deepEqual(after[field],before[field]);
 assert.deepEqual(await counts(),beforeCounts);
 console.log(JSON.stringify({hymnsAvailabilityBrowser:'passed',results,noRewards:true}));
}finally{await fs.writeFile(output+'/browser-results.json',JSON.stringify(results,null,2));await browser.close();await prisma.$disconnect();}
