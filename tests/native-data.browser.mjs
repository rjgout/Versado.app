// Echte React-hooks, gesimuleerde lees-API; geen database of productieverbinding.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {setTimeout as delay} from 'node:timers/promises';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE??'playwright');
const bundle=await build({entryPoints:['tests/fixtures/native-data-client.tsx'],bundle:true,write:false,platform:'browser',minify:true,define:{'process.env.NODE_ENV':'"production"'}});
const calls=[],held=[];let hold=false,offline=false;
function answer(url,res){
 if(offline){res.writeHead(503);res.end();return;}
 const path=url.searchParams.get('path');
 const data=path?{id:path.slice(9),title:`${url.searchParams.get('account')}:${path}`,verses:[{number:1,text:'Synthetische tekst'}],state:{read:'UNREAD'}}:{label:`${url.searchParams.get('content')}:${url.searchParams.get('language')}:${url.searchParams.get('chapter')}`};
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
}
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/query'){calls.push(url.search);if(hold)held.push(()=>answer(url,res));else answer(url,res);return;}
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
const text=()=>page.locator('[data-query]').allTextContents();
const waitText=async expected=>{await page.waitForFunction(expected=>[...document.querySelectorAll('[data-query]')].every(element=>element.textContent===expected),expected);};
const set=patch=>page.evaluate(patch=>window.wp6Probe.set(patch),patch);
const release=()=>{hold=false;for(const finish of held.splice(0))finish();};
const changeHeld=async patch=>{const before=held.length;await set(patch);for(let attempt=0;held.length===before&&attempt<100;attempt++)await delay(10);assert.ok(held.length>before,'Nieuwe key vraagt data op');};
try{
 await page.goto('http://127.0.0.1:'+server.address().port);await waitText('SSR-A');
 // Ook met de optionele keepPreviousData mag bron-/taalgebonden data nooit doorsijpelen.
 hold=true;await changeHeld({content:'B'});
 assert.deepEqual(await text(),['empty','empty'],'Een nieuwe bron toont noch SSR-data noch keepPreviousData van de oude bron');
 assert.equal(calls.length,1,'Twee weblezers delen één aanvraag');release();await waitText('B:nl:one');
 hold=true;await changeHeld({language:'de'});
 assert.deepEqual(await text(),['empty','empty'],'Een nieuwe taal toont geen oude tekst');release();await waitText('B:de:one');
 hold=true;await changeHeld({adapter:'native',content:'A',language:'nl',chapter:'one'});
 assert.deepEqual(await text(),['empty','empty']);release();await waitText('A:chapters/A-nl-one');
 const nativeCalls=calls.length;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));assert.equal(calls.length,nativeCalls,'Verse query wordt bij focus niet opnieuw verstuurd');
 hold=true;await changeHeld({chapter:'two'});
 assert.deepEqual(await text(),['empty','empty'],'Andere concrete hoofdstukidentiteit toont geen vorige tekst');
 await changeHeld({user:'B'});
 assert.deepEqual(await text(),['empty','empty'],'Accountwissel toont geen data van A');release();await waitText('B:chapters/A-nl-two');
 assert.equal(calls.filter(query=>query.includes('account=B')).length,1,'De twee nieuwe accountlezers dedupliceren');
 offline=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>document.querySelector('[data-query]')?.getAttribute('data-error')==='true');
 assert.deepEqual(await text(),['B:chapters/A-nl-two','B:chapters/A-nl-two'],'Leesfout behoudt alleen eigen cache');
 const failedCalls=calls.length;await page.waitForTimeout(150);assert.equal(calls.length,failedCalls,'Geen blinde foutretry');
 offline=false;await page.evaluate(()=>window.dispatchEvent(new Event('versado:app-resumed')));await page.waitForFunction(()=>document.querySelector('[data-query]')?.getAttribute('data-error')==='false');
 assert.deepEqual(errors,[]);assert.ok(calls.every(query=>!query.includes('complete')),'Leesherstel verstuurt nooit een afronding');
 console.log('WP6-browserbewijs: webbron/taal/SSR-isolatie, querydedupe, native hoofdstuk-/accountwissel, late antwoorden, focus, foutstatus en hervatten geslaagd.');
}finally{release();await browser.close();await new Promise(resolve=>server.close(resolve));}
