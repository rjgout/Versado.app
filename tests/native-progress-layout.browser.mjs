// Echte gedeelde shell/native progressieclients; synthetische HTTP-data, geen accounts of NAS.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import config from '../tailwind.config.ts';
import {getT} from '../src/lib/i18n/index.ts';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out=process.env.PROGRESS_LAYOUT_OUTPUT??'/tmp/versado-native-browser/progress-layout';mkdirSync(out,{recursive:true});
for(const name of ["fout.json","mislukte-proef.png","resultaten.json"])if(existsSync(out+"/"+name))unlinkSync(out+"/"+name);
const bundle=await build({entryPoints:['tests/fixtures/native-progress-layout-client.tsx'],bundle:true,write:false,platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
const css=(await postcss([tailwind(config),autoprefixer()]).process(readFileSync('src/app/globals.css','utf8'),{from:'src/app/globals.css'})).css;
const entries=Array.from({length:9},(_,i)=>({rank:i+1,userId:'layout-'+i,handle:'Langenaamvoorbreedtecontrole-'+i,xp:1234567+i,tier:'BRONZE',isMe:i===0,zone:i<3?'PROMOTION':i>6?'RELEGATION':'SAFE'}));
const server=createServer((req,res)=>{
 const u=new URL(req.url,'http://local.invalid');
 if(u.pathname.startsWith('/api/')){
  const json=u.pathname==='/api/leaderboard'?(u.searchParams.get('scope')==='national'?{scope:'national',entries:entries.map(e=>({...e,xpTotal:e.xp,currentStreak:123})),me:null}:{scope:u.searchParams.get('scope')??'league',myTier:'BRONZE',highestTier:'GOLD',weekEndsAt:new Date(Date.now()+86400000*3).toISOString(),promoteCount:3,demoteCount:2,promotePercent:30,demotePercent:20,hasActivityThisWeek:true,xpGap:{toward:'PROMOTION',xp:34567},entries})
  :u.pathname==='/api/streak'?{currentStreak:1,longestStreak:1,freezeCount:2,firstMonth:{year:2026,month:10},continuation:{status:'ACTIVE',currentStreak:1,day:'2026-11-21',interruptedDay:null,completed:0,required:0,studiedToday:true},month:{today:'2026-11-21',year:2026,month:11,daysStudied:1,freezesUsed:0,days:Array.from({length:30},(_,i)=>({dayKey:'2026-11-'+String(i+1).padStart(2,'0'),day:i+1,weekday:(i+6)%7,state:i===20?'STUDIED':i>20?'FUTURE':'NONE'}))}}
  :u.pathname==='/api/xp-history'?{xpTotal:1234567,xpThisWeek:1234,hasMore:false,transactions:Array.from({length:24},(_,i)=>({id:'xp-'+i,amount:i+1,reason:'LESSON_COMPLETED',createdAt:new Date(Date.now()-i*3600000).toISOString()}))}
  :u.pathname==='/api/users/avatars'?{avatars:{}}:null;
  if(!json){res.writeHead(404);res.end();return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(json));return;
 }
 if(u.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(bundle.outputFiles[0].text);return;}
 if(u.pathname==='/index.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
 if(/^\/(icons|images|mascots|native-profile)\//.test(u.pathname)){
  const path=resolve('public','.'+u.pathname);if(!path.startsWith(resolve('public')+'/')||!existsSync(path)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',path.endsWith('.svg')?'image/svg+xml':path.endsWith('.png')?'image/png':'image/webp');res.end(readFileSync(path));return;
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/index.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}),errors=[],results=[];
let current;
try{
 for(const language of ['nl','en','de','fr','es'])for(const [width,scale,scheme,nativeHeight]of [[320,2,'light',0],[375,2,'dark',110],[390,1,'light',94],[430,1,'dark',0]]){
  const context=await browser.newContext({viewport:{width,height:844},locale:language,colorScheme:scheme,hasTouch:true});
  await context.addInitScript(({scale,nativeHeight})=>document.addEventListener('DOMContentLoaded',()=>{
   document.documentElement.style.fontSize=scale*100+'%';document.documentElement.style.setProperty('--safe-area-inset-bottom','34px');
   if(nativeHeight){document.documentElement.dataset.vsNativeTabbar='true';document.documentElement.style.setProperty('--vs-native-tabbar-height',nativeHeight+'px');}
  }),{scale,nativeHeight});
  const page=await context.newPage();current=page;page.on('pageerror',e=>errors.push(e.message));const t=getT(language);
  for(const route of ['/competition','/streak','/xp']){
   await page.goto(`${origin}/?material=ios&language=${language}&screen=${route.slice(1)}#${route}`);await page.locator('main h1').filter({hasText:t(route==='/competition'?'nav.competition':route==='/streak'?'streakPage.title':'xpHistory.title')}).waitFor({state:route==='/competition'?'attached':'visible'});
   await page.waitForFunction(()=>document.querySelector('main .card')&&parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height'))>0);
   const widths=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,main:document.querySelector('main').getBoundingClientRect().width,children:[...document.querySelector('main').children].map(e=>({width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right,left:e.getBoundingClientRect().left}))}));
   assert.ok(widths.scroll<=width+1&&widths.main<=width+1&&widths.children.every(e=>e.right<=width+1&&e.left>=-1),'Geen pagina-overflow: '+JSON.stringify({route,language,scale,widths}));
   if(route==='/competition')await page.locator('main .truncate').first().waitFor();
   if(language==='nl')await page.screenshot({path:`${out}/${route.slice(1)}-${width}-${scale}-${scheme}-${nativeHeight}-boven.png`});
   if(route==='/competition'){
    assert.equal(await page.locator('[data-main-nav] [data-kompas-target="nav-friends"]').getAttribute('aria-current'),'page');
    const scroller=page.locator('main .snap-mandatory');assert.ok(await scroller.evaluate(e=>e.scrollWidth>e.clientWidth));await scroller.evaluate(e=>e.scrollLeft=e.scrollWidth);assert.ok(await scroller.evaluate(e=>e.scrollLeft>0));
    for(const name of [t('nav.friends'),t('leaderboard.national')]){await page.getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true}).waitFor();await page.locator('main .truncate').first().waitFor();assert.ok(await page.locator('main .truncate').first().evaluate(e=>e.getBoundingClientRect().width>=16),'Gebruikersnaam blijft zichtbaar naast de cijfers');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Ranglijsttab past ook bij grote tekst');}
   }
   if(route==='/streak')await page.getByText(t('streakPage.longestOne',{n:1}),{exact:true}).waitFor();
   await page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
   const bottom=await page.locator('main > :last-child').evaluate(e=>{const child=e.lastElementChild??e;return child.getBoundingClientRect().bottom;});
   const barTop=await page.locator('[data-main-nav]').evaluate(e=>e.getBoundingClientRect().top);
   assert.ok(bottom<=barTop+1,'Laatste inhoud blijft boven de tabbar bereikbaar: '+JSON.stringify({route,bottom,barTop,width,scale}));
   if(language==='nl'){await page.screenshot({path:`${out}/${route.slice(1)}-${width}-${scale}-${scheme}-${nativeHeight}.png`,fullPage:false});}
   results.push({route,language,width,scale,scheme,nativeHeight,overflow:false,bottomReachable:true});
  }
  await context.close();current=null;
 }
 assert.deepEqual(errors,[]);writeFileSync(out+'/resultaten.json',JSON.stringify(results,null,2));console.log('Mobiele progressieregressies:',results.length,'gevallen; vijf talen, vier breedtes, 200%, licht/donker, React/gesimuleerde UIKit-tabbar. Geen fysieke iPhone-acceptatie.');
}catch(error){if(current){await current.screenshot({path:out+'/mislukte-proef.png',fullPage:true});writeFileSync(out+'/fout.json',JSON.stringify({error:String(error),errors},null,2));}throw error;}finally{await browser.close();await new Promise(done=>server.close(done));}
