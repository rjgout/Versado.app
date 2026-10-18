import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {prisma} from '../src/lib/db.ts';
import {referenceAccount,assertReferenceTestEnvironment} from './fixtures/reference-content.mjs';
import {appendStudyRevision} from '../src/lib/studyContent/revisions.ts';
import {getT} from '../src/lib/i18n/index.ts';
import {setStudyContext} from '../src/lib/studyContext.ts';
import {SESSION_COOKIE} from '../src/lib/auth.ts';
const base=assertReferenceTestEnvironment(),require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-program-browser';mkdirSync(out,{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox'],executablePath:process.env.CHROMIUM_PATH}),results=[];
try{for(const [width,scheme,language,scale] of [[320,'light','nl',2],[390,'dark','de',1],[768,'light','fr',1],[1280,'dark','en',1],[844,'dark','es',2]]){
 const f=await referenceAccount(false,language),admin=await referenceAccount(true),key='program-browser-'+randomUUID(),t=getT(language);
 await prisma.user.update({where:{id:f.user.id},data:{onboardingSeenAt:new Date(),onboardingProfilePrivacyAt:new Date(),avatarCharacterId:'nephi',emailVerifiedAt:new Date(),kompasOffersEnabled:false}});
 await prisma.contentWork.create({data:{key,kind:'STUDY_PROGRAM'}});await prisma.contentCollection.create({data:{id:key,slug:key,name:'Synthetisch studieprogramma',work:key,editionKey:key,language:'nl',publicationState:'PUBLISHED',visibleToUsers:true,icon:''}});
 const p=await prisma.studyPeriod.create({data:{workKey:key,sourceKey:'2026',year:2026,label:'2026'}});
 const lesson=await prisma.studyLesson.create({data:{workKey:key,periodId:p.id,sourceKey:'official-lesson',order:1}}),edition=await prisma.studyLessonEdition.create({data:{lessonId:lesson.id,collectionId:key,workKey:key,slug:'official-lesson'}});
 const r=await appendStudyRevision(admin.actor,edition.id,{schemaVersion:1,title:'Een gepubliceerde les met een langere titel',body:{schemaVersion:1,sections:[{id:'intro',blocks:[{id:'paragraph',type:'paragraph',content:[{type:'text',text:'Echte synthetische lestekst voor navigatie.'}]}]}]},sourceMetadata:{sourceKey:'official-lesson'},rightsMetadata:{holder:'Testbron',permission:'Testgebruik'}});
 await prisma.studyLessonEdition.update({where:{id:edition.id},data:{publishedRevisionId:r.id}});await prisma.user.update({where:{id:f.user.id},data:{activeContentCollectionId:key,contentLanguage:'nl'}});
 const c=await browser.newContext({viewport:{width,height:width===844?390:844},colorScheme:scheme,hasTouch:width<500,serviceWorkers:'block'});await c.addCookies([{name:SESSION_COOKIE,value:f.token,url:base}]);const page=await c.newPage();
 await page.goto(base+'/courses');await page.locator('[data-program-lesson]').waitFor();await page.getByText(t('programPicker.availableCount',{count:1}),{exact:true}).waitFor();assert.equal(await page.locator('[data-program-lesson][aria-pressed=true]').count(),0,'geen impliciete lesselectie');if(scale===2)await page.addStyleTag({content:'html{font-size:200% !important}'});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.screenshot({path:`${out}/${width}-${language}.png`,fullPage:true});
 const overflow=await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).filter(e=>e.getBoundingClientRect().right>innerWidth+1&&e.getBoundingClientRect().width>0).slice(0,8).map(e=>({tag:e.tagName,cls:e.className,text:e.textContent?.slice(0,70),right:e.getBoundingClientRect().right})));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),JSON.stringify(overflow));
 const sent=[];
 if(width===320)await page.route('**/api/study-context',async route=>{if(route.request().method()!=='PUT')return route.continue();sent.push(route.request().postDataJSON());if(sent.length===1)return route.abort('failed');return route.continue();});
 if(width===390)await setStudyContext(f.actor,{workKey:key,activeLessonKey:'study:'+lesson.id,expectedVersion:0,actionId:randomUUID()});
 await page.locator('[data-program-lesson]').focus();await page.keyboard.press('Enter');
 if(width===320){await page.locator('[data-program-context]').getByRole('alert').waitFor();assert.equal(await page.locator('[data-program-lesson][aria-pressed=true]').count(),0);await page.getByRole('button',{name:t('programPicker.retry'),exact:true}).click();}
 if(width===390){await page.locator('[data-program-context]').getByRole('alert').waitFor();await page.getByRole('button',{name:t('programPicker.reload'),exact:true}).click();await page.locator('[data-program-lesson][aria-pressed=true]').waitFor();await page.locator('[data-program-lesson]').click();}
 await page.locator('[data-study-reader]').waitFor();
 if(width===320){assert.equal(sent.length,2);assert.equal(sent[0].actionId,sent[1].actionId);}

 const context=await prisma.userStudyContext.findUniqueOrThrow({where:{userId_workKey:{userId:f.user.id,workKey:key}}});assert.equal(context.activeLessonKey,'study:'+lesson.id);assert.equal(context.version,1);
 for(const route of ['/dashboard','/live','/courses']){await page.goto(base+route);await page.locator('[data-program-context]').getByText('Een gepubliceerde les met een langere titel',{exact:true}).first().waitFor();}
 await page.getByRole('button',{name:'Een gepubliceerde les met een langere titel',exact:false}).click();await page.locator('[data-study-reader]').waitFor();
 await page.goBack();await page.locator('[data-program-context]').waitFor();await page.goForward();await page.locator('[data-study-reader]').waitFor();
 assert.equal((await prisma.userStudyContext.findUniqueOrThrow({where:{userId_workKey:{userId:f.user.id,workKey:key}}})).version,1,'zelfde keuze schrijft niets');
 assert.equal((await prisma.user.findUnique({where:{id:f.user.id}})).xpTotal,f.user.xpTotal);assert.equal(await prisma.contentProgress.count({where:{userId:f.user.id}}),0);
 results.push({width,scheme,language,scale,choose:true,todayLearnPlay:true,noRewards:true});await c.close();
}writeFileSync(out+'/results.json',JSON.stringify(results,null,2));console.log(JSON.stringify({programBrowser:results}));}finally{await browser.close();await prisma.$disconnect();}
