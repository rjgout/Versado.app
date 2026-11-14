// Echte Foundation/reader/router/shell. Alleen HTTP-antwoorden en OS-uitvoer
// zijn synthetisch: dit bewijst compositie/bediening, geen fysieke audioaflevering.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const out='/tmp/versado-native-audio-player-browser/shell';mkdirSync(out,{recursive:true});
const bundle=await build({entryPoints:['tests/fixtures/native-audio/shell-client.tsx'],bundle:true,write:false,minify:true,platform:'browser',define:{'process.env.NODE_ENV':'"production"'}}),css=readFileSync('dist/native/index.css');
const server=createServer((req,res)=>{
 if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].contents);}
 else if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css);}
 else if(req.url?.startsWith('/icons/')){res.setHeader('Content-Type','image/png');res.end(readFileSync('public/icons/native/versado-flame.png'));}
 else{res.end('<!doctype html><html lang="nl"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??undefined,args:['--no-sandbox']});
const results=[],errors=[];
const mini=page=>page.locator('[data-read-aloud-mini-player]');
async function open({width=440,height=956,scale=1,safeTop=62,scheme='light',language='nl',mode='tts',kind='chapters',hold=false}={}){
 const context=await browser.newContext({viewport:{width,height},colorScheme:scheme});
 await context.addInitScript(({scale,safeTop})=>document.addEventListener('DOMContentLoaded',()=>{
  document.documentElement.style.fontSize=`${scale*100}%`;
  document.documentElement.style.setProperty('--vs-safe-area-top',`${safeTop}px`);
  document.documentElement.style.setProperty('--vs-safe-area-bottom','34px');
 }),{scale,safeTop});
 const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 await page.goto(`${origin}/?mode=${mode}&language=${language}&kind=${kind}${hold?'&hold=1':''}#/courses/course/read/${kind}/target`);
 await page.locator('[data-native-read-aloud] button.w-full:not(:disabled)').waitFor();
 assert.equal(await mini(page).count(),0);
 assert.equal(await page.locator('[data-shell-mode]').getAttribute('data-shell-mode'),'focus');
 assert.equal(await page.locator('[data-app-global-header]').isVisible(),false);
 return {page,context,safeTop};
}
async function visible(page,safeTop){
 await page.waitForFunction(safe=>{
  const el=document.querySelector('[data-read-aloud-mini-player]'),header=document.querySelector('[data-sticky-header]');
  if(!el)return false;const rect=el.getBoundingClientRect(),s=getComputedStyle(el);
  return rect.top>=safe&&rect.bottom<=innerHeight-34&&rect.width>0&&s.display!=='none'&&s.visibility==='visible'&&s.opacity!=='0'&&getComputedStyle(header).position==='fixed'&&Math.abs(parseFloat(document.documentElement.style.getPropertyValue('--header-height'))-header.offsetHeight)<1;
 },safeTop);
 assert.equal(await mini(page).count(),1,'Slechts één gedeelde minispeler');
 const measured=await mini(page).evaluate((el,safe)=>{
  const header=el.closest('[data-sticky-header]'),rect=el.getBoundingClientRect();
  const controls=[...el.querySelectorAll('button')].map(button=>{
   const r=button.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
   return {label:button.getAttribute('aria-label'),safe:r.top>=safe&&r.bottom<=innerHeight-34&&r.left>=0&&r.right<=innerWidth,hit:!!hit&&(hit===button||button.contains(hit)),width:r.width,height:r.height};
  });
  return {rect:rect.toJSON(),headerHeight:header.offsetHeight,measuredHeight:document.documentElement.style.getPropertyValue('--header-height'),mainPadding:parseFloat(getComputedStyle(document.querySelector('main')).paddingTop),controls,overflow:document.documentElement.scrollWidth>innerWidth+1,scrollY};
 },safeTop);
 assert.equal(measured.overflow,false);assert.ok(measured.mainPadding>=measured.headerHeight);
 for(const control of measured.controls){assert.ok(control.label);assert.ok(control.safe&&control.hit,JSON.stringify(control));assert.ok(control.width>0&&control.height>0);}
 assert.equal(await page.evaluate(()=>window.audioEvidence.listeners),1);
 return measured;
}
async function start(page,fromMenu=false){
 if(fromMenu){await page.locator('#vers-3 [data-annotation-trigger]').click();await page.locator('[data-annotation-read-aloud]:not(:disabled)').click();}
 else await page.locator('[data-native-read-aloud] button.w-full').click();
}
async function noWrites(page){
 assert.ok(await page.evaluate(()=>window.audioEvidence.postRoutes.every(route=>['login','refresh','logout'].includes(route))),'Audio bedient geen leespositie/annotatie/READ/XP/afrondings-POST');
}
try {
 // Standaard iPhone-profiel én kleine telefoons/tablets; werkelijk gemeten
 // veilige randen en hit-tests, niet uitsluitend React-existence/isVisible().
 for(const profile of [...[320,375,390,440,768].map(width=>({width,height:width===768?1024:956,safeTop:62})),{width:320,height:568,safeTop:59},{width:390,height:844,safeTop:24},{width:1024,height:768,safeTop:24}])for(const scale of [1,2])for(const mode of ['tts','recording']){
  const {width,height}=profile;const settings={...profile,scale,scheme:scale===2?'dark':'light',mode};
  const {page,context,safeTop}=await open(settings);await start(page);
  await page.waitForFunction(()=>window.audioEvidence.commands.length===1);
  const measured=await visible(page,safeTop);assert.equal(await mini(page).locator('[aria-busy=true]').count(),0);
  assert.equal(await mini(page).getByRole('button',{name:'Pauzeren',exact:true}).count(),1);
  assert.equal(await page.locator('#vers-2').evaluate(el=>el.className.includes('ring-2')),true,'Actueel vers blijft gemarkeerd');
  if(width===440&&scale===1||width===320&&scale===2)await page.screenshot({path:`${out}/native-${width}x${height}-${scale*100}-${mode}-${settings.scheme}.png`,fullPage:false});
  results.push({...settings,...measured});
  await mini(page).getByRole('button',{name:'Voorlezen stoppen'}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-read-aloud-mini-player]'));
  assert.equal(await page.evaluate(()=>window.audioEvidence.active),false);await noWrites(page);await context.close();
 }
 // Alle bediening door de echte Nederlandse mini, ook vanuit het versmenu.
 for(const mode of ['tts','recording'])for(const fromMenu of [false,true]){
  const {page,context,safeTop}=await open({mode});await start(page,fromMenu);await visible(page,safeTop);
  assert.equal(await page.evaluate(()=>window.audioEvidence.commands[0].index),fromMenu?1:0);
  await mini(page).getByRole('button',{name:'Pauzeren',exact:true}).click();await mini(page).getByRole('button',{name:'Afspelen',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.audioEvidence.active),false);
  await mini(page).getByRole('button',{name:'Afspelen',exact:true}).click();await mini(page).getByRole('button',{name:'Pauzeren',exact:true}).waitFor();
  if(fromMenu)await mini(page).getByRole('button',{name:'Vorig vers',exact:true}).click();
  await mini(page).getByRole('button',{name:'Volgend vers',exact:true}).click();
  await page.waitForFunction(()=>window.audioEvidence.commands.at(-1).index===1);
  assert.equal(await mini(page).getByRole('button',{name:'Volgend vers',exact:true}).isDisabled(),true);
  await mini(page).getByRole('button',{name:'Vorig vers',exact:true}).click();await page.waitForFunction(()=>window.audioEvidence.commands.at(-1).index===0);
  for(const speed of [0.75,1,1.25,1.5,2]){
   await mini(page).getByRole('combobox').click();await page.getByRole('option',{name:`${speed}×`,exact:true}).click();
   await page.waitForFunction(speed=>window.audioEvidence.commands.at(-1).action==='speed'&&window.audioEvidence.commands.at(-1).speed===speed,speed);
  }
  await mini(page).getByRole('button',{name:'Pauzeren',exact:true}).focus();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.closest('[data-read-aloud-mini-player]')!==null),true);
  const old=await page.evaluate(()=>window.audioEvidence.commands[0]);
  await mini(page).getByRole('button',{name:'Voorlezen stoppen'}).click();await page.waitForFunction(()=>!document.querySelector('[data-read-aloud-mini-player]'));
  await start(page);await visible(page,safeTop);
  await page.evaluate(old=>window.audioTest.event({commandId:old.commandId,actionVersion:99,index:1,playing:false,stopped:true,failed:false}),old);
  assert.equal(await mini(page).count(),1,'Geldige late stopcallback van oude opdracht wist de nieuwe speler niet');
  await mini(page).getByRole('button',{name:'Voorlezen stoppen'}).click();await page.waitForFunction(()=>!document.querySelector('[data-read-aloud-mini-player]'));
  await page.evaluate(old=>window.audioTest.event({commandId:old.commandId,actionVersion:99,index:1,playing:true,stopped:false,failed:false}),old);
  assert.equal(await mini(page).count(),0);await noWrites(page);await context.close();
 }
 // Voorbereiden is zichtbaar en annuleerbaar; oude callback mag niet herstarten.
 for(const cancel of [false,true])for(const profile of [{},{width:320,height:568,scale:2,safeTop:59}]){
  const {page,context,safeTop}=await open({...profile,hold:true});await start(page);await page.waitForFunction(()=>typeof window.releaseAudio==='function');
  const preparing=await visible(page,safeTop);assert.equal(await mini(page).getByRole('status').textContent(),'Laden…');
  assert.equal(await mini(page).locator('button[aria-busy=true]').isDisabled(),true);
  if(cancel)await mini(page).getByRole('button',{name:'Voorlezen stoppen'}).click();
  await page.evaluate(()=>window.releaseAudio());
  if(cancel){await page.waitForFunction(()=>!document.querySelector('[data-read-aloud-mini-player]'));assert.equal(await page.evaluate(()=>window.audioEvidence.commands.length),0);}
  else{await page.waitForFunction(()=>window.audioEvidence.commands.length===1);const playing=await visible(page,safeTop);assert.equal(playing.headerHeight,preparing.headerHeight,"Voorbereiding gebruikt dezelfde compacte rijhoogte");}
  await noWrites(page);await context.close();
 }
 // Vijf talen en beide leesdoelen blijven exact dezelfde presentatie gebruiken.
 for(const language of ['nl','en','de','fr','es']){
  const {page,context,safeTop}=await open({language,kind:'steps',width:375});await start(page,true);await visible(page,safeTop);
  assert.equal(await page.evaluate(()=>window.audioEvidence.commands[0].index),1);
  await page.evaluate(()=>window.audioTest.end());
  await page.waitForFunction(()=>!window.audioEvidence.active);
  assert.equal(await mini(page).count(),1,'Bestaand native hoofdstukeinde pauzeert; expliciet stoppen beëindigt de sessie');
  await mini(page).locator('button').last().click();await page.waitForFunction(()=>!document.querySelector('[data-read-aloud-mini-player]'));
  assert.equal(await page.evaluate(()=>window.audioEvidence.active),false);await noWrites(page);await context.close();
 }
 for(const action of ['navigation','account','source','background']){
  const {page,context,safeTop}=await open();await start(page);await visible(page,safeTop);
  const old=await page.evaluate(()=>window.audioEvidence.commands[0]);
  if(action==='navigation')await page.locator('[data-subpage-back-bar] button').click();
  else if(action==='account')await page.evaluate(()=>window.audioTest.nextAccount());
  else if(action==='source')await page.evaluate(()=>window.audioTest.sourceChange());
  else await page.evaluate(()=>window.audioTest.background());
  await page.waitForFunction(()=>!document.querySelector('[data-read-aloud-mini-player]'));
  await page.waitForFunction(()=>!window.audioEvidence.active);
  await page.evaluate(old=>window.audioTest.event({commandId:old.commandId,actionVersion:99,index:1,playing:true,stopped:false,failed:false}),old);
  assert.equal(await mini(page).count(),0,'Oude callback kan na intrekking geen speler terugbrengen');
  const count=await page.evaluate(()=>window.audioEvidence.commands.length);
  if(action==='background')await page.evaluate(()=>window.audioTest.foreground());
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>window.audioEvidence.commands.length),count,'Geen automatische herstart');
  await noWrites(page);await context.close();
 }
 assert.deepEqual(errors,[]);writeFileSync(`${out}/evidence.json`,JSON.stringify(results,null,2));
 console.log('PASS echte native Focus-shell: safe areas/100–200%/320–1024px/korte568px, opname+TTS, startknop+versmenu, voorbereiden/annuleren, alle bediening, 5 talen, sessie/bron/navigatie/lifecycle-cleanup. OS en HTTP synthetisch; fysieke acceptatie blijft open.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
