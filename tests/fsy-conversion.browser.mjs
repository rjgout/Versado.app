// Echte Next.js-productiebuild; uitsluitend eigen fixtures en eigen PostgreSQL.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {prisma} from '../src/lib/db.ts';
import {referenceAccount,assertReferenceTestEnvironment} from './fixtures/reference-content.mjs';
import {SESSION_COOKIE} from '../src/lib/auth.ts';
import {getT} from '../src/lib/i18n/index.ts';
const base=assertReferenceTestEnvironment(),require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-fsy-conversion-browser';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH});
const f=await referenceAccount(true), t=getT('nl'),results=[];
const key='fsy-browser-'+randomUUID();
await prisma.contentWork.upsert({where:{key:'fsy'},create:{key:'fsy',kind:'STUDY_PROGRAM'},update:{}});
await prisma.contentCollection.create({data:{id:key,slug:key,name:'Synthetische FSY',icon:'',work:'fsy',editionKey:key,language:'nl',publicationState:'LEGACY',visibleToUsers:true,sourceName:'Testbron',licenseName:'Testtoestemming'}});
try {
 for(const [width,height,scheme,scale] of [[320,844,'light',2],[390,844,'dark',1],[768,1024,'light',1],[1280,900,'dark',1],[844,390,'dark',2]]){
  const slug=randomUUID(),text='Exact bewaarde FSY-tekst '+slug;
  const row=await prisma.fsyLesson.create({data:{contentCollectionId:key,year:2026,month:5,category:'gospel',slug,title:'FSY '+slug,content:JSON.stringify([{type:'paragraph',text}]),images:'[]',sourceUrl:`https://www.churchofjesuschrist.org/study/ftsoy/2026/05/${slug}?lang=nld`,sourceHash:'a'.repeat(64),publishedTitle:'FSY '+slug,publishedContent:JSON.stringify([{type:'paragraph',text}]),publishedImages:'[]',publishedAt:new Date(),status:'PUBLISHED'}});
  const c=await browser.newContext({viewport:{width,height},colorScheme:scheme,hasTouch:width<500,serviceWorkers:'block'});await c.addCookies([{name:SESSION_COOKIE,value:f.token,url:base}]);const page=await c.newPage();
  await page.goto(base+'/fsy/'+row.id);await page.getByText(text,{exact:true}).waitFor();assert.equal(await page.locator('[data-study-block]').count(),0);
  await page.goto(base+'/adminbackend/content');await page.locator('#fsy-management > summary').click();await page.locator('#fsy-management').getByText(row.title,{exact:true}).waitFor();
  if(scale===2)await page.addStyleTag({content:'html{font-size:200% !important}'});
  const card=page.locator('#fsy-management details').filter({hasText:row.title});
  await card.locator('summary').click();
  // Geen alternatieve fixture: echte preflight en mutatie, inclusief native bevestiging.
  const response=page.waitForResponse(r=>r.url().endsWith(`/fsy/${row.id}/conversion`)&&r.request().method()==='POST');
  await card.getByRole('button',{name:t('adminFsy.convert'),exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:t('common.confirm'),exact:true}).click();assert.equal((await response).status(),200);
  await card.getByRole('link',{name:t('adminFsy.sharedManagement'),exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'geen horizontale overflow');
  await page.screenshot({path:`${out}/${width}-${scheme}.png`,fullPage:true});
  await page.goto(base+'/fsy/'+row.id);await page.getByText(text,{exact:true}).waitFor();assert.ok(await page.locator('[data-study-block]').count()>0,'oude URL gebruikt gedeelde reader');
  await page.reload();await page.getByText(text,{exact:true}).waitFor();
  results.push({width,height,scheme,scale,legacyRoute:true,explicitHandover:true,sharedReader:true,overflow:false});await c.close();
 }
 console.log(JSON.stringify({fsyConversionBrowser:results}));writeFileSync(out+'/results.json',JSON.stringify(results,null,2));
} finally {await browser.close();await prisma.$disconnect();}
