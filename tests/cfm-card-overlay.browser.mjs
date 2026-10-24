// Gerichte componentbrowsercontrole: echte CFM-/kaartcomponenten; alleen services, router en Next Image zijn fixtures.
// CFM_OVERLAY_IMAGE wijst naar de officiële afbeelding van bronles 43 (geen vervangend beeld).
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { build } from "esbuild";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
assert.ok(process.env.CFM_OVERLAY_IMAGE, "CFM_OVERLAY_IMAGE: officiële afbeelding van CFM 2026 les 43 vereist");
const picture = readFileSync(process.env.CFM_OVERLAY_IMAGE);
const temporary = mkdtempSync(join(tmpdir(), "cfm-overlay-"));
const output = resolve(process.env.CFM_OVERLAY_OUTPUT ?? "/tmp/cfm-overlay-results");
mkdirSync(output, { recursive: true });
const component = "src/components/study/CfmWeekPath.tsx";
const baseline = execFileSync("git", ["show", `b28db54b:${component}`], { encoding: "utf8" });
const fixture = `import React from 'react'; import {createRoot} from 'react-dom/client'; import CfmWeekPath from '${resolve(component)}';
const common={collectionId:'fixture',lessonId:'lesson',lessonKey:'fixture',read:false,stepsDone:2,startsOn:'2026-10-19',endsOnExclusive:'2026-10-26',imageMediaId:'official'};
createRoot(document.getElementById('root')).render(<CfmWeekPath weeks={[
{...common,id:'current',title:location.search.includes('long')?'Psalmen 102–103; 110; 116–119; 127–128; 135–139; 146–150: een lange Nederlandse lestitel':'Jeremia 1–3; 7; 16–18; 20',...(location.search.includes('long')?{startsOn:'2026-12-28',endsOnExclusive:'2027-01-04'}:{})},
{...common,id:'other',title:'Jeremia 1–3; 7; 16–18; 20',read:true,stepsDone:6},
{...common,id:'closed',title:'Mattheüs 2; Lukas 2',stepsDone:0,startsOn:'2026-12-28',endsOnExclusive:'2027-01-04'},
{...common,id:'missing',title:'Een lange Nederlandse lestitel over geloof, hoop en de voorbereiding op het nieuwe kalenderjaar',imageMediaId:null,startsOn:'2026-12-28',endsOnExclusive:'2027-01-04'}
]} mode={location.search.includes("free")?"FREE":"STEPS"} activeWeekId="current" sessionKey="fixture"/>);`;
async function bundle(name, old = false) {
  await build({ stdin: { contents: fixture, loader: "tsx", resolveDir: process.cwd() }, bundle: true, outfile: join(temporary, name), jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "fixtures", setup(b) {
    if (old) b.onLoad({ filter: /CfmWeekPath\.tsx$/ }, () => ({ contents: baseline, loader: "tsx", resolveDir: resolve("src/components/study") }));
    b.onResolve({ filter: /personalStudy$|I18nProvider|lib\/data\/hooks|next\/image|next\/link/ }, args => ({ path: args.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, ({path}) => ({ resolveDir: process.cwd(), loader: "jsx", contents:
      path.endsWith("personalStudy") ? "export const PERSONAL_STUDY_STEPS=6;" :
      path.includes("I18nProvider") ? `export const useUiLanguage=()=> 'nl'; export const useT=()=> (k,p)=>({'cfmStudy.currentWeek':'Deze week','cfmStudy.stepN':'Stap '+p?.n,'cfmStudy.pathLabel':'Weekpad','cfmStudy.expandWeek':'Uitklappen','cfmStudy.collapseWeek':'Inklappen'}[k]||k);` :
      path.includes("hooks") ? `export const useLiveQuery=()=>({data:{revisionId:'fixture',state:{lastOpenedIndex:3,steps:[{fingerprint:'1',status:'COMPLETED'},{fingerprint:'2',status:'COMPLETED'},{fingerprint:'3',status:'IN_PROGRESS'}]},steps:Array.from({length:6},(_,i)=>({index:i+1,title:['Begin met lezen','Ontdek de boodschap','Verdiep je studie','Pas het geleerde toe','Bespreek je inzichten','Kijk terug'][i],fingerprint:String(i+1)}))}});` :
      path.includes("image") ? `import React from 'react';export default function Image({fill,unoptimized,...p}){return <img {...p} style={fill?{position:'absolute',inset:0,width:'100%',height:'100%'}:{}}/>}` :
      `import React from 'react';export default function Link({prefetch,...p}){return <a {...p}/>} ` }));
  }}] });
}
await bundle("app.js"); await bundle("before.js", true);
execFileSync(process.execPath, ["node_modules/tailwindcss/lib/cli.js", "-i", "src/app/globals.css", "-o", join(temporary,"style.css")], { stdio:"pipe" });
writeFileSync(join(temporary,"style.css"),readFileSync(join(temporary,"style.css"),"utf8")+"\n*,*::before,*::after{animation:none!important;transition:none!important}\n");
const server = createServer((req,res) => {
  if (req.url.startsWith("/api/study-media/")) { res.setHeader("content-type","image/jpeg");res.end(picture); return; }
  if (["/app.js","/before.js","/style.css"].includes(req.url)) {res.setHeader("content-type",req.url.endsWith("css")?"text/css":"text/javascript");res.end(readFileSync(join(temporary,req.url.slice(1))));return;}
  res.setHeader("content-type","text/html");res.end(`<!doctype html><html lang="nl"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><main id="root" style="max-width:640px;margin:auto;padding:16px"></main><script src="/${req.url.includes('before')?'before':'app'}.js"></script></html>`);
});
await new Promise(r=>server.listen(0,"127.0.0.1",r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:["--no-sandbox"]});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:375,height:900},reducedMotion:"reduce"});
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto(base+"/before");await page.locator('[data-week="current"] img').waitFor();
  const before=await page.locator('[data-week="current"]').boundingBox();
  const closedBefore=await page.locator('[data-week="closed"]').boundingBox();
  await page.goto(base);const current=page.locator('[data-week="current"]');
  await current.locator('img').waitFor();await current.locator('img').evaluate(img=>img.decode());
  const after=await current.boundingBox();assert.ok(after.height<before.height, `${before.height} → ${after.height}`);
  const closedAfter=await page.locator('[data-week="closed"]').boundingBox();assert.equal(closedAfter.height,closedBefore.height);
  assert.equal(await current.getByRole('heading').count(),1);
  const banner=current.locator('[data-image-overlay]');
  const eyebrow=await current.locator('[data-cfm-week-label]').boundingBox();const imageBox=await banner.boundingBox();assert.ok(eyebrow.y>=imageBox.y && eyebrow.y+eyebrow.height<=imageBox.y+imageBox.height,JSON.stringify({eyebrow,imageBox}));
  const imageTop=await current.locator('img').boundingBox();assert.equal(imageTop.y,imageBox.y);assert.equal(eyebrow.y,imageBox.y);
  const cells=current.locator('[data-week-step]');assert.equal(await cells.count(),6);
  const a=await cells.nth(0).boundingBox(),b=await cells.nth(1).boundingBox();assert.ok(Math.abs(a.y-b.y)<1);assert.ok(b.x>a.x);assert.ok(a.y>=imageBox.y+imageBox.height);
  assert.equal(await cells.nth(0).getAttribute('data-step-status'),'COMPLETED');assert.equal(await cells.nth(2).getAttribute('data-step-status'),'IN_PROGRESS');assert.equal(await cells.nth(5).getAttribute('data-step-status'),'NOT_STARTED');
  const other=page.locator('[data-week="other"]');const toggle=other.getByRole('button');await toggle.focus();await page.keyboard.press('Enter');assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await other.locator('[data-image-overlay]').count(),1);
  const missing=page.locator('[data-week="missing"]');await missing.getByRole('button').click();assert.equal(await missing.locator('img').count(),0);assert.equal(await missing.locator('[data-week-step]').count(),6);assert.match(await missing.innerText(),/28 december 2026.*3 januari 2027/s);
  for(const [name,locator] of [['active',current],['expanded',other],['collapsed',page.locator('[data-week="closed"]')],['no-image',missing]])await locator.screenshot({path:join(output,`${name}-mobile.png`)});
  assert.equal(await page.locator('[data-week="closed"] img').count(),0);
  await page.goto(base+'/?long');await current.locator('img').waitFor();await other.getByRole('button').click();await missing.getByRole('button').click();assert.match(await current.innerText(),/28 december 2026.*3 januari 2027/s);
  for(const width of [320,375,390])for(const dark of [false,true])for(const scale of [100,200]) {
    await page.setViewportSize({width,height:900});await page.evaluate(({dark,scale})=>{document.documentElement.classList.toggle('dark',dark);document.documentElement.style.fontSize=scale+'%';},{dark,scale});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width},dark=${dark},text=${scale}`);
    for(const overlay of await page.locator('[data-image-overlay]').all()) {
      const box=await overlay.boundingBox();const text=await overlay.locator('[data-cfm-heading-text]').boundingBox();assert.ok(text.y>=box.y-1 && text.y+text.height<=box.y+box.height+1, JSON.stringify({width,dark,scale,box,text}));
    }
  }
  await toggle.click();await toggle.click();assert.equal(await other.locator('img').count(),1);
  await other.locator('img').dispatchEvent('error');await other.locator('img').waitFor({state:'detached'});assert.equal(await other.locator('img').count(),0);assert.match(await other.innerText(),/Jeremia/);assert.equal(await other.locator('[data-week-step]').count(),6);
  await current.locator('img').dispatchEvent('error');await current.locator('img').waitFor({state:'detached'});assert.equal(await current.locator('img').count(),0);assert.equal(await current.getByRole('heading').count(),1);
  await page.route('**/api/study-media/**',async route=>{await new Promise(r=>setTimeout(r,200));await route.fulfill({body:picture,contentType:'image/jpeg'});});
  await page.goto(base,{waitUntil:'domcontentloaded'});await current.getByRole('heading').waitFor();assert.equal(await current.locator('[data-week-step]').count(),6);
  const loadingBox=await current.locator('[data-image-overlay]').boundingBox();await current.locator('img').evaluate(img=>img.decode());
  const loadedBox=await current.locator('[data-image-overlay]').boundingBox();assert.equal(loadingBox.height,loadedBox.height);
  await page.route('**/api/study-media/**',route=>route.fulfill({status:404,body:'Ontbreekt'}));
  await page.goto(base);await current.getByRole('heading').waitFor();await current.locator('[data-image-overlay]').waitFor({state:'detached'});
  assert.equal(await current.locator('img').count(),0);assert.equal(await current.locator('[data-week-step]').count(),6);
  await page.unroute('**/api/study-media/**');
  await page.goto(base+'/before?free');await current.locator('img').evaluate(img=>img.decode());const freeBefore=await page.locator('main').screenshot();
  await page.goto(base+'/?free');await current.locator('img').evaluate(img=>img.decode());const freeAfter=await page.locator('main').screenshot();
  assert.deepEqual(freeAfter,freeBefore,'Vrije studie blijft visueel ongewijzigd');
  assert.deepEqual(errors,[]);
  writeFileSync(join(output,'results.json'),JSON.stringify({beforeHeight:before.height,afterHeight:after.height,closedUnchanged:true,viewports:[320,375,390],textScale:[100,200],themes:['light','dark'],keyboard:true,imageErrorFallback:true,slowImage:true,http404:true,freeUnchanged:true,errors},null,2));
  console.log(readFileSync(join(output,'results.json'),'utf8'));
} finally {await browser.close();await new Promise(r=>server.close(r));rmSync(temporary,{recursive:true,force:true});}
